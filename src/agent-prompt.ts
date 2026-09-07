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
