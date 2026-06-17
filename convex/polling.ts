import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { postDiscordWebhook } from "./discord";
import { formatDiscordDateTime } from "./discordTime";
import { buildCimeChannelUrl } from "./channelUrl";
import { buildWatchLinksMarkdown } from "./watchLinks";

const CIME_API_BASE = "https://ci.me/api/openapi";
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = ONE_HOUR_MS;
const DEFAULT_LIVE_MESSAGE_TEMPLATE =
  "{channelName} 라이브가 시작되었습니다.";
const DEFAULT_STALE_MESSAGE_TEMPLATE =
  "{channelName} 채널이 30일 이상 오프라인 상태라 라이브 알림을 일시 중지했습니다. 대시보드에서 다시 요청하면 재개됩니다.";

type PollTarget = {
  monitor: Doc<"monitors">;
  account: Doc<"cimeAccounts">;
  webhook: Doc<"discordWebhooks">;
};

type LiveStatus = {
  isLive: boolean;
  title?: string;
  openedAt?: string;
};

export const pollDueMonitors = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const batchSize = Number(process.env.POLL_BATCH_SIZE ?? "25");
    const targets = (await ctx.runQuery(internal.polling.listDueMonitorTargets, {
      now,
      limit: Number.isFinite(batchSize) ? Math.max(1, batchSize) : 25,
    })) as PollTarget[];

    for (const target of targets) {
      await pollOne(ctx, target, Date.now());
    }

    return { checked: targets.length };
  },
});

export const listDueMonitorTargets = internalQuery({
  args: {
    now: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const monitors = await ctx.db
      .query("monitors")
      .withIndex("byStatusNextPoll", (q) =>
        q.eq("status", "active").lte("nextPollAt", args.now),
      )
      .take(args.limit);

    const targets = [];
    for (const monitor of monitors) {
      const account = await ctx.db.get(monitor.accountId);
      const webhook = await ctx.db.get(monitor.webhookId);
      if (!account || !webhook || !webhook.enabled) {
        continue;
      }
      targets.push({ monitor, account, webhook });
    }
    return targets;
  },
});

export const recordPollResult = internalMutation({
  args: {
    monitorId: v.id("monitors"),
    checkedAt: v.number(),
    status: v.union(v.literal("active"), v.literal("stalePaused"), v.literal("errored")),
    nextPollAt: v.number(),
    isLive: v.boolean(),
    title: v.optional(v.string()),
    openedAt: v.optional(v.string()),
    offlineSince: v.optional(v.number()),
    clearOfflineSince: v.boolean(),
    cooldownUntil: v.optional(v.number()),
    clearCooldownUntil: v.boolean(),
    lastNotifiedOpenedAt: v.optional(v.string()),
    lastLiveNotifiedAt: v.optional(v.number()),
    offlineNoticeSentAt: v.optional(v.number()),
    stalePausedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    delivery: v.optional(
      v.object({
        type: v.union(v.literal("liveStarted"), v.literal("stalePaused")),
        openedAt: v.optional(v.string()),
        status: v.union(v.literal("sent"), v.literal("failed")),
        error: v.optional(v.string()),
        responseStatus: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const monitor = await ctx.db.get(args.monitorId);
    if (!monitor) {
      return;
    }

    const patch: Partial<Doc<"monitors">> = {
      status: args.status,
      nextPollAt: args.nextPollAt,
      lastCheckedAt: args.checkedAt,
      lastIsLive: args.isLive,
      lastLiveTitle: args.title,
      lastOpenedAt: args.openedAt,
      errorCount: args.lastError ? monitor.errorCount : 0,
      lastError: args.lastError,
      updatedAt: args.checkedAt,
    };

    if (args.clearOfflineSince) {
      patch.offlineSince = undefined;
    } else if (args.offlineSince !== undefined) {
      patch.offlineSince = args.offlineSince;
    }

    if (args.clearCooldownUntil) {
      patch.cooldownUntil = undefined;
    } else if (args.cooldownUntil !== undefined) {
      patch.cooldownUntil = args.cooldownUntil;
    }

    if (args.lastNotifiedOpenedAt !== undefined) {
      patch.lastNotifiedOpenedAt = args.lastNotifiedOpenedAt;
    }
    if (args.lastLiveNotifiedAt !== undefined) {
      patch.lastLiveNotifiedAt = args.lastLiveNotifiedAt;
    }
    if (args.offlineNoticeSentAt !== undefined) {
      patch.offlineNoticeSentAt = args.offlineNoticeSentAt;
    }
    if (args.stalePausedAt !== undefined) {
      patch.stalePausedAt = args.stalePausedAt;
    }

    await ctx.db.patch(args.monitorId, patch);

    if (args.delivery) {
      await ctx.db.insert("deliveries", {
        ownerId: monitor.ownerId,
        monitorId: monitor._id,
        type: args.delivery.type,
        openedAt: args.delivery.openedAt,
        status: args.delivery.status,
        error: args.delivery.error,
        responseStatus: args.delivery.responseStatus,
        createdAt: args.checkedAt,
      });
    }
  },
});

export const recordPollFailure = internalMutation({
  args: {
    monitorId: v.id("monitors"),
    checkedAt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const monitor = await ctx.db.get(args.monitorId);
    if (!monitor) {
      return;
    }

    const errorCount = monitor.errorCount + 1;
    const backoffMs = Math.min(
      MAX_BACKOFF_MS,
      FIVE_MINUTES_MS * 2 ** Math.min(errorCount, 4),
    );

    await ctx.db.patch(args.monitorId, {
      nextPollAt: args.checkedAt + backoffMs,
      lastCheckedAt: args.checkedAt,
      errorCount,
      lastError: args.error,
      updatedAt: args.checkedAt,
    });
  },
});

async function pollOne(ctx: any, target: PollTarget, now: number) {
  let liveStatus: LiveStatus;
  try {
    liveStatus = await fetchLiveStatus(target.account.channelId);
  } catch (error) {
    await ctx.runMutation(internal.polling.recordPollFailure, {
      monitorId: target.monitor._id,
      checkedAt: now,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const result = await decideNextState(target, liveStatus, now);
  await ctx.runMutation(internal.polling.recordPollResult, {
    monitorId: target.monitor._id,
    checkedAt: now,
    ...result,
  });
}

async function decideNextState(
  target: PollTarget,
  liveStatus: LiveStatus,
  now: number,
) {
  const monitor = target.monitor;
  const openedAt = liveStatus.openedAt;
  const isOffToOn = monitor.lastIsLive === false && liveStatus.isLive;
  const isNewOpenedAt =
    monitor.lastIsLive === true &&
    liveStatus.isLive &&
    openedAt !== undefined &&
    openedAt !== monitor.lastOpenedAt;

  if (liveStatus.isLive) {
    const shouldNotify =
      (isOffToOn || isNewOpenedAt) &&
      openedAt !== undefined &&
      openedAt !== monitor.lastNotifiedOpenedAt;

    const delivery = shouldNotify
      ? await sendLiveStartedMessage(target, liveStatus)
      : undefined;
    const sent = delivery?.ok === true;

    return {
      status: "active" as const,
      nextPollAt: now + ONE_HOUR_MS,
      isLive: true,
      title: liveStatus.title,
      openedAt,
      clearOfflineSince: true,
      cooldownUntil: now + ONE_HOUR_MS,
      clearCooldownUntil: false,
      lastNotifiedOpenedAt: sent ? openedAt : undefined,
      lastLiveNotifiedAt: sent ? now : undefined,
      lastError: delivery && !delivery.ok ? delivery.error : undefined,
      delivery: delivery
        ? {
            type: "liveStarted" as const,
            openedAt,
            status: delivery.ok ? ("sent" as const) : ("failed" as const),
            error: delivery.error,
            responseStatus: delivery.status,
          }
        : undefined,
    };
  }

  const offlineSince =
    monitor.lastIsLive === true || monitor.offlineSince === undefined
      ? now
      : monitor.offlineSince;
  const shouldPause = now - offlineSince >= THIRTY_DAYS_MS;
  const staleDelivery =
    shouldPause && monitor.offlineNoticeSentAt === undefined
      ? await sendStalePausedMessage(target)
      : undefined;

  if (staleDelivery && !staleDelivery.ok) {
    return {
      status: "errored" as const,
      nextPollAt: now + ONE_HOUR_MS,
      isLive: false,
      clearOfflineSince: false,
      offlineSince,
      clearCooldownUntil: true,
      lastError: staleDelivery.error,
      delivery: {
        type: "stalePaused" as const,
        status: "failed" as const,
        error: staleDelivery.error,
        responseStatus: staleDelivery.status,
      },
    };
  }

  if (shouldPause) {
    return {
      status: "stalePaused" as const,
      nextPollAt: Number.MAX_SAFE_INTEGER,
      isLive: false,
      clearOfflineSince: false,
      offlineSince,
      clearCooldownUntil: true,
      offlineNoticeSentAt: now,
      stalePausedAt: now,
      delivery: staleDelivery
        ? {
            type: "stalePaused" as const,
            status: "sent" as const,
            responseStatus: staleDelivery.status,
          }
        : undefined,
    };
  }

  return {
    status: "active" as const,
    nextPollAt: now + FIVE_MINUTES_MS,
    isLive: false,
    clearOfflineSince: false,
    offlineSince,
    clearCooldownUntil: true,
  };
}

async function fetchLiveStatus(channelId: string): Promise<LiveStatus> {
  const response = await fetch(
    `${CIME_API_BASE}/v1/${encodeURIComponent(channelId)}/live-status`,
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`CI.ME live-status 오류: HTTP ${response.status}`);
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("CI.ME live-status 응답을 해석할 수 없습니다.");
  }

  const maybeEnvelope = payload as {
    code?: number;
    message?: string;
    content?: unknown;
  };

  if (typeof maybeEnvelope.code === "number" && maybeEnvelope.code !== 200) {
    throw new Error(
      maybeEnvelope.message ?? `CI.ME live-status 오류: code ${maybeEnvelope.code}`,
    );
  }

  const content =
    maybeEnvelope.content && typeof maybeEnvelope.content === "object"
      ? maybeEnvelope.content
      : payload;
  const live = content as {
    isLive?: unknown;
    title?: unknown;
    openedAt?: unknown;
  };

  if (typeof live.isLive !== "boolean") {
    throw new Error("CI.ME live-status 응답에 isLive가 없습니다.");
  }

  return {
    isLive: live.isLive,
    title: typeof live.title === "string" ? live.title : undefined,
    openedAt: typeof live.openedAt === "string" ? live.openedAt : undefined,
  };
}

async function sendLiveStartedMessage(
  target: PollTarget,
  liveStatus: LiveStatus,
) {
  const channelUrl = buildCimeChannelUrl(target.account.channelHandle);
  const channelImageUrl = target.account.channelImageUrl;
  const displayStartedAt = formatDiscordDateTime(liveStatus.openedAt);
  const watchLinksMarkdown = buildWatchLinksMarkdown(
    channelUrl,
    target.webhook.watchLinks,
  );
  const content = renderMessageTemplate(
    target.webhook.liveMessageTemplate ?? DEFAULT_LIVE_MESSAGE_TEMPLATE,
    target,
    liveStatus,
    channelUrl,
  );

  return await postDiscordWebhook(target.webhook.webhookUrl, {
    content,
    embeds: [
      {
        author: {
          name: target.account.channelName,
          ...(channelUrl ? { url: channelUrl } : {}),
          ...(channelImageUrl ? { icon_url: channelImageUrl } : {}),
        },
        title: liveStatus.title ?? "라이브 시작",
        url: channelUrl,
        color: 0xe5484d,
        ...(channelImageUrl ? { thumbnail: { url: channelImageUrl } } : {}),
        fields: [
          ...(watchLinksMarkdown
            ? [
                {
                  name: "시청하러 가기",
                  value: watchLinksMarkdown,
                  inline: false,
                },
              ]
            : []),
          {
            name: "시작",
            value: displayStartedAt,
            inline: true,
          },
        ],
      },
    ],
  });
}

async function sendStalePausedMessage(target: PollTarget) {
  const channelUrl = buildCimeChannelUrl(target.account.channelHandle);
  return await postDiscordWebhook(target.webhook.webhookUrl, {
    content: renderMessageTemplate(
      target.webhook.staleMessageTemplate ?? DEFAULT_STALE_MESSAGE_TEMPLATE,
      target,
      {},
      channelUrl,
    ),
  });
}

function renderMessageTemplate(
  template: string,
  target: PollTarget,
  liveStatus: Partial<LiveStatus>,
  channelUrl?: string,
) {
  const values: Record<string, string> = {
    channelName: target.account.channelName,
    channelHandle: target.account.channelHandle ?? "",
    channelUrl: channelUrl ?? "",
    liveTitle: liveStatus.title ?? "라이브 시작",
    startedAt: formatDiscordDateTime(liveStatus.openedAt),
  };

  return template.replace(
    /\{(channelName|channelHandle|channelUrl|liveTitle|startedAt)\}/g,
    (_, key: string) => values[key] ?? "",
  );
}
