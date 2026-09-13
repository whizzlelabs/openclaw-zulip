import { resolveZulipAccount } from "./config.js";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";

// ---------------------------------------------------------------------------
// Agent prompt adapter — Zulip-specific hints for the AI agent
// ---------------------------------------------------------------------------

export const zulipAgentPromptAdapter: NonNullable<ChannelPlugin["agentPrompt"]> = {
  messageToolHints({ cfg, accountId }) {
    const account = resolveZulipAccount(cfg, accountId);
    return [
      `This is a Zulip ${account.mode === "user" ? "user" : "bot"} account.`,
      "Zulip uses Markdown for formatting (bold, italic, code blocks, links, lists).",
      "Stream messages require a topic. Topics organize conversations within a stream.",
      "To find Zulip recipients, use conversations_list with channel=zulip and a display-name or visible-email query. Zulip may mask private email addresses, so search by name when email finds nothing. It lists user IDs and stream IDs, including bot users. Query <stream_id>/ to explore that stream's existing topics, then use the matching conversationRef with conversations_send or conversations_turn.",
      "For a new Zulip DM or topic when the message tool is available, send to user:<email_or_id> or stream:<name_or_id>/<topic>. A separate threadId can supply the topic. Do not use an unqualified numeric ID; it could identify either a user or a stream.",
      "Use @-mentions (@**Full Name**) to notify specific users.",
      "Emoji syntax: :emoji_name: (e.g. :thumbs_up:, :heart:).",
      "LaTeX math is supported: $$formula$$ for display, $formula$ for inline.",
    ];
  },

  reactionGuidance() {
    return {
      level: "extensive",
      channelLabel: "Zulip",
    };
  },
};
