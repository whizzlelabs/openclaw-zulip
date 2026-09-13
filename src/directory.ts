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
    let filtered = users;
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
    // A query such as "42/" lists topics in one stream. Looking up only the
    // selected stream avoids fetching every topic in the organization.
    const slashIdx = query?.indexOf("/") ?? -1;
    if (slashIdx !== -1 && query) {
      const streamQuery = query.slice(0, slashIdx).trim().replace(/^#/, "");
      const topicQuery = query.slice(slashIdx + 1).toLowerCase();
      const stream = streams.find((s) =>
        String(s.stream_id) === streamQuery || s.name.toLowerCase() === streamQuery.toLowerCase()
      );
      if (!stream) return [];
      const topics = await client.getStreamTopics(stream.stream_id);
      const filtered = topics.filter((topic) => topic.name && topic.name.toLowerCase().includes(topicQuery));
      return (limit && limit > 0 ? filtered.slice(0, limit) : filtered).map((topic) => ({
        kind: "group" as const,
        id: `${stream.stream_id}/${topic.name}`,
        name: `${stream.name}/${topic.name}`,
      }));
    }
    let filtered = streams;
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(q) || String(s.stream_id) === q);
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
