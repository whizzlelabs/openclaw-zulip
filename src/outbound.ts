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

async function sendToZulip(
  client: ZulipClient,
  ctx: { to: string; threadId?: string | number | null; text: string },
): Promise<{ channel: string; messageId: string }> {
  const isDm = !ctx.threadId;
  const type = isDm ? ("direct" as const) : ("stream" as const);
  const to: string | number[] = isDm ? [Number(ctx.to)] : ctx.to;
  const topic = isDm ? undefined : String(ctx.threadId);

  const res = await client.sendMessage({ type, to, topic, content: ctx.text });
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
