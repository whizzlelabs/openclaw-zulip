import { z } from "zod";
import {
  buildChannelConfigSchema,
  buildNestedDmConfigSchema,
  buildCatchallMultiAccountChannelSchema,
} from "openclaw/plugin-sdk/channel-config-schema";

// ---------------------------------------------------------------------------
// Zulip account config schema (Zod)
// ---------------------------------------------------------------------------

const streamConfigSchema = z.object({
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).strict().optional();

const dmConfigSchema = buildNestedDmConfigSchema();

const accountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  mode: z.enum(["bot", "user"]).optional(),
  serverUrl: z.string().optional(),
  email: z.string().optional(),
  apiKey: z.string().optional(),
  replyToMode: z.string().optional(),
  streams: z.record(z.string(), streamConfigSchema).optional(),
  dm: dmConfigSchema,
});

const channelSchema = buildCatchallMultiAccountChannelSchema(accountSchema);

// ---------------------------------------------------------------------------
// Config schema export
// ---------------------------------------------------------------------------

export const zulipConfigSchema = buildChannelConfigSchema(channelSchema, {
  uiHints: {
    serverUrl: { label: "Server URL", placeholder: "https://org.zulipchat.com" },
    email: { label: "Bot email", placeholder: "bot@org.zulipchat.com" },
    apiKey: { label: "API key", sensitive: true },
    mode: { label: "Account mode", help: "bot (default) or user" },
  },
});
