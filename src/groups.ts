import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { CoreConfig } from "./types.js";
import { resolveZulipAccount } from "./config.js";
import { lookupStreamName, resolveStreamConfig } from "./stream-registry.js";

// ---------------------------------------------------------------------------
// Groups adapter — per-stream policies
// ---------------------------------------------------------------------------

/** "#Homelab" → "Homelab". Empty or absent labels resolve to undefined. */
function normalizeStreamLabel(label: string | null | undefined): string | undefined {
  const trimmed = (label ?? "").trim().replace(/^#+/, "").trim();
  return trimmed === "" ? undefined : trimmed;
}

export const zulipGroupsAdapter: NonNullable<ChannelPlugin["groups"]> = {
  resolveRequireMention({ cfg, accountId, groupId, groupChannel }) {
    const account = resolveZulipAccount(cfg as CoreConfig, accountId);

    // `groupChannel` is the reliable identity here, not `groupId`.
    //
    // The SDK derives groupId from the group session resolution, which falls
    // back to ctx.From whenever it cannot parse a channel-qualified
    // OriginatingTo — and this plugin sends a bare "<stream_id>", which
    // resolveOriginatingGroupTargetId() rejects for having no ":" separator.
    // So at runtime groupId is the *sender's email*, not the stream. The SDK
    // passes the stream name separately as groupChannel ("#<name>", set by the
    // gateway), which is what the bundled channels key off for the same reason.
    const nameFromChannel = normalizeStreamLabel(groupChannel);

    // Still accept a stream ID via groupId, for callers that supply a real
    // conversation ID (and for the "<stream_id>/<topic>" form).
    const streamPart = (groupId ?? "").split("/")[0].trim();
    const parsed = Number(streamPart);
    const streamId =
      streamPart !== "" && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;

    const streamName =
      nameFromChannel ??
      (streamId !== undefined ? lookupStreamName(account.accountId, streamId) : undefined) ??
      // Last resort: treat groupId as a name, for callers that address a
      // stream by name rather than ID.
      (streamId === undefined && streamPart !== "" ? streamPart : undefined);

    if (streamId === undefined && streamName === undefined) return undefined;

    return resolveStreamConfig(account, { streamId, streamName })?.requireMention;
  },

  resolveGroupIntroHint({ cfg, accountId }) {
    const account = resolveZulipAccount(cfg as CoreConfig, accountId);
    return `This is a Zulip ${account.mode === "user" ? "user" : "bot"} account. Messages in streams require a topic.`;
  },
};
