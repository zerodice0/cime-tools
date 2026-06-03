import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { formatDiscordDateTime } from "./discordTime";

type AuthCtx = {
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
};

type DiscordWebhookMetadata = {
  id?: string;
  channel_id?: string;
  guild_id?: string;
  name?: string;
};

export type DiscordPostResult = {
  ok: boolean;
  status: number;
  error?: string;
};

const DEFAULT_LIVE_MESSAGE_TEMPLATE =
  "{channelName} 라이브가 시작되었습니다.";
const MAX_MESSAGE_TEMPLATE_LENGTH = 280;

async function requireOwnerId(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("로그인이 필요합니다.");
  }
  return identity.subject;
}

export const saveWebhook = action({
  args: {
    webhookUrl: v.string(),
    liveMessageTemplate: v.optional(v.string()),
    staleMessageTemplate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const ownerId = await requireOwnerId(ctx);
    const webhookUrl = normalizeDiscordWebhookUrl(args.webhookUrl);
    const metadata = await fetchDiscordWebhookMetadata(webhookUrl);

    await ctx.runMutation(internal.accounts.upsertDiscordWebhook, {
      ownerId,
      webhookUrl,
      webhookId: metadata.id,
      channelId: metadata.channel_id,
      guildId: metadata.guild_id,
      name: metadata.name,
      liveMessageTemplate: args.liveMessageTemplate,
      staleMessageTemplate: args.staleMessageTemplate,
    });
    return { ok: true };
  },
});

export const testWebhook = action({
  args: {
    webhookUrl: v.optional(v.string()),
    liveMessageTemplate: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; status: number; webhookName?: string }> => {
    const ownerId = await requireOwnerId(ctx);
    const savedTarget = (await ctx.runQuery(
      internal.accounts.getDiscordWebhookTestTarget,
      { ownerId },
    )) as {
      webhook: Doc<"discordWebhooks"> | null;
      account: Doc<"cimeAccounts"> | null;
    };

    const rawWebhookUrl = args.webhookUrl?.trim();
    let webhookUrl: string;
    let metadata: DiscordWebhookMetadata = {};

    if (rawWebhookUrl) {
      webhookUrl = normalizeDiscordWebhookUrl(rawWebhookUrl);
      metadata = await fetchDiscordWebhookMetadata(webhookUrl);
    } else if (savedTarget.webhook) {
      webhookUrl = normalizeDiscordWebhookUrl(savedTarget.webhook.webhookUrl);
      metadata = {
        id: savedTarget.webhook.webhookId,
        channel_id: savedTarget.webhook.channelId,
        guild_id: savedTarget.webhook.guildId,
        name: savedTarget.webhook.name,
      };
    } else {
      throw new Error("테스트할 Discord webhook URL이 필요합니다.");
    }

    const result = await postDiscordWebhook(
      webhookUrl,
      buildTestDiscordMessage({
        account: savedTarget.account,
        liveMessageTemplate: args.liveMessageTemplate,
      }),
    );

    if (!result.ok) {
      throw new Error(result.error ?? `Discord webhook 오류: HTTP ${result.status}`);
    }

    return {
      ok: true,
      status: result.status,
      webhookName: metadata.name,
    };
  },
});

export async function postDiscordWebhook(
  webhookUrl: string,
  body: {
    content?: string;
    embeds?: Array<Record<string, unknown>>;
  },
): Promise<DiscordPostResult> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...body,
      allowed_mentions: { parse: [] },
    }),
  });

  if (response.ok) {
    return { ok: true, status: response.status };
  }

  const payload = await response.json().catch(() => null);
  const retryAfter =
    payload &&
    typeof payload === "object" &&
    "retry_after" in payload &&
    typeof payload.retry_after === "number"
      ? ` retry_after=${payload.retry_after}s`
      : "";

  return {
    ok: false,
    status: response.status,
    error: `Discord webhook 오류: HTTP ${response.status}${retryAfter}`,
  };
}

function normalizeDiscordWebhookUrl(rawValue: string) {
  let url: URL;
  try {
    url = new URL(rawValue.trim());
  } catch {
    throw new Error("Discord webhook URL 형식이 올바르지 않습니다.");
  }

  const allowedHost =
    url.hostname === "discord.com" || url.hostname === "discordapp.com";
  const parts = url.pathname.split("/").filter(Boolean);
  const isWebhookPath =
    parts.length >= 4 && parts[0] === "api" && parts[1] === "webhooks";

  if (url.protocol !== "https:" || !allowedHost || !isWebhookPath) {
    throw new Error("Discord webhook URL만 저장할 수 있습니다.");
  }

  url.hostname = "discord.com";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function fetchDiscordWebhookMetadata(
  webhookUrl: string,
): Promise<DiscordWebhookMetadata> {
  const response = await fetch(webhookUrl);
  if (!response.ok) {
    throw new Error(`Discord webhook 확인 실패: HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    throw new Error("Discord webhook 응답을 해석할 수 없습니다.");
  }

  const data = payload as DiscordWebhookMetadata;

  return {
    id: data.id,
    channel_id: data.channel_id,
    guild_id: data.guild_id,
    name: data.name,
  };
}

function buildTestDiscordMessage({
  account,
  liveMessageTemplate,
}: {
  account: Doc<"cimeAccounts"> | null;
  liveMessageTemplate?: string;
}) {
  const startedAt = new Date().toISOString();
  const displayStartedAt = formatDiscordDateTime(startedAt);
  const channelHandle = account?.channelHandle?.replace(/^@/, "");
  const channelUrl = channelHandle ? `https://ci.me/${channelHandle}` : "";
  const channelName = account?.channelName ?? "내 채널";
  const channelImageUrl = account?.channelImageUrl;
  const content = renderMessageTemplate(
    normalizeMessageTemplate(liveMessageTemplate) ?? DEFAULT_LIVE_MESSAGE_TEMPLATE,
    {
      channelName,
      channelHandle: channelHandle ?? "",
      channelUrl,
      liveTitle: "테스트 라이브 알림",
      startedAt: displayStartedAt,
    },
  );

  return {
    content: `[테스트] ${content}`,
    embeds: [
      {
        author: {
          name: channelName,
          ...(channelUrl ? { url: channelUrl } : {}),
          ...(channelImageUrl ? { icon_url: channelImageUrl } : {}),
        },
        title: "테스트 라이브 알림",
        description: "실제 라이브 알림이 아닙니다.",
        ...(channelUrl ? { url: channelUrl } : {}),
        color: 0x7c4dff,
        ...(channelImageUrl ? { thumbnail: { url: channelImageUrl } } : {}),
        fields: [
          {
            name: "CI.ME 채널",
            value: channelName,
            inline: true,
          },
          {
            name: "시작 시간",
            value: displayStartedAt,
            inline: true,
          },
        ],
      },
    ],
  };
}

function renderMessageTemplate(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(
    /\{(channelName|channelHandle|channelUrl|liveTitle|startedAt)\}/g,
    (_, key: string) => values[key] ?? "",
  );
}

function normalizeMessageTemplate(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > MAX_MESSAGE_TEMPLATE_LENGTH) {
    throw new Error(
      `Discord 메시지는 ${MAX_MESSAGE_TEMPLATE_LENGTH}자 이하여야 합니다.`,
    );
  }
  return normalized;
}
