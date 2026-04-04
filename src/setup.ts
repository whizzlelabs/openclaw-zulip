import { createPatchedAccountSetupAdapter } from "openclaw/plugin-sdk/setup";

const SECTION_KEY = "zulip";

export const zulipSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: SECTION_KEY,
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
});
