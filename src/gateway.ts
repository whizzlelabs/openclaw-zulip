import type { ChannelPlugin, ChannelGatewayContext } from "openclaw/plugin-sdk";
import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/irc";
import type { ZulipResolvedAccount } from "./types.js";
import { ZulipClient, type ZulipMessage } from "./zulip-client.js";

const CHANNEL_ID = "zulip";

export const zulipGatewayAdapter: NonNullable<ChannelPlugin<ZulipResolvedAccount>["gateway"]> = {
  async startAccount(ctx) {
    const { account, abortSignal, log } = ctx;

    const client = new ZulipClient({
      serverUrl: account.serverUrl,
      email: account.email,
      apiKey: account.apiKey,
    });

    // Identify ourselves so we can filter our own messages
    const self = await client.getOwnUser();
    log?.info(`Connected as ${self.full_name} (${self.email}, id=${self.user_id})`);

    // Register event queue
    const queue = await client.registerEventQueue({
      eventTypes: ["message"],
      allPublicStreams: account.mode === "bot",
    });

    log?.info(`Event queue registered: ${queue.queue_id}`);

    ctx.setStatus({
      accountId: account.accountId,
      enabled: true,
      configured: true,
      running: true,
      connected: true,
      lastConnectedAt: Date.now(),
    });

    let lastEventId = queue.last_event_id;

    // Poll loop
    while (!abortSignal.aborted) {
      let events;
      try {
        events = await client.getEvents({
          queueId: queue.queue_id,
          lastEventId,
        });
      } catch (err) {
        if (abortSignal.aborted) break;
        log?.error(`Event poll error: ${err}`);
        // Back off before retry
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      for (const event of events) {
        if (abortSignal.aborted) break;
        lastEventId = event.id;

        if (event.type === "heartbeat") continue;
        if (event.type !== "message" || !event.message) continue;

        const msg = event.message;

        // Skip our own messages
        if (msg.sender_id === self.user_id) continue;

        try {
          await handleInboundMessage(ctx, client, msg);
        } catch (err) {
          log?.error(`Error handling message ${msg.id}: ${err}`);
        }
      }
    }

    // Cleanup — deregister queue
    try {
      await client.deleteEventQueue(queue.queue_id);
      log?.info("Event queue deregistered.");
    } catch {
      // Queue may already be expired
    }

    ctx.setStatus({
      accountId: account.accountId,
      enabled: true,
      configured: true,
      running: false,
      connected: false,
      lastStopAt: Date.now(),
    });
  },

  async stopAccount(ctx) {
    ctx.log?.info(`Stopping account ${ctx.account.accountId}`);
    // The abort signal in startAccount will break the poll loop
  },
};

// ---------------------------------------------------------------------------
// Inbound message handling
// ---------------------------------------------------------------------------

async function handleInboundMessage(
  ctx: ChannelGatewayContext<ZulipResolvedAccount>,
  client: ZulipClient,
  msg: ZulipMessage,
): Promise<void> {
  const { cfg, account, log } = ctx;

  const isGroup = msg.type === "stream";
  const streamId = msg.stream_id;
  const topic = msg.subject;

  // Build peer info
  let peerId: string;
  let chatType: "direct" | "group";

  if (isGroup && streamId != null) {
    peerId = topic ? `${streamId}/${topic}` : String(streamId);
    chatType = "group";
  } else {
    peerId = String(msg.sender_id);
    chatType = "direct";
  }

  // Resolve route via channelRuntime
  if (!ctx.channelRuntime) {
    log?.warn("channelRuntime not available — cannot dispatch inbound message");
    return;
  }

  const route = ctx.channelRuntime.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: chatType, id: peerId },
    parentPeer: isGroup && streamId != null && topic
      ? { kind: "group", id: String(streamId) }
      : undefined,
  });

  const storePath = ctx.channelRuntime.session.resolveStorePath(undefined, {
    agentId: route.agentId,
  });

  // Build context payload
  const senderName = msg.sender_full_name;
  const senderId = String(msg.sender_id);
  const senderEmail = msg.sender_email;
  const to = isGroup && streamId != null
    ? String(streamId)
    : senderId;

  const groupChannel = isGroup && typeof msg.display_recipient === "string"
    ? `#${msg.display_recipient}`
    : undefined;

  const ctxPayload = ctx.channelRuntime.reply.finalizeInboundContext({
    Body: msg.content,
    From: senderEmail,
    To: to,
    SessionKey: route.sessionKey,
    AccountId: account.accountId,
    MessageSid: String(msg.id),
    ChatType: chatType,
    SenderName: senderName,
    SenderId: senderId,
    SenderUsername: senderEmail,
    Timestamp: msg.timestamp * 1000,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: to,
    GroupChannel: groupChannel,
    ThreadLabel: topic,
    MessageThreadId: topic,
    CommandAuthorized: false,
  });

  // Dispatch reply
  await dispatchInboundReplyWithBase({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core: {
      channel: {
        session: {
          recordInboundSession: ctx.channelRuntime.session.recordInboundSession,
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher:
            ctx.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
        },
      },
    },
    deliver: async (payload) => {
      const text = payload.text ?? "";
      if (!text.trim() && !payload.mediaUrl && !payload.mediaUrls?.length) return;

      const threadId = topic;
      const targetTo = to;

      if (isGroup && streamId != null && threadId) {
        await client.sendMessage({
          type: "stream",
          to: String(streamId),
          topic: threadId,
          content: text,
        });
      } else {
        await client.sendMessage({
          type: "direct",
          to: [Number(targetTo)],
          content: text,
        });
      }
    },
    onRecordError: (err) => log?.error(`Session record error: ${err}`),
    onDispatchError: (err) => log?.error(`Dispatch error: ${err}`),
  });
}
