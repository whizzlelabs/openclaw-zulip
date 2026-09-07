import type { DmPolicy, OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";

// ---------------------------------------------------------------------------
// Account mode
// ---------------------------------------------------------------------------

export type ZulipAccountMode = "bot" | "user";

// ---------------------------------------------------------------------------
// Stream-level config
// ---------------------------------------------------------------------------

export type ZulipStreamConfig = {
  requireMention?: boolean;
  enabled?: boolean;
};

// ---------------------------------------------------------------------------
// Raw account config (as written in the config file)
// ---------------------------------------------------------------------------

export type ZulipAccountConfig = {
  name?: string;
  enabled?: boolean;
  mode?: ZulipAccountMode;
  serverUrl?: string;
  email?: string;
  apiKey?: string;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  replyToMode?: string;
  streams?: Record<string, ZulipStreamConfig>;
};

// ---------------------------------------------------------------------------
// Ack reactions (section-level — emoji applied to an inbound message while the
// agent works on it, then swapped for a terminal emoji)
// ---------------------------------------------------------------------------

export type ZulipReactionsConfig = {
  enabled?: boolean;
  onStart?: string;
  onSuccess?: string;
  onError?: string;
};

// ---------------------------------------------------------------------------
// Channel section shape (root config → channels.zulip)
// ---------------------------------------------------------------------------

export type ZulipChannelConfig = ZulipAccountConfig & {
  defaultAccount?: string;
  accounts?: Record<string, ZulipAccountConfig>;
  reactions?: ZulipReactionsConfig;
};

// ---------------------------------------------------------------------------
// Resolved account (hydrated, defaults applied)
// ---------------------------------------------------------------------------

export type ZulipResolvedAccount = {
  accountId: string;
  mode: ZulipAccountMode;
  serverUrl: string;
  email: string;
  apiKey: string;
  enabled: boolean;
  configured: boolean;
  dmPolicy: DmPolicy;
  allowFrom: Array<string | number>;
  replyToMode: string;
  streams: Record<string, ZulipStreamConfig>;
};

// ---------------------------------------------------------------------------
// Config accessor helper
// ---------------------------------------------------------------------------

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    zulip?: ZulipChannelConfig;
  };
};

export function getZulipSection(cfg: OpenClawConfig): ZulipChannelConfig | undefined {
  return (cfg as CoreConfig).channels?.zulip;
}
