import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/core";
import { ZulipClient } from "./zulip-client.js";
import { resolveZulipAccount } from "./config.js";
import type { CoreConfig } from "./types.js";

const clientCache = new Map<string, ZulipClient>();

export function buildClient(cfg: OpenClawConfig, accountId?: string | null): ZulipClient {
  const account = resolveZulipAccount(cfg as CoreConfig, accountId);
  const cacheKey = `${account.serverUrl}:${account.email}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new ZulipClient({
      serverUrl: account.serverUrl,
      email: account.email,
      apiKey: account.apiKey,
    });
    clientCache.set(cacheKey, client);
  }
  return client;
}

const ZULIP_TEXT_CHUNK_LIMIT = 10_000;

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    // Try to break at a newline boundary near the limit
    const slice = remaining.slice(0, limit);
    const lastNewline = slice.lastIndexOf("\n");
    const breakAt = lastNewline > limit * 0.5 ? lastNewline + 1 : limit;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  return chunks;
}

/**
 * Parse the outbound `to` field into a resolved target.
 *
 * The SDK may deliver targets in several formats:
 *   - Numeric string: "8" (Zulip user ID for DMs, or stream ID for streams)
 *   - "user:<email_or_id>" — DM target (SDK convention)
 *   - "dm:<user_id>" — DM target (plugin convention)
 *   - "stream:<stream_id>/<topic>" — stream target (plugin convention)
 *   - Plain stream name or ID — stream target (when threadId is set)
 */
export function resolveOutboundTarget(
  to: string,
  threadId?: string | number | null,
): { type: "direct"; to: number[] | string[]; topic?: undefined } | { type: "stream"; to: string; topic: string } {
  // Explicit DM prefixes always win
  if (to.startsWith("user:") || to.startsWith("dm:")) {
    const recipient = to.startsWith("user:") ? to.slice(5) : to.slice(3);
    const asNum = Number(recipient);
    return {
      type: "direct",
      to: Number.isFinite(asNum) && String(asNum) === recipient
        ? [asNum]
        : [recipient],
    };
  }

  // If to contains "/" it encodes "stream/topic" — split it and treat as stream
  const slashIdx = to.indexOf("/");
  if (slashIdx !== -1) {
    const streamPart = to.slice(0, slashIdx);
    const topicPart = threadId ? String(threadId) : to.slice(slashIdx + 1);
    return { type: "stream", to: streamPart, topic: topicPart };
  }

  // No threadId → DM
  if (!threadId) {
    return { type: "direct", to: [Number(to)] };
  }

  // Stream message
  return { type: "stream", to, topic: String(threadId) };
}

async function sendToZulip(
  client: ZulipClient,
  ctx: { to: string; threadId?: string | number | null; text: string },
): Promise<{ channel: string; messageId: string }> {
  const target = resolveOutboundTarget(ctx.to, ctx.threadId);

  const res = await client.sendMessage({
    type: target.type,
    to: target.to,
    topic: target.type === "stream" ? target.topic : undefined,
    content: ctx.text,
  });
  return { channel: "zulip", messageId: String(res.id) };
}

export const zulipOutboundAdapter: NonNullable<ChannelPlugin["outbound"]> = {
  deliveryMode: "direct",
  textChunkLimit: ZULIP_TEXT_CHUNK_LIMIT,
  chunkerMode: "markdown",

  async sendText(ctx) {
    const client = buildClient(ctx.cfg, ctx.accountId);
    return sendToZulip(client, ctx);
  },

  async sendFormattedText(ctx) {
    const client = buildClient(ctx.cfg, ctx.accountId);
    const chunks = chunkText(ctx.text, ZULIP_TEXT_CHUNK_LIMIT);
    const results: Array<{ channel: string; messageId: string }> = [];
    for (const chunk of chunks) {
      const result = await sendToZulip(client, { ...ctx, text: chunk });
      results.push(result);
      if (ctx.abortSignal?.aborted) break;
    }
    return results;
  },

  async sendMedia(ctx) {
    const client = buildClient(ctx.cfg, ctx.accountId);

    let content = ctx.text || "";

    if (ctx.mediaUrl && ctx.mediaReadFile) {
      const buffer = await ctx.mediaReadFile(ctx.mediaUrl);
      const filename = ctx.mediaUrl.split("/").pop() ?? "file";
      const upload = await client.uploadFile(filename, buffer);
      // Zulip inline image/file syntax: [filename](url)
      const mediaLine = `[${filename}](${upload.uri})`;
      content = content ? `${mediaLine}\n${content}` : mediaLine;
    } else if (ctx.mediaUrl) {
      content = content ? `${ctx.mediaUrl}\n${content}` : ctx.mediaUrl;
    }

    return sendToZulip(client, { ...ctx, text: content });
  },
};
