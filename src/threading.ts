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
};
