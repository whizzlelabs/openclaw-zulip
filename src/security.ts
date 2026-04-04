import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { buildAccountScopedDmSecurityPolicy } from "openclaw/plugin-sdk/channel-config-helpers";
import type { ZulipResolvedAccount } from "./types.js";

export const zulipSecurityAdapter: NonNullable<ChannelPlugin<ZulipResolvedAccount>["security"]> = {
  resolveDmPolicy({ cfg, accountId, account }) {
    return buildAccountScopedDmSecurityPolicy({
      cfg,
      channelKey: "zulip",
      accountId,
      policy: account.dmPolicy,
      allowFrom: account.allowFrom,
      approveChannelId: "zulip",
      approveHint: "Send a DM to the bot in Zulip.",
    });
  },
};
