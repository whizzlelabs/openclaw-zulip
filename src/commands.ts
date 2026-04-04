import type { ChannelPlugin } from "openclaw/plugin-sdk/core";

// ---------------------------------------------------------------------------
// Command adapter
// ---------------------------------------------------------------------------

export const zulipCommandAdapter: NonNullable<ChannelPlugin["commands"]> = {
  enforceOwnerForCommands: true,
};
