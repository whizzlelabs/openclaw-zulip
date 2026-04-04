import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ZulipResolvedAccount } from "./types.js";
import { ZulipClient } from "./zulip-client.js";

// ---------------------------------------------------------------------------
// Probe result
// ---------------------------------------------------------------------------

export type ZulipProbe = {
  ok: boolean;
  error?: string | null;
  elapsedMs: number;
  user?: {
    userId: number;
    email: string;
    fullName: string;
  };
};

// ---------------------------------------------------------------------------
// Status adapter
// ---------------------------------------------------------------------------

export const zulipStatusAdapter: NonNullable<
  ChannelPlugin<ZulipResolvedAccount, ZulipProbe>["status"]
> = {
  async probeAccount({ account, timeoutMs }) {
    const start = Date.now();
    try {
      const client = new ZulipClient({
        serverUrl: account.serverUrl,
        email: account.email,
        apiKey: account.apiKey,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const self = await client.getOwnUser();
        return {
          ok: true,
          elapsedMs: Date.now() - start,
          user: {
            userId: self.user_id,
            email: self.email,
            fullName: self.full_name,
          },
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - start,
      };
    }
  },

  buildAccountSnapshot({ account, runtime }) {
    return {
      accountId: account.accountId,
      name: `${account.email} (${account.mode})`,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      lastConnectedAt: runtime?.lastConnectedAt ?? null,
    };
  },

  collectStatusIssues(accounts) {
    const issues: Array<{ channel: string; accountId: string; kind: "config" | "runtime"; message: string }> = [];
    for (const snap of accounts) {
      if (snap.enabled && !snap.configured) {
        issues.push({
          channel: "zulip",
          accountId: snap.accountId,
          kind: "config",
          message: `Account "${snap.accountId}" is enabled but not configured (missing serverUrl, email, or apiKey).`,
        });
      }
      if (snap.enabled && snap.configured && !snap.connected) {
        issues.push({
          channel: "zulip",
          accountId: snap.accountId,
          kind: "runtime",
          message: `Account "${snap.accountId}" is not connected.`,
        });
      }
    }
    return issues;
  },
};
