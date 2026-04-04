import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { CoreConfig } from "./types.js";
import { resolveZulipAccount } from "./config.js";

const SECTION_KEY = "zulip";

// ---------------------------------------------------------------------------
// Allowlist adapter — DM allow-from management
// ---------------------------------------------------------------------------

export const zulipAllowlistAdapter: NonNullable<ChannelPlugin["allowlist"]> = {
  applyConfigEdit({ cfg, parsedConfig, accountId, scope, action, entry }) {
    if (scope !== "dm") return { kind: "invalid-entry" };

    const id = accountId ?? "default";
    const path = `channels.${SECTION_KEY}.accounts.${id}.allowFrom`;

    // Read current allowFrom
    const section = (cfg as CoreConfig).channels?.zulip;
    const accountCfg = section?.accounts?.[id];
    const current: Array<string | number> = accountCfg?.allowFrom ?? section?.allowFrom ?? [];

    let next: Array<string | number>;
    if (action === "add") {
      if (current.includes(entry)) return { kind: "ok", changed: false, pathLabel: path, writeTarget: { kind: "global" } };
      next = [...current, entry];
    } else {
      next = current.filter((e) => e !== entry);
      if (next.length === current.length) return { kind: "ok", changed: false, pathLabel: path, writeTarget: { kind: "global" } };
    }

    // Apply to parsed config
    const accounts = (parsedConfig as Record<string, unknown>).accounts as Record<string, Record<string, unknown>> | undefined ?? {};
    const acct = accounts[id] ?? {};
    acct.allowFrom = next;
    accounts[id] = acct;
    (parsedConfig as Record<string, unknown>).accounts = accounts;

    return { kind: "ok", changed: true, pathLabel: path, writeTarget: { kind: "global" } };
  },

  readConfig({ cfg, accountId }) {
    const account = resolveZulipAccount(cfg as CoreConfig, accountId);
    return {
      dmAllowFrom: account.allowFrom,
      dmPolicy: account.dmPolicy,
    };
  },

  resolveNames({ entries }) {
    // Zulip entries are emails or user IDs — no transformation needed
    return entries.map((input) => ({ input, resolved: true, name: input }));
  },

  supportsScope({ scope }) {
    return scope === "dm" || scope === "all";
  },
};
