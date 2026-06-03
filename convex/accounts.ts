import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_MESSAGE_TEMPLATE_LENGTH = 280;

type AuthCtx = {
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
};

async function requireOwnerId(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("로그인이 필요합니다.");
  }
  return identity.subject;
}

async function ensureMonitor(
  db: any,
  ownerId: string,
  account: Doc<"cimeAccounts">,
  webhook: Doc<"discordWebhooks">,
  now: number,
) {
  const existing = await db
    .query("monitors")
    .withIndex("byOwner", (q: any) => q.eq("ownerId", ownerId))
    .unique();

  if (existing) {
    await db.patch(existing._id, {
      accountId: account._id,
      webhookId: webhook._id,
      channelId: account.channelId,
      nextPollAt:
        existing.status === "stalePaused" ? existing.nextPollAt : now,
      updatedAt: now,
    });
    return existing._id;
  }

  return await db.insert("monitors", {
    ownerId,
    accountId: account._id,
    webhookId: webhook._id,
    channelId: account.channelId,
    status: "active",
    nextPollAt: now,
    errorCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export const getSetup = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const account = await ctx.db
      .query("cimeAccounts")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .unique();
    const webhook = await ctx.db
      .query("discordWebhooks")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .unique();
    const monitor = await ctx.db
      .query("monitors")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .unique();
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(8);

    return {
      account,
      webhook: webhook
        ? {
            ...webhook,
            webhookUrl: maskWebhookUrl(webhook.webhookUrl),
          }
        : null,
      monitor,
      deliveries,
      policy: {
        baseIntervalMs: FIVE_MINUTES_MS,
        liveCooldownMs: 60 * 60 * 1000,
        stalePauseAfterMs: 30 * 24 * 60 * 60 * 1000,
      },
    };
  },
});

export const getDiscordWebhookTestTarget = internalQuery({
  args: {
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const webhook = await ctx.db
      .query("discordWebhooks")
      .withIndex("byOwner", (q) => q.eq("ownerId", args.ownerId))
      .unique();
    const account = await ctx.db
      .query("cimeAccounts")
      .withIndex("byOwner", (q) => q.eq("ownerId", args.ownerId))
      .unique();

    return { webhook, account };
  },
});

export const reactivateMonitor = mutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const monitor = await ctx.db
      .query("monitors")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .unique();

    if (!monitor) {
      throw new Error("재개할 모니터가 없습니다.");
    }

    const now = Date.now();
    await ctx.db.patch(monitor._id, {
      status: "active",
      nextPollAt: now,
      offlineSince: now,
      stalePausedAt: undefined,
      offlineNoticeSentAt: undefined,
      lastError: undefined,
      errorCount: 0,
      updatedAt: now,
    });
  },
});

export const removeCimeAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const account = await ctx.db
      .query("cimeAccounts")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .unique();
    const monitor = await ctx.db
      .query("monitors")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .unique();

    if (monitor) {
      await ctx.db.delete(monitor._id);
    }
    if (account) {
      await ctx.db.delete(account._id);
    }
  },
});

export const removeDiscordWebhook = mutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const webhook = await ctx.db
      .query("discordWebhooks")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .unique();
    const monitor = await ctx.db
      .query("monitors")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .unique();

    if (monitor) {
      await ctx.db.delete(monitor._id);
    }
    if (webhook) {
      await ctx.db.delete(webhook._id);
    }
  },
});

export const upsertLinkedAccount = internalMutation({
  args: {
    ownerId: v.string(),
    channelId: v.string(),
    channelName: v.string(),
    channelHandle: v.optional(v.string()),
    channelImageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const taken = await ctx.db
      .query("cimeAccounts")
      .withIndex("byChannel", (q) => q.eq("channelId", args.channelId))
      .unique();

    if (taken && taken.ownerId !== args.ownerId) {
      throw new Error("이미 다른 사용자가 연동한 CI.ME 채널입니다.");
    }

    const current = await ctx.db
      .query("cimeAccounts")
      .withIndex("byOwner", (q) => q.eq("ownerId", args.ownerId))
      .unique();

    let accountId: Id<"cimeAccounts">;
    if (current) {
      accountId = current._id;
      await ctx.db.patch(current._id, {
        channelId: args.channelId,
        channelName: args.channelName,
        channelHandle: args.channelHandle,
        channelImageUrl: args.channelImageUrl,
        updatedAt: now,
      });
    } else {
      accountId = await ctx.db.insert("cimeAccounts", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        channelName: args.channelName,
        channelHandle: args.channelHandle,
        channelImageUrl: args.channelImageUrl,
        linkedAt: now,
        updatedAt: now,
      });
    }

    const account = (await ctx.db.get(accountId))!;
    const webhook = await ctx.db
      .query("discordWebhooks")
      .withIndex("byOwner", (q) => q.eq("ownerId", args.ownerId))
      .unique();

    if (webhook && webhook.enabled) {
      await ensureMonitor(ctx.db, args.ownerId, account, webhook, now);
    }

    return account;
  },
});

export const upsertDiscordWebhook = internalMutation({
  args: {
    ownerId: v.string(),
    webhookUrl: v.string(),
    webhookId: v.optional(v.string()),
    channelId: v.optional(v.string()),
    guildId: v.optional(v.string()),
    name: v.optional(v.string()),
    liveMessageTemplate: v.optional(v.string()),
    staleMessageTemplate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const liveMessageTemplate = normalizeMessageTemplate(
      args.liveMessageTemplate,
    );
    const staleMessageTemplate = normalizeMessageTemplate(
      args.staleMessageTemplate,
    );
    const current = await ctx.db
      .query("discordWebhooks")
      .withIndex("byOwner", (q) => q.eq("ownerId", args.ownerId))
      .unique();

    let webhookId: Id<"discordWebhooks">;
    if (current) {
      webhookId = current._id;
      await ctx.db.patch(current._id, {
        webhookUrl: args.webhookUrl,
        webhookId: args.webhookId,
        channelId: args.channelId,
        guildId: args.guildId,
        name: args.name,
        liveMessageTemplate,
        staleMessageTemplate,
        enabled: true,
        updatedAt: now,
      });
    } else {
      webhookId = await ctx.db.insert("discordWebhooks", {
        ownerId: args.ownerId,
        webhookUrl: args.webhookUrl,
        webhookId: args.webhookId,
        channelId: args.channelId,
        guildId: args.guildId,
        name: args.name,
        liveMessageTemplate,
        staleMessageTemplate,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const webhook = (await ctx.db.get(webhookId))!;
    const account = await ctx.db
      .query("cimeAccounts")
      .withIndex("byOwner", (q) => q.eq("ownerId", args.ownerId))
      .unique();

    if (account) {
      await ensureMonitor(ctx.db, args.ownerId, account, webhook, now);
    }

    return {
      ...webhook,
      webhookUrl: maskWebhookUrl(webhook.webhookUrl),
    };
  },
});

export const updateDiscordNotificationSettings = mutation({
  args: {
    liveMessageTemplate: v.string(),
    staleMessageTemplate: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const webhook = await ctx.db
      .query("discordWebhooks")
      .withIndex("byOwner", (q) => q.eq("ownerId", ownerId))
      .unique();

    if (!webhook) {
      throw new Error("먼저 Discord webhook을 저장해야 합니다.");
    }

    await ctx.db.patch(webhook._id, {
      liveMessageTemplate: normalizeMessageTemplate(args.liveMessageTemplate),
      staleMessageTemplate: normalizeMessageTemplate(args.staleMessageTemplate),
      updatedAt: Date.now(),
    });
  },
});

function maskWebhookUrl(webhookUrl: string) {
  const prefix = "https://discord.com/api/webhooks/";
  if (!webhookUrl.startsWith(prefix)) {
    return "Webhook URL 숨김";
  }
  return `${prefix}...`;
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
