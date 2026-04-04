import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { resolveZulipAccount } from "./config.js";
import type { CoreConfig } from "./types.js";

export const zulipThreadingAdapter: NonNullable<ChannelPlugin["threading"]> = {
  resolveReplyToMode({ cfg, accountId }) {
    const account = resolveZulipAccount(cfg as CoreConfig, accountId);
    const mode = account.replyToMode;
    if (mode === "off" || mode === "first" || mode === "all") return mode;
    return "all";
  },

  resolveFocusedBinding({ context }) {
    // Zulip: To = stream id, MessageThreadId = topic name
    const streamId = context.To;
    const topic = context.MessageThreadId ?? context.ThreadLabel;
    if (!streamId || !topic) return null;

    const conversationId = `${streamId}/${topic}`;
    return {
      conversationId,
      parentConversationId: String(streamId),
      placement: "current",
      labelNoun: "topic",
    };
  },
};
