import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { CoreConfig } from "./types.js";
import { resolveZulipAccount } from "./config.js";
import { lookupStreamName, resolveStreamConfig } from "./stream-registry.js";

// ---------------------------------------------------------------------------
// Groups adapter — per-stream policies
// ---------------------------------------------------------------------------

export const zulipGroupsAdapter: NonNullable<ChannelPlugin["groups"]> = {
  resolveRequireMention({ cfg, accountId, groupId }) {
    const account = resolveZulipAccount(cfg as CoreConfig, accountId);
    if (!groupId) return undefined;

    // groupId is normally the bare stream ID (peerId is "<stream_id>/<topic>",
    // so the parent group is the ID alone), but accept the topic-qualified form
    // too rather than silently missing on it. Per-stream config is keyed by
    // name, so go through the registry the gateway populates to get back to one.
    const streamPart = groupId.split("/")[0];
    const parsed = Number(streamPart);
    const streamId = streamPart !== "" && Number.isFinite(parsed) ? parsed : undefined;
    const streamName =
      streamId !== undefined ? lookupStreamName(account.accountId, streamId) : undefined;

    const streamConfig = resolveStreamConfig(account, {
      streamId,
      // Fall back to treating the groupId as a name — it is one for callers
      // that address a stream by name rather than ID.
      streamName: streamName ?? streamPart,
    });

    return streamConfig?.requireMention;
  },

  resolveGroupIntroHint({ cfg, accountId }) {
    const account = resolveZulipAccount(cfg as CoreConfig, accountId);
    return `This is a Zulip ${account.mode === "user" ? "user" : "bot"} account. Messages in streams require a topic.`;
  },
};
