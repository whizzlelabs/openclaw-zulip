import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import {
  createScopedChannelConfigAdapter,
  mapAllowFromEntries,
} from "openclaw/plugin-sdk/channel-config-helpers";
import {
  createAccountListHelpers,
  normalizeAccountId,
  resolveMergedAccountConfig,
} from "openclaw/plugin-sdk/account-resolution";
import type { ZulipResolvedAccount, ZulipAccountConfig, CoreConfig } from "./types.js";
import { getZulipSection } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECTION_KEY = "zulip";

// ---------------------------------------------------------------------------
// Account list / default-id helpers (shared SDK utility)
// ---------------------------------------------------------------------------

const { listAccountIds: listZulipAccountIds, resolveDefaultAccountId } =
  createAccountListHelpers(SECTION_KEY);

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

export function resolveZulipAccount(
  cfg: CoreConfig,
  accountId?: string | null,
): ZulipResolvedAccount {
  const id = normalizeAccountId(accountId);
  const section = getZulipSection(cfg);

  const merged = resolveMergedAccountConfig<ZulipAccountConfig>({
    channelConfig: section as ZulipAccountConfig | undefined,
    accounts: section?.accounts as Record<string, Partial<ZulipAccountConfig>> | undefined,
    accountId: id,
    omitKeys: ["accounts", "defaultAccount"],
  });

  const serverUrl = (merged.serverUrl ?? "").trim();
  const email = (merged.email ?? "").trim();
  const apiKey = (merged.apiKey ?? "").trim();

  return {
    accountId: id,
    mode: merged.mode ?? "bot",
    serverUrl,
    email,
    apiKey,
    enabled: merged.enabled !== false,
    configured: !!(serverUrl && email && apiKey),
    dmPolicy: merged.dmPolicy ?? "pairing",
    allowFrom: merged.allowFrom ?? [],
    replyToMode: merged.replyToMode ?? "all",
    streams: merged.streams ?? {},
  };
}

// ---------------------------------------------------------------------------
// Config adapter
// ---------------------------------------------------------------------------

export const zulipConfigAdapter: NonNullable<ChannelPlugin<ZulipResolvedAccount>["config"]> =
  createScopedChannelConfigAdapter<ZulipResolvedAccount, ZulipResolvedAccount, CoreConfig>({
    sectionKey: SECTION_KEY,
    listAccountIds: listZulipAccountIds,
    resolveAccount: resolveZulipAccount,
    defaultAccountId: resolveDefaultAccountId,
    clearBaseFields: ["serverUrl", "email", "apiKey", "name", "mode", "enabled"],
    resolveAllowFrom: (a) => a.allowFrom,
    formatAllowFrom: (entries) => mapAllowFromEntries(entries),
  });
