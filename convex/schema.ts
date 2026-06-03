import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  oauthStates: defineTable({
    ownerId: v.string(),
    state: v.string(),
    redirectUri: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("byOwner", ["ownerId"])
    .index("byState", ["state"]),

  cimeAccounts: defineTable({
    ownerId: v.string(),
    channelId: v.string(),
    channelName: v.string(),
    channelHandle: v.optional(v.string()),
    channelImageUrl: v.optional(v.string()),
    linkedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("byOwner", ["ownerId"])
    .index("byChannel", ["channelId"]),

  discordWebhooks: defineTable({
    ownerId: v.string(),
    webhookUrl: v.string(),
    webhookId: v.optional(v.string()),
    channelId: v.optional(v.string()),
    guildId: v.optional(v.string()),
    name: v.optional(v.string()),
    liveMessageTemplate: v.optional(v.string()),
    staleMessageTemplate: v.optional(v.string()),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("byOwner", ["ownerId"]),

  monitors: defineTable({
    ownerId: v.string(),
    accountId: v.id("cimeAccounts"),
    webhookId: v.id("discordWebhooks"),
    channelId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("stalePaused"),
      v.literal("errored"),
    ),
    nextPollAt: v.number(),
    lastCheckedAt: v.optional(v.number()),
    lastIsLive: v.optional(v.boolean()),
    lastLiveTitle: v.optional(v.string()),
    lastOpenedAt: v.optional(v.string()),
    lastNotifiedOpenedAt: v.optional(v.string()),
    lastLiveNotifiedAt: v.optional(v.number()),
    cooldownUntil: v.optional(v.number()),
    offlineSince: v.optional(v.number()),
    offlineNoticeSentAt: v.optional(v.number()),
    stalePausedAt: v.optional(v.number()),
    errorCount: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("byOwner", ["ownerId"])
    .index("byStatusNextPoll", ["status", "nextPollAt"])
    .index("byChannel", ["channelId"]),

  deliveries: defineTable({
    ownerId: v.string(),
    monitorId: v.id("monitors"),
    type: v.union(v.literal("liveStarted"), v.literal("stalePaused")),
    openedAt: v.optional(v.string()),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
    responseStatus: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("byOwner", ["ownerId"])
    .index("byMonitor", ["monitorId"])
    .index("byMonitorOpenedAt", ["monitorId", "openedAt"]),
});
