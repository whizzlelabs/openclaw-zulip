import { buildChannelOutboundSessionRoute, type ChannelPlugin, type OpenClawConfig } from "openclaw/plugin-sdk/core";
import { buildClient } from "./outbound.js";

export const zulipMessagingAdapter: NonNullable<ChannelPlugin["messaging"]> = {
  resolveSessionConversation({ rawId }) {
    // rawId formats:
    //   group/channel:  "<stream_id>"  or  "<stream_id>/<topic>"
    const slashIdx = rawId.indexOf("/");
    if (slashIdx === -1) {
      return { id: rawId };
    }

    const streamPart = rawId.slice(0, slashIdx);
    const topicPart = rawId.slice(slashIdx + 1);

    return {
      id: rawId,
      threadId: topicPart,
      baseConversationId: streamPart,
      parentConversationCandidates: [streamPart],
    };
  },

  resolveSessionTarget({ id }) {
    return id;
  },

  inferTargetChatType({ to }) {
    if (to.startsWith("dm:") || to.startsWith("user:")) return "direct";
    if (to.startsWith("stream:") || to.includes("/")) return "group";
    return undefined;
  },

  preserveHeartbeatThreadIdForGroupRoute: true,

  resolveOutboundSessionRoute({ cfg, agentId, accountId, target, resolvedTarget, threadId }) {
    const explicitKind = /^(?:dm|user|stream):/.test(target);
    const canonicalGroupTarget = !explicitKind && target.includes("/");
    if (!resolvedTarget && !explicitKind && !canonicalGroupTarget) return null;

    const explicitDm = target.startsWith("dm:") || target.startsWith("user:");
    const direct = explicitDm || resolvedTarget?.kind === "user";
    const raw = (resolvedTarget?.to ?? target).replace(/^(?:dm|user|stream):/, "");
    const { streamPart, topicPart } = splitStreamTopic(raw);
    const topic = direct ? undefined : (threadId != null ? String(threadId) : topicPart);
    const to = direct ? raw : streamPart;
    const chatType = direct ? "direct" : "group";
    return buildChannelOutboundSessionRoute({
      cfg, agentId, accountId, channel: "zulip", chatType,
      peer: { kind: chatType, id: topic !== undefined ? `${to}/${topic}` : to },
      recipientSessionExact: isNumeric(to) && (direct || topic !== undefined),
      from: `zulip:${to}`,
      to,
      threadId: topic,
    });
  },

  targetResolver: {
    hint: 'Use "stream:<name_or_id>/<topic>" for streams or "dm:<user_id>" / "user:<email>" for DMs.',

    looksLikeId(raw: string) {
      if (
        raw.startsWith("stream:") ||
        raw.startsWith("dm:") ||
        raw.startsWith("user:")
      ) {
        return true;
      }
      // Bare conversation ids emitted by this plugin are ids too:
      // "<stream_id>" / "<stream_id>/<topic>" for streams, "<user_id>" for DMs.
      return isNumericHead(raw);
    },

    async resolveTarget({ cfg, accountId, input, preferredKind }: {
      cfg: OpenClawConfig;
      accountId?: string | null;
      input: string;
      normalized: string;
      preferredKind?: string;
    }) {
      // DM targets
      if (input.startsWith("dm:") || input.startsWith("user:")) {
        const recipient = input.startsWith("dm:") ? input.slice(3) : input.slice(5);
        return { to: `user:${recipient}`, kind: "user" as const, source: "normalized" as const };
      }

      // Stream targets
      if (input.startsWith("stream:")) {
        const { streamPart, topicPart } = splitStreamTopic(input.slice(7));
        const resolved = await lookupStream(cfg, accountId, streamPart, topicPart);
        if (resolved) return resolved;
        // Numeric ids fall back to the raw id; unknown names stay unresolved.
        if (isNumeric(streamPart)) return numericStreamFallback(streamPart, topicPart);
        return null;
      }

      // Bare conversation ids (no scheme prefix). These surface as outbound
      // targets when the agent replies to / acts on the current conversation
      // via the message or react tool: streams are "<stream_id>[/<topic>]" and
      // DMs are "<user_id>". A bare numeric is ambiguous (a stream id and a
      // user id can collide). A topic makes it a stream; without a topic it is
      // a DM unless the runtime explicitly requires a group, in which case the
      // missing topic fails closed.
      const slashIdx = input.indexOf("/");
      const head = slashIdx === -1 ? input : input.slice(0, slashIdx);
      const topicPart = slashIdx === -1 ? undefined : input.slice(slashIdx + 1);
      if (isNumeric(head)) {
        if (topicPart === undefined) {
          if (preferredKind === "user") {
            return { to: `user:${head}`, kind: "user" as const, source: "normalized" as const };
          }
          if (preferredKind !== "group" && preferredKind !== "channel") {
            throw new Error('Ambiguous Zulip target; use "user:<id>" or "stream:<id>/<topic>"');
          }
        }
        const resolved = await lookupStream(cfg, accountId, head, topicPart);
        if (resolved) return resolved;
        return numericStreamFallback(head, topicPart);
      }

      return null;
    },
  },
};

// ---------------------------------------------------------------------------
// Target-resolution helpers
// ---------------------------------------------------------------------------

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

// True when the leading segment (before any "/<topic>") is a bare numeric id.
function isNumericHead(raw: string): boolean {
  const slashIdx = raw.indexOf("/");
  return isNumeric(slashIdx === -1 ? raw : raw.slice(0, slashIdx));
}

// Split a "stream:" payload into stream and topic parts, accepting both
// "name/topic" and "name:topic" separators (slash wins when both appear).
function splitStreamTopic(rest: string): { streamPart: string; topicPart?: string } {
  const slashIdx = rest.indexOf("/");
  const colonIdx = rest.indexOf(":");
  const sepIdx = slashIdx !== -1 ? slashIdx : colonIdx;
  if (sepIdx === -1) return { streamPart: rest };
  return { streamPart: rest.slice(0, sepIdx), topicPart: rest.slice(sepIdx + 1) };
}

// Resolve a stream by numeric id or name via the Zulip API. Returns a
// directory-sourced channel target, or null when the stream cannot be found.
async function lookupStream(
  cfg: OpenClawConfig,
  accountId: string | null | undefined,
  streamPart: string,
  topicPart: string | undefined,
) {
  const client = buildClient(cfg, accountId);
  if (isNumeric(streamPart)) {
    try {
      const stream = await client.getStreamById(Number(streamPart));
      return channelTarget(stream.name, topicPart);
    } catch {
      return null;
    }
  }
  const streams = await client.getStreams();
  const match = streams.find((s) => s.name.toLowerCase() === streamPart.toLowerCase());
  return match ? channelTarget(match.name, topicPart) : null;
}

function channelTarget(name: string, topicPart: string | undefined) {
  return {
    to: topicPart !== undefined ? `stream:${name}/${topicPart}` : `stream:${name}`,
    kind: "channel" as const,
    display: topicPart !== undefined ? `#${name} > ${topicPart}` : `#${name}`,
    source: "directory" as const,
  };
}

function numericStreamFallback(streamPart: string, topicPart: string | undefined) {
  return {
    to: topicPart !== undefined ? `stream:${streamPart}/${topicPart}` : `stream:${streamPart}`,
    kind: "channel" as const,
    source: "normalized" as const,
  };
}
