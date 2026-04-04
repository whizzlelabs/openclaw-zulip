import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { CoreConfig } from "./types.js";
import { resolveZulipAccount } from "./config.js";
import { ZulipClient } from "./zulip-client.js";

// ---------------------------------------------------------------------------
// Directory adapter — users and streams
// ---------------------------------------------------------------------------

function buildClient(cfg: CoreConfig, accountId?: string | null) {
  const account = resolveZulipAccount(cfg, accountId);
  return new ZulipClient({
    serverUrl: account.serverUrl,
    email: account.email,
    apiKey: account.apiKey,
  });
}

export const zulipDirectoryAdapter: NonNullable<ChannelPlugin["directory"]> = {
  async self({ cfg, accountId }) {
    const client = buildClient(cfg as CoreConfig, accountId);
    const user = await client.getOwnUser();
    return {
      kind: "user",
      id: String(user.user_id),
      name: user.full_name,
      handle: user.email,
    };
  },

  async listPeers({ cfg, accountId, query, limit }) {
    const client = buildClient(cfg as CoreConfig, accountId);
    const users = await client.getUsers();
    let filtered = users.filter((u) => !u.is_bot);
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      );
    }
    if (limit && limit > 0) filtered = filtered.slice(0, limit);
    return filtered.map((u) => ({
      kind: "user" as const,
      id: String(u.user_id),
      name: u.full_name,
      handle: u.email,
    }));
  },

  async listGroups({ cfg, accountId, query, limit }) {
    const client = buildClient(cfg as CoreConfig, accountId);
    const streams = await client.getStreams();
    let filtered = streams;
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (limit && limit > 0) filtered = filtered.slice(0, limit);
    return filtered.map((s) => ({
      kind: "group" as const,
      id: String(s.stream_id),
      name: s.name,
    }));
  },

  async listGroupMembers({ cfg, accountId, groupId }) {
    const client = buildClient(cfg as CoreConfig, accountId);
    const memberIds = await client.getStreamMembers(Number(groupId));
    return memberIds.map((id) => ({
      kind: "user" as const,
      id: String(id),
    }));
  },
};
