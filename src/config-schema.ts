import { z } from "openclaw/plugin-sdk/zod";
import {
  buildChannelConfigSchema,
  buildNestedDmConfigSchema,
  buildCatchallMultiAccountChannelSchema,
  AllowFromListSchema,
  DmPolicySchema,
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
  // Account-level DM controls — these are the fields the adapters actually read
  // (see security.ts and allowlist.ts). Keep them in sync with ZulipAccountConfig.
  dmPolicy: DmPolicySchema.optional(),
  allowFrom: AllowFromListSchema,
  // Nested form, accepted for parity with other channels' config layout.
  // NOTE: nothing reads this — resolveZulipAccount() only looks at the flat
  // dmPolicy/allowFrom above, so dm.policy/dm.allowFrom are inert. Either wire
  // it up or drop it; tracked in issue #44.
  dm: dmConfigSchema,
});

// Ack reactions are read from the channel section, not per account (gateway.ts).
const reactionsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  onStart: z.string().optional(),
  onSuccess: z.string().optional(),
  onError: z.string().optional(),
}).optional();

const channelSchema = buildCatchallMultiAccountChannelSchema(accountSchema).extend({
  reactions: reactionsConfigSchema,
});

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
