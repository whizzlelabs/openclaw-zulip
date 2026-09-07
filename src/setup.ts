import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { defineChannelSetupContract } from "openclaw/plugin-sdk/channel-setup";
import { createPatchedAccountSetupAdapter } from "openclaw/plugin-sdk/setup";

type ZulipSetupInput = {
  name?: string;
  url?: string;
  userId?: string;
  token?: string;
};

export const zulipSetupContract: NonNullable<ChannelPlugin["setupContract"]> = defineChannelSetupContract({
  fields: {
    url: { kind: "string", cli: { flags: "--url <url>", description: "Zulip server URL" } },
    userId: { kind: "string", cli: { flags: "--user-id <email>", description: "Zulip bot email" } },
    token: { kind: "string", sensitive: true, cli: { flags: "--token <key>", description: "Zulip API key" } },
  },
  adapter: createPatchedAccountSetupAdapter<ZulipSetupInput>({
    channelKey: "zulip",
    alwaysUseAccounts: true,
    ensureChannelEnabled: true,
    ensureAccountEnabled: true,

    validateInput({ input }) {
      if (!input.url?.trim()) return "Server URL is required.";
      if (!input.userId?.trim()) return "Bot email is required.";
      if (!input.token?.trim()) return "API key is required.";
      return null;
    },

    buildPatch(input) {
      return {
        serverUrl: input.url!.trim().replace(/\/+$/, ""),
        email: input.userId!.trim(),
        apiKey: input.token!.trim(),
      };
    },
  }),
});
