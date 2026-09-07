import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import { buildChannelInboundEventContext } from "openclaw/plugin-sdk/channel-inbound";
import {
  registerSessionBindingAdapter,
  unregisterSessionBindingAdapter,
} from "openclaw/plugin-sdk/conversation-runtime";
import type { ZulipResolvedAccount } from "./types.js";
import { getZulipSection } from "./types.js";
import { ZulipClient, type ZulipMessage } from "./zulip-client.js";
import {
  createZulipSessionBindingAdapter,
  clearZulipBindingStore,
  touchZulipBindingByConversation,
} from "./bindings.js";
import { resolveIngressDecision, resolveStreamName, resolveZulipCommandAuthorization } from "./ingress.js";
import { getZulipRuntime } from "./runtime.js";
import {
  clearStreamRegistry,
  hydrateStreamNames,
  rememberStreamName,
} from "./stream-registry.js";

const CHANNEL_ID = "zulip";

export const zulipGatewayAdapter: NonNullable<ChannelPlugin<ZulipResolvedAccount>["gateway"]> = {
  async startAccount(ctx) {
    const { account, abortSignal, log } = ctx;
    const runtime = getZulipRuntime();

    const client = new ZulipClient({
      serverUrl: account.serverUrl,
      email: account.email,
      apiKey: account.apiKey,
    });

    // Register session binding adapter for ACP topic bindings
    const bindingAdapter = createZulipSessionBindingAdapter(account.accountId);
    registerSessionBindingAdapter(bindingAdapter);

    // Identify ourselves so we can filter our own messages
    const self = await client.getOwnUser();
    log?.info(`Connected as ${self.full_name} (${self.email}, id=${self.user_id})`);

    // Seed the stream registry so per-stream config can be resolved by ID from
    // the first message onward — and by the groups adapter, which is called
    // synchronously and cannot hydrate itself. Inbound messages keep the map
    // fresh afterwards, so a failure here is not fatal.
    try {
      hydrateStreamNames(account.accountId, await client.getStreams());
    } catch (err) {
      log?.debug?.(`Stream registry hydration failed: ${err}`);
    }

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

    let queueId = queue.queue_id;
    let lastEventId = queue.last_event_id;

    // Poll loop
    while (!abortSignal.aborted) {
      let events;
      try {
        events = await client.getEvents({
          queueId,
          lastEventId,
          abortSignal,
        });
      } catch (err) {
        if (abortSignal.aborted) break;
        const msg = String(err);
        // Re-register queue if it expired or timed out
        if (msg.includes("BAD_EVENT_QUEUE_ID") || msg.includes("TimeoutError") || msg.includes("timed out")) {
          log?.warn(`Event queue stale or timed out (${msg}), re-registering...`);
          try {
            const newQueue = await client.registerEventQueue({
              eventTypes: ["message"],
              allPublicStreams: account.mode === "bot",
            });
            queueId = newQueue.queue_id;
            lastEventId = newQueue.last_event_id;
            log?.info(`Event queue re-registered: ${queueId}`);
          } catch (regErr) {
            log?.error(`Failed to re-register event queue: ${regErr}`);
            await new Promise((r) => setTimeout(r, 5000));
          }
        } else {
          log?.error(`Event poll error: ${err}`);
          await new Promise((r) => setTimeout(r, 5000));
        }
        continue;
      }

      for (const event of events) {
        if (abortSignal.aborted) break;
        lastEventId = event.id;

        if (event.type === "heartbeat") continue;
        if (event.type !== "message" || !event.message) continue;

        const msg = event.message;

        // Learn the stream name while we have it — display_recipient is the
        // only place an inbound event carries it.
        const streamName = resolveStreamName(msg);
        if (msg.type === "stream" && msg.stream_id != null && streamName) {
          rememberStreamName(account.accountId, msg.stream_id, streamName);
        }

        // Single ingress gate: nothing observable happens before this decision.
        const decision = resolveIngressDecision({
          account,
          selfUserId: self.user_id,
          message: msg,
          streamName,
        });
        if (decision.action === "drop") {
          // Own-message echoes are the common case and would drown the log.
          if (decision.reason !== "self") {
            log?.info(`Dropping message ${msg.id}: ${decision.detail}`);
          }
          continue;
        }

        try {
          await handleInboundMessage(ctx, client, msg, runtime);
        } catch (err) {
          log?.error(`Error handling message ${msg.id}: ${err}`);
        }
      }
    }

    // Cleanup — deregister queue and binding adapter
    try {
      await client.deleteEventQueue(queueId);
      log?.info("Event queue deregistered.");
    } catch {
      // Queue may already be expired
    }
    unregisterSessionBindingAdapter({ channel: CHANNEL_ID, accountId: account.accountId, adapter: bindingAdapter });
    clearZulipBindingStore(account.accountId);
    clearStreamRegistry(account.accountId);

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
// Ack reactions config
// ---------------------------------------------------------------------------

type AckReactionsConfig = {
  enabled: boolean;
  onStart?: string;
  onSuccess?: string;
  onError?: string;
};

function resolveAckReactions(cfg: import("openclaw/plugin-sdk/core").OpenClawConfig): AckReactionsConfig {
  const reactions = getZulipSection(cfg)?.reactions;
  if (!reactions || reactions.enabled === false) return { enabled: false };
  return {
    enabled: true,
    onStart: reactions.onStart,
    onSuccess: reactions.onSuccess,
    onError: reactions.onError,
  };
}

// ---------------------------------------------------------------------------
// Inbound message handling
// ---------------------------------------------------------------------------

async function handleInboundMessage(
  ctx: ChannelGatewayContext<ZulipResolvedAccount>,
  client: ZulipClient,
  msg: ZulipMessage,
  runtime: ReturnType<typeof getZulipRuntime>,
): Promise<void> {
  const { cfg, account, log } = ctx;

  const isGroup = msg.type === "stream";
  const streamId = msg.stream_id;
  const topic = isGroup && streamId != null ? (msg.subject ?? "") : undefined;

  // Build peer info
  let peerId: string;
  let chatType: "direct" | "group";

  if (isGroup && streamId != null) {
    peerId = topic !== undefined ? `${streamId}/${topic}` : String(streamId);
    chatType = "group";
  } else {
    peerId = String(msg.sender_id);
    chatType = "direct";
  }

  // NOTE: self-filtering, disabled streams and the DM allowlist are all
  // decided in ingress.ts before this function is reached. Do not add drop
  // conditions here — a message that arrives has already been accepted.

  // Touch any active binding for this conversation so idle timeout resets
  touchZulipBindingByConversation(account.accountId, peerId);

  const channelRuntime = runtime.channel;

  const route = channelRuntime.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: chatType, id: peerId },
    parentPeer: isGroup && streamId != null
      ? { kind: "group", id: String(streamId) }
      : undefined,
  });

  // Build context payload
  const senderName = msg.sender_full_name;
  const senderId = String(msg.sender_id);
  const senderEmail = msg.sender_email;
  const replyTarget = isGroup && streamId != null
    ? `stream:${streamId}`
    : `user:${senderId}`;

  const groupChannel = isGroup && typeof msg.display_recipient === "string"
    ? `#${msg.display_recipient}`
    : undefined;

  const commandAuthorized = await resolveZulipCommandAuthorization({
    account,
    message: msg,
    shouldComputeAuth: channelRuntime.commands.shouldComputeCommandAuthorized(msg.content, cfg),
    readStoreAllowFrom: () => channelRuntime.pairing.readAllowFromStore({
      channel: CHANNEL_ID,
      accountId: account.accountId,
    }),
  });

  const ctxPayload = buildChannelInboundEventContext({
    channel: CHANNEL_ID,
    accountId: account.accountId,
    messageId: String(msg.id),
    timestamp: msg.timestamp * 1000,
    from: senderEmail,
    sender: { id: senderEmail, name: senderName, username: senderEmail },
    conversation: {
      kind: chatType,
      id: peerId,
      parentId: isGroup && streamId != null ? String(streamId) : undefined,
      threadId: topic,
    },
    route: { ...route, routeSessionKey: route.sessionKey },
    reply: { to: replyTarget, messageThreadId: topic },
    message: { rawBody: msg.content },
    access: { commands: { authorized: commandAuthorized } },
    extra: { GroupChannel: groupChannel, ThreadLabel: topic },
  });

  // ----- Ack reactions -----
  const ackCfg = resolveAckReactions(cfg);
  let ackStartApplied = false;

  if (ackCfg.enabled && ackCfg.onStart) {
    try {
      await client.addReaction(msg.id, ackCfg.onStart);
      ackStartApplied = true;
    } catch (err) {
      log?.debug?.(`Ack reaction (onStart) failed: ${err}`);
    }
  }

  let dispatchOk = true;

  // Core owns session recording and the reply/typing lifecycle for this route.
  await channelRuntime.inbound.dispatch({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    ctxPayload,
    replyPipeline: {
      typing: {
        start: async () => {
          if (isGroup && streamId != null) {
            await client.sendTypingNotification({
              op: "start",
              type: "stream",
              streamId,
              topic: topic ?? "",
            });
          } else {
            await client.sendTypingNotification({
              op: "start",
              type: "direct",
              to: [msg.sender_id],
            });
          }
        },
        stop: async () => {
          if (isGroup && streamId != null) {
            await client.sendTypingNotification({
              op: "stop",
              type: "stream",
              streamId,
              topic: topic ?? "",
            });
          } else {
            await client.sendTypingNotification({
              op: "stop",
              type: "direct",
              to: [msg.sender_id],
            });
          }
        },
        onStartError: (err) => log?.debug?.(`Typing start error: ${err}`),
        onStopError: (err) => log?.debug?.(`Typing stop error: ${err}`),
      },
    },
    delivery: {
      deliver: async (payload) => {
        const text = payload.text ?? "";
        if (!text.trim() && !payload.mediaUrl && !payload.mediaUrls?.length) return;

        if (isGroup && streamId != null) {
          await client.sendMessage({ type: "stream", to: String(streamId), topic: topic ?? "", content: text });
        } else {
          await client.sendMessage({ type: "direct", to: [msg.sender_id], content: text });
        }
      },
      onError: (err) => {
        dispatchOk = false;
        log?.error(`Dispatch error: ${err}`);
      },
    },
    record: { onRecordError: (err) => log?.error(`Session record error: ${err}`) },
  });

  // ----- Finalize ack reactions -----
  if (ackCfg.enabled) {
    if (ackStartApplied && ackCfg.onStart) {
      try {
        await client.removeReaction(msg.id, ackCfg.onStart);
      } catch (err) {
        log?.debug?.(`Ack reaction removal failed: ${err}`);
      }
    }

    const terminalEmoji = dispatchOk ? ackCfg.onSuccess : ackCfg.onError;
    if (terminalEmoji) {
      try {
        await client.addReaction(msg.id, terminalEmoji);
      } catch (err) {
        log?.debug?.(`Ack terminal reaction failed: ${err}`);
      }
    }
  }
}
