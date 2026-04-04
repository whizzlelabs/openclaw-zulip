import { Type } from "@sinclair/typebox";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ChannelMessageActionContext } from "openclaw/plugin-sdk/core";
import { buildClient } from "./outbound.js";

// ---------------------------------------------------------------------------
// Zulip message actions adapter
// ---------------------------------------------------------------------------

export const zulipActionsAdapter: NonNullable<ChannelPlugin["actions"]> = {
  describeMessageTool(_ctx) {
    return {
      actions: ["react", "edit", "unsend", "search", "topic-edit", "upload-file", "download-file", "channel-list", "channel-info", "member-info"],
      schema: {
        visibility: "current-channel",
        properties: {
          zulip_message_id: Type.Optional(
            Type.Number({ description: "Zulip message ID to act on (required for react, edit, unsend, topic-edit)" }),
          ),
          zulip_emoji: Type.Optional(
            Type.String({ description: "Emoji name for the react action (e.g. 'thumbs_up', '+1')" }),
          ),
          zulip_content: Type.Optional(
            Type.String({ description: "New message content for the edit action" }),
          ),
          zulip_topic: Type.Optional(
            Type.String({ description: "Topic name for topic-edit or search narrow" }),
          ),
          zulip_stream_id: Type.Optional(
            Type.Number({ description: "Stream ID for topic-edit or search narrow" }),
          ),
          zulip_query: Type.Optional(
            Type.String({ description: "Full-text search query for the search action" }),
          ),
          zulip_propagate_mode: Type.Optional(
            Type.String({
              description: "Topic propagation mode for topic-edit: 'change_one', 'change_later', or 'change_all' (default)",
            }),
          ),
          zulip_file_path: Type.Optional(
            Type.String({ description: "Local file path for upload-file, or Zulip file URI for download-file" }),
          ),
          zulip_limit: Type.Optional(
            Type.Number({ description: "Maximum number of messages to return from search (default 10)" }),
          ),
          zulip_user_id: Type.Optional(
            Type.Number({ description: "Zulip user ID for the member-info action" }),
          ),
        },
      },
    };
  },

  async handleAction(ctx: ChannelMessageActionContext) {
    const client = buildClient(ctx.cfg, ctx.accountId);
    const p = ctx.params;

    const text = (s: unknown) => String(s ?? "");
    const requireMessageId = (): number | null => {
      const raw = p.zulip_message_id;
      if (raw == null || raw === "") return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return n;
    };

    switch (ctx.action) {
      case "react": {
        const messageId = requireMessageId();
        if (messageId == null) return err("zulip_message_id is required for react");
        const emojiName = text(p.zulip_emoji) || "thumbs_up";
        await client.addReaction(messageId, emojiName);
        return ok(`Reacted with :${emojiName}: on message ${messageId}`);
      }

      case "edit": {
        const messageId = requireMessageId();
        if (messageId == null) return err("zulip_message_id is required for edit");
        const content = text(p.zulip_content);
        if (!content) return err("zulip_content is required for edit");
        await client.editMessage(messageId, content);
        return ok(`Edited message ${messageId}`);
      }

      case "unsend":
      case "delete": {
        const messageId = requireMessageId();
        if (messageId == null) return err("zulip_message_id is required for unsend");
        await client.deleteMessage(messageId);
        return ok(`Deleted message ${messageId}`);
      }

      case "search": {
        const limit = p.zulip_limit ? Number(p.zulip_limit) || 10 : 10;
        const narrow: Array<{ operator: string; operand: string }> = [];
        if (p.zulip_stream_id) narrow.push({ operator: "stream", operand: text(p.zulip_stream_id) });
        if (p.zulip_topic) narrow.push({ operator: "topic", operand: text(p.zulip_topic) });
        if (p.zulip_query) narrow.push({ operator: "search", operand: text(p.zulip_query) });
        const messages = await client.searchMessages({
          anchor: "newest",
          numBefore: limit,
          numAfter: 0,
          narrow,
        });
        return ok(JSON.stringify(messages, null, 2));
      }

      case "topic-edit": {
        const messageId = requireMessageId();
        if (messageId == null) return err("zulip_message_id is required for topic-edit");
        const topic = text(p.zulip_topic);
        if (!topic) return err("zulip_topic is required for topic-edit");
        const propagateMode = text(p.zulip_propagate_mode) || "change_all";
        const streamId = p.zulip_stream_id ? Number(p.zulip_stream_id) : undefined;
        await client.updateMessageTopic(messageId, topic, propagateMode, streamId);
        return ok(`Topic updated to "${topic}" (mode: ${propagateMode})`);
      }

      case "upload-file": {
        const filePath = text(p.zulip_file_path);
        if (!filePath) return err("zulip_file_path is required for upload-file");
        if (!ctx.mediaReadFile) return err("File read access not available in this context");
        const buffer = await ctx.mediaReadFile(filePath);
        const filename = filePath.split("/").pop() ?? "file";
        const result = await client.uploadFile(filename, buffer);
        return ok(result.uri);
      }

      case "download-file": {
        const fileUrl = text(p.zulip_file_path);
        if (!fileUrl) return err("zulip_file_path is required for download-file");
        const buffer = await client.downloadFile(fileUrl);
        const base64 = buffer.toString("base64");
        return ok(`data:application/octet-stream;base64,${base64}`);
      }

      case "channel-list": {
        const streams = await client.getStreams();
        return ok(JSON.stringify(streams, null, 2));
      }

      case "channel-info": {
        const streamId = p.zulip_stream_id ? Number(p.zulip_stream_id) : null;
        if (streamId == null) return err("zulip_stream_id is required for channel-info");
        const [stream, members] = await Promise.all([
          client.getStreamById(streamId),
          client.getStreamMembers(streamId),
        ]);
        return ok(JSON.stringify({ ...stream, subscribers: members }, null, 2));
      }

      case "member-info": {
        const userId = p.zulip_user_id ? Number(p.zulip_user_id) : null;
        if (userId == null) return err("zulip_user_id is required for member-info");
        const user = await client.getUser(userId);
        return ok(JSON.stringify(user, null, 2));
      }

      default:
        return err(`Action "${ctx.action}" is not supported by the Zulip plugin`);
    }
  },
};

function ok(message: string) {
  return { content: [{ type: "text" as const, text: message }], details: { ok: true } };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], details: { ok: false } };
}
