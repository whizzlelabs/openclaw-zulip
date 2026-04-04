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
    // Formats:  "stream:<stream_id>/<topic>"  or  "dm:<user_id>"
    if (raw.startsWith("dm:")) {
      return { to: raw.slice(3), chatType: "direct" };
    }
    if (raw.startsWith("stream:")) {
      const rest = raw.slice(7);
      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        return { to: rest, chatType: "group" };
      }
      return {
        to: rest.slice(0, slashIdx),
        threadId: rest.slice(slashIdx + 1),
        chatType: "group",
      };
    }
    return null;
  },
};
