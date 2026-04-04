import type { ChannelPlugin } from "openclaw/plugin-sdk/core";

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
};
