import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const CIME_API_BASE = "https://ci.me/api/openapi";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

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

export const beginLink = action({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const clientId = requireEnv("CIME_CLIENT_ID");
    const redirectUri = requireEnv("CIME_REDIRECT_URI");
    const state = randomState();
    const now = Date.now();

    await ctx.runMutation(internal.cime.createOAuthState, {
      ownerId,
      state,
      redirectUri,
      expiresAt: now + OAUTH_STATE_TTL_MS,
      createdAt: now,
    });

    const url = new URL("https://ci.me/auth/openapi/account-interlock");
    url.searchParams.set("clientId", clientId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);

    return { authorizationUrl: url.toString() };
  },
});

export const completeLink = action({
  args: {
    code: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const ownerId = await requireOwnerId(ctx);
    await ctx.runMutation(internal.cime.consumeOAuthState, {
      ownerId,
      state: args.state,
      now: Date.now(),
    });

    const clientId = requireEnv("CIME_CLIENT_ID");
    const clientSecret = requireEnv("CIME_CLIENT_SECRET");

    const token = await postCimeJson<{
      accessToken: string;
      refreshToken?: string;
      tokenType?: string;
      expiresIn?: string | number;
      scope?: string;
    }>("/auth/v1/token", {
      grantType: "authorization_code",
      clientId,
      clientSecret,
      code: args.code,
    });

    let me: {
      channelId: string;
      channelName: string;
      channelHandle?: string | null;
      channelImageUrl?: string | null;
    };
    try {
      me = await getCimeJson<{
        channelId: string;
        channelName: string;
        channelHandle?: string | null;
        channelImageUrl?: string | null;
      }>("/open/v1/users/me", {
        Authorization: `Bearer ${token.accessToken}`,
      });
    } finally {
      await revokeToken(clientId, clientSecret, token.accessToken, "access_token");
      if (token.refreshToken) {
        await revokeToken(
          clientId,
          clientSecret,
          token.refreshToken,
          "refresh_token",
        );
      }
    }

    await ctx.runMutation(internal.accounts.upsertLinkedAccount, {
      ownerId,
      channelId: me.channelId,
      channelName: me.channelName,
      channelHandle: me.channelHandle ?? undefined,
      channelImageUrl: me.channelImageUrl ?? undefined,
    });

    return { ok: true };
  },
});

export const createOAuthState = internalMutation({
  args: {
    ownerId: v.string(),
    state: v.string(),
    redirectUri: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("oauthStates")
      .withIndex("byOwner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    await Promise.all(existing.map((row) => ctx.db.delete(row._id)));
    await ctx.db.insert("oauthStates", args);
  },
});

export const consumeOAuthState = internalMutation({
  args: {
    ownerId: v.string(),
    state: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("byState", (q) => q.eq("state", args.state))
      .unique();

    if (!row || row.ownerId !== args.ownerId) {
      throw new Error("CI.ME 연동 요청을 확인할 수 없습니다.");
    }
    if (row.expiresAt < args.now) {
      await ctx.db.delete(row._id);
      throw new Error("CI.ME 연동 요청이 만료되었습니다.");
    }

    await ctx.db.delete(row._id);
  },
});

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경 변수가 필요합니다.`);
  }
  return value;
}

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function postCimeJson<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${CIME_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return await readCimeContent<T>(response);
}

async function getCimeJson<T>(path: string, headers: Record<string, string>) {
  const response = await fetch(`${CIME_API_BASE}${path}`, { headers });
  return await readCimeContent<T>(response);
}

async function readCimeContent<T>(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`CI.ME API 오류: HTTP ${response.status}`);
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("CI.ME API 응답을 해석할 수 없습니다.");
  }
  const envelope = payload as { code?: number; message?: string; content?: T };
  if (typeof envelope.code === "number" && envelope.code !== 200) {
    throw new Error(envelope.message ?? `CI.ME API 오류: code ${envelope.code}`);
  }
  if (!("content" in envelope)) {
    return payload as T;
  }
  if (!envelope.content) {
    throw new Error("CI.ME API 응답에 content가 없습니다.");
  }
  return envelope.content;
}

async function revokeToken(
  clientId: string,
  clientSecret: string,
  token: string,
  tokenTypeHint: "access_token" | "refresh_token",
) {
  await fetch(`${CIME_API_BASE}/auth/v1/token/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientId,
      clientSecret,
      token,
      tokenTypeHint,
    }),
  }).catch(() => undefined);
}
