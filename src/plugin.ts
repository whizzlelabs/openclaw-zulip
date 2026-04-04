import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ZulipResolvedAccount } from "./types.js";
import { zulipConfigAdapter } from "./config.js";
import { zulipSetupAdapter } from "./setup.js";
import { zulipSecurityAdapter } from "./security.js";
import { zulipGatewayAdapter } from "./gateway.js";
import { zulipOutboundAdapter } from "./outbound.js";
import { zulipThreadingAdapter } from "./threading.js";
import { zulipMessagingAdapter } from "./messaging.js";

export const zulipPlugin: ChannelPlugin<ZulipResolvedAccount> = createChatChannelPlugin({
  base: {
    id: "zulip",
    meta: {
      id: "zulip",
      label: "Zulip",
      selectionLabel: "Zulip",
      docsPath: "/docs/channels/zulip",
      blurb: "Connect OpenClaw to Zulip for streams, topics, and DMs.",
    },
    capabilities: {
      chatTypes: ["direct", "group", "thread"],
      reactions: false,
      edit: false,
      unsend: false,
      reply: true,
      threads: true,
      media: false,
      nativeCommands: false,
      polls: false,
      effects: false,
      groupManagement: false,
      blockStreaming: false,
    },
    config: zulipConfigAdapter,
    setup: zulipSetupAdapter,
    gateway: zulipGatewayAdapter,
    messaging: zulipMessagingAdapter,
    reload: {
      configPrefixes: ["channels.zulip"],
    },
  },
  security: zulipSecurityAdapter,
  threading: zulipThreadingAdapter,
  outbound: zulipOutboundAdapter,
});
