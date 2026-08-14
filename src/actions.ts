import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ChannelMessageActionContext } from "openclaw/plugin-sdk/core";
import type { CoreConfig } from "./types.js";
import { resolveZulipAccount } from "./config.js";
import { buildClient } from "./outbound.js";
import { rememberStreamName } from "./stream-registry.js";

// ---------------------------------------------------------------------------
// Zulip message actions adapter
// ---------------------------------------------------------------------------

const SUPPORTED_ACTIONS = new Set([
  "react", "edit", "unsend", "delete", "search", "topic-edit",
  "upload-file", "download-file", "channel-list", "channel-info", "member-info",
]);

/**
 * Stream IDs are positive integers, and large ones must survive the round trip
 * intact — "999999999999999999999" passes both a digit test and Number.isInteger
 * but has already lost precision by the time it is a number.
 */
function isUsableStreamId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export type StreamOperandResult =
  | { ok: true; operand: string; streamId?: number }
  | { ok: false; error: string };

/**
 * Turn whatever the caller passed as `zulip_stream_id` into a `stream` narrow
 * operand.
 *
 * Zulip's narrow operators are matched against the channel *name*, so handing
 * the numeric ID straight through makes the server look for a channel literally
 * named "17" and fail the whole search (issue #64). Every other action that
 * takes a stream — `topic-edit`, `channel-info` — hits an endpoint whose
 * parameter really is the numeric ID, which is why only search was affected.
 *
 * What counts as an ID depends on the input's type, and the two cases are kept
 * deliberately narrow:
 *
 *   - A JSON *number* is always an ID. It is never a name, so a non-integer or
 *     out-of-range number is an error rather than a stream called "17.5".
 *   - A *string* is an ID only if it is decimal digits — the same test isIdKey()
 *     applies to per-stream config keys. Number() would be far looser and would
 *     silently misroute perfectly legal stream names: "1e3" resolves to ID 1000,
 *     and "0x11" and "+17" both to ID 17, so those streams could never be
 *     searched by name and would return another stream's messages instead.
 *
 * Everything else is already a name and passes through untouched. Numeric
 * therefore means ID, which is why a stream literally *named* "17" can only be
 * searched by its ID — the same tradeoff isIdKey() makes, kept identical so the
 * two surfaces cannot disagree about what a config key or a parameter means.
 */
export async function resolveStreamNarrowOperand(
  client: { getStreamById(streamId: number): Promise<{ stream_id: number; name: string }> },
  raw: unknown,
): Promise<StreamOperandResult> {
  const asText = String(raw ?? "").trim();
  if (asText === "") return { ok: false, error: "zulip_stream_id is empty" };

  let streamId: number | undefined;
  if (typeof raw === "number") {
    if (!isUsableStreamId(raw)) {
      return { ok: false, error: `zulip_stream_id must be a positive integer stream ID, got ${asText}` };
    }
    streamId = raw;
  } else if (typeof raw === "string" && /^\d+$/.test(asText)) {
    const parsed = Number(asText);
    if (!isUsableStreamId(parsed)) {
      return { ok: false, error: `zulip_stream_id ${asText} is not a usable stream ID` };
    }
    streamId = parsed;
  }

  // Not an ID by either rule — the caller gave a name, which is what the narrow
  // operator wants anyway.
  if (streamId === undefined) return { ok: true, operand: asText };

  const numeric = streamId;
  let stream: { stream_id: number; name: string };
  try {
    stream = await client.getStreamById(numeric);
  } catch (e) {
    // Fail here rather than falling back to the ID: a malformed narrow makes
    // Zulip reject the entire request, so a bad stream ID would also throw away
    // the topic and query the caller asked for.
    return {
      ok: false,
      error: `Could not resolve Zulip stream ID ${numeric}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!stream?.name) {
    return { ok: false, error: `Zulip returned no name for stream ID ${numeric}` };
  }
  return { ok: true, operand: stream.name, streamId: stream.stream_id ?? numeric };
}

export const zulipActionsAdapter: NonNullable<ChannelPlugin["actions"]> = {
  supportsAction({ action }) {
    return SUPPORTED_ACTIONS.has(action);
  },

  describeMessageTool(_ctx) {
    return {
      actions: ["react", "edit", "unsend", "search", "topic-edit", "upload-file", "download-file", "channel-list", "channel-info", "member-info"],
      schema: {
        visibility: "current-channel",
        properties: {
          zulip_message_id: { type: "number", description: "Zulip message ID to act on (required for react, edit, unsend, topic-edit)" },
          zulip_emoji: { type: "string", description: "Emoji name for the react action (e.g. 'thumbs_up', '+1')" },
          zulip_content: { type: "string", description: "New message content for the edit action" },
          zulip_topic: { type: "string", description: "Topic name for topic-edit or search narrow" },
          zulip_stream_id: { type: "number", description: "Stream ID for topic-edit or search narrow (search resolves it to the stream name; a non-numeric value is treated as a stream name)" },
          zulip_query: { type: "string", description: "Full-text search query for the search action" },
          zulip_propagate_mode: { type: "string", description: "Topic propagation mode for topic-edit: 'change_one', 'change_later', or 'change_all' (default)" },
          zulip_file_path: { type: "string", description: "Local file path for upload-file, or Zulip file URI for download-file" },
          zulip_limit: { type: "number", description: "Maximum number of messages to return from search (default 10)" },
          zulip_user_id: { type: "number", description: "Zulip user ID for the member-info action" },
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
        if (p.zulip_stream_id != null && text(p.zulip_stream_id).trim() !== "") {
          const resolved = await resolveStreamNarrowOperand(client, p.zulip_stream_id);
          if (!resolved.ok) return err(resolved.error);
          // We just learned an authoritative id → name pair; the registry is
          // otherwise only fed by the poll loop, so streams this account has
          // not yet seen a message in stay unresolvable for per-stream config.
          if (resolved.streamId !== undefined) {
            const account = resolveZulipAccount(ctx.cfg as CoreConfig, ctx.accountId);
            rememberStreamName(account.accountId, resolved.streamId, resolved.operand);
          }
          narrow.push({ operator: "stream", operand: resolved.operand });
        }
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
