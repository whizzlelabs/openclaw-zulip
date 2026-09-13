import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { CoreConfig } from "./types.js";
import { resolveZulipAccount } from "./config.js";

const SECTION_KEY = "zulip";

// ---------------------------------------------------------------------------
// Allowlist adapter — DM allow-from management. The group list is reported to
// the SDK but edited through account config, not this DM-only adapter.
// ---------------------------------------------------------------------------

export const zulipAllowlistAdapter: NonNullable<ChannelPlugin["allowlist"]> = {
  applyConfigEdit({ cfg, parsedConfig, accountId, scope, action, entry }) {
    if (scope !== "dm") return { kind: "invalid-entry" };

    const id = accountId ?? "default";
    const path = `channels.${SECTION_KEY}.accounts.${id}.allowFrom`;

    // Read the effective allowlist, including the nested DM form, before
    // writing the edited result to the canonical flat account field.
    const current = resolveZulipAccount(cfg as CoreConfig, id).allowFrom;

    let next: Array<string | number>;
    if (action === "add") {
      if (current.some((value) => String(value) === entry)) {
        return { kind: "ok", changed: false, pathLabel: path, writeTarget: { kind: "global" } };
      }
      next = [...current, entry];
    } else {
      next = current.filter((value) => String(value) !== entry);
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
      groupAllowFrom: account.groupAllowFrom,
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
