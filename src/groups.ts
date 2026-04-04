import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { CoreConfig } from "./types.js";
import { resolveZulipAccount } from "./config.js";

// ---------------------------------------------------------------------------
// Groups adapter — per-stream policies
// ---------------------------------------------------------------------------

export const zulipGroupsAdapter: NonNullable<ChannelPlugin["groups"]> = {
  resolveRequireMention({ cfg, accountId, groupId }) {
    const account = resolveZulipAccount(cfg as CoreConfig, accountId);
    if (!groupId) return undefined;

    // Check per-stream config for requireMention
    for (const [, streamConfig] of Object.entries(account.streams)) {
      if (streamConfig.requireMention) return true;
    }

    // Stream-specific lookup by name requires matching groupId to a stream name
    // groupId is the stream ID string — we can't resolve name without an API call,
    // so we rely on the streams config being keyed by name in the account config
    const streamConfig = account.streams[groupId];
    if (streamConfig?.requireMention !== undefined) return streamConfig.requireMention;

    return undefined;
  },

  resolveGroupIntroHint({ cfg, accountId }) {
    const account = resolveZulipAccount(cfg as CoreConfig, accountId);
    return `This is a Zulip ${account.mode === "user" ? "user" : "bot"} account. Messages in streams require a topic.`;
  },
};
