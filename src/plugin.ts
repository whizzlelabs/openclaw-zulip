import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ZulipResolvedAccount } from "./types.js";
import type { ZulipProbe } from "./status.js";
import { zulipConfigAdapter } from "./config.js";
import { zulipConfigSchema } from "./config-schema.js";
import { zulipSetupAdapter } from "./setup.js";
import { zulipSecurityAdapter } from "./security.js";
import { zulipGatewayAdapter } from "./gateway.js";
import { zulipOutboundAdapter } from "./outbound.js";
import { zulipThreadingAdapter } from "./threading.js";
import { zulipMessagingAdapter } from "./messaging.js";
import { zulipActionsAdapter } from "./actions.js";
import { zulipBindingsAdapter, zulipConversationBindingsSupport } from "./bindings.js";
import { zulipStatusAdapter } from "./status.js";
import { zulipDirectoryAdapter } from "./directory.js";
import { zulipResolverAdapter } from "./resolver.js";
import { zulipAgentPromptAdapter } from "./agent-prompt.js";
import { zulipGroupsAdapter } from "./groups.js";
import { zulipCommandAdapter } from "./commands.js";
import { zulipAllowlistAdapter } from "./allowlist.js";

export const zulipPlugin: ChannelPlugin<ZulipResolvedAccount, ZulipProbe> = createChatChannelPlugin({
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
      reactions: true,
      edit: true,
      unsend: true,
      reply: true,
      threads: true,
      media: true,
      nativeCommands: false,
      polls: false,
      effects: false,
      groupManagement: false,
      blockStreaming: false,
    },
    config: zulipConfigAdapter,
    configSchema: zulipConfigSchema,
    setup: zulipSetupAdapter,
    status: zulipStatusAdapter,
    gateway: zulipGatewayAdapter,
    messaging: zulipMessagingAdapter,
    actions: zulipActionsAdapter,
    bindings: zulipBindingsAdapter,
    conversationBindings: zulipConversationBindingsSupport,
    directory: zulipDirectoryAdapter,
    resolver: zulipResolverAdapter,
    agentPrompt: zulipAgentPromptAdapter,
    groups: zulipGroupsAdapter,
    commands: zulipCommandAdapter,
    allowlist: zulipAllowlistAdapter,
    reload: {
      configPrefixes: ["channels.zulip"],
    },
  },
  security: zulipSecurityAdapter,
  threading: zulipThreadingAdapter,
  outbound: zulipOutboundAdapter,
});
