import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/core";
import { ZulipClient } from "./zulip-client.js";
import { resolveZulipAccount } from "./config.js";
import type { CoreConfig } from "./types.js";

const clientCache = new Map<string, ZulipClient>();

function buildClient(cfg: OpenClawConfig, accountId?: string | null): ZulipClient {
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

export const zulipOutboundAdapter: NonNullable<ChannelPlugin["outbound"]> = {
  deliveryMode: "direct",

  async sendText(ctx) {
    const client = buildClient(ctx.cfg, ctx.accountId);

    const isDm = !ctx.threadId;
    const type = isDm ? ("direct" as const) : ("stream" as const);

    let to: string | number[];
    let topic: string | undefined;

    if (isDm) {
      // DM — `to` is a JSON array of user ids
      to = [Number(ctx.to)];
    } else {
      // Stream message — `to` is the stream name/id, threadId is the topic
      to = ctx.to;
      topic = String(ctx.threadId);
    }

    const res = await client.sendMessage({ type, to, topic, content: ctx.text });

    return {
      channel: "zulip",
      messageId: String(res.id),
    };
  },
};
