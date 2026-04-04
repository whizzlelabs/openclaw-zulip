import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/core";
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

  parseExplicitTarget({ raw }) {
    // Formats:  "stream:<stream_id>/<topic>"  or  "dm:<user_id>"  or  "user:<user_id_or_email>"
    if (raw.startsWith("dm:")) {
      return { to: raw.slice(3), chatType: "direct" };
    }
    if (raw.startsWith("user:")) {
      return { to: raw.slice(5), chatType: "direct" };
    }
    if (raw.startsWith("stream:")) {
      const rest = raw.slice(7);
      // Support both "stream:name/topic" and "stream:name:topic" separators
      const slashIdx = rest.indexOf("/");
      const colonIdx = rest.indexOf(":");
      const sepIdx = slashIdx !== -1 ? slashIdx : colonIdx;
      if (sepIdx === -1) {
        return { to: rest, chatType: "group" };
      }
      return {
        to: rest.slice(0, sepIdx),
        threadId: rest.slice(sepIdx + 1),
        chatType: "group",
      };
    }
    return null;
  },

  targetResolver: {
    hint: 'Use "stream:<name_or_id>/<topic>" for streams or "dm:<user_id>" / "user:<email>" for DMs.',

    looksLikeId(raw: string) {
      return raw.startsWith("stream:") || raw.startsWith("dm:") || raw.startsWith("user:");
    },

    async resolveTarget({ cfg, accountId, input }: {
      cfg: OpenClawConfig;
      accountId?: string | null;
      input: string;
      normalized: string;
      preferredKind?: string;
    }) {
      // DM targets
      if (input.startsWith("dm:") || input.startsWith("user:")) {
        const recipient = input.startsWith("dm:") ? input.slice(3) : input.slice(5);
        return { to: recipient, kind: "user" as const, source: "normalized" as const };
      }

      // Stream targets
      if (input.startsWith("stream:")) {
        const rest = input.slice(7);
        const slashIdx = rest.indexOf("/");
        const colonIdx = rest.indexOf(":");
        const sepIdx = slashIdx !== -1 ? slashIdx : colonIdx;
        const streamPart = sepIdx === -1 ? rest : rest.slice(0, sepIdx);
        const topicPart = sepIdx === -1 ? undefined : rest.slice(sepIdx + 1);

        // If streamPart is numeric, resolve to stream name via API
        const asNum = Number(streamPart);
        if (Number.isFinite(asNum) && String(asNum) === streamPart) {
          const client = buildClient(cfg, accountId);
          try {
            const stream = await client.getStreamById(asNum);
            const to = topicPart ? `${stream.name}/${topicPart}` : stream.name;
            return {
              to,
              kind: "channel" as const,
              display: topicPart ? `#${stream.name} > ${topicPart}` : `#${stream.name}`,
              source: "directory" as const,
            };
          } catch {
            // Fall back to numeric ID if lookup fails
            const to = topicPart ? `${streamPart}/${topicPart}` : streamPart;
            return { to, kind: "channel" as const, source: "normalized" as const };
          }
        }

        // Resolve stream name → verify it exists via Zulip API
        const client = buildClient(cfg, accountId);
        const streams = await client.getStreams();
        const match = streams.find(
          (s) => s.name.toLowerCase() === streamPart.toLowerCase(),
        );
        if (!match) return null;

        const to = topicPart ? `${match.name}/${topicPart}` : match.name;
        return {
          to,
          kind: "channel" as const,
          display: topicPart ? `#${match.name} > ${topicPart}` : `#${match.name}`,
          source: "directory" as const,
        };
      }

      return null;
    },
  },
};
