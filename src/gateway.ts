import type { ChannelPlugin, ChannelGatewayContext } from "openclaw/plugin-sdk";
import { createChannelReplyPipeline, dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/irc";
import {
  registerSessionBindingAdapter,
  unregisterSessionBindingAdapter,
} from "openclaw/plugin-sdk/conversation-runtime";
import {
  resolveSenderCommandAuthorization,
} from "openclaw/plugin-sdk/command-auth";
import type { ZulipResolvedAccount } from "./types.js";
import { getZulipSection } from "./types.js";
import { ZulipClient, type ZulipMessage } from "./zulip-client.js";
import {
  createZulipSessionBindingAdapter,
  clearZulipBindingStore,
  touchZulipBindingByConversation,
} from "./bindings.js";

const CHANNEL_ID = "zulip";

export const zulipGatewayAdapter: NonNullable<ChannelPlugin<ZulipResolvedAccount>["gateway"]> = {
  async startAccount(ctx) {
    const { account, abortSignal, log } = ctx;

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

    // Cleanup — deregister queue and binding adapter
    try {
      await client.deleteEventQueue(queue.queue_id);
      log?.info("Event queue deregistered.");
    } catch {
      // Queue may already be expired
    }
    unregisterSessionBindingAdapter({ channel: CHANNEL_ID, accountId: account.accountId, adapter: bindingAdapter });
    clearZulipBindingStore(account.accountId);

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
  const section = getZulipSection(cfg) as Record<string, unknown> | undefined;
  const reactions = section?.reactions as Record<string, unknown> | undefined;
  if (!reactions || reactions.enabled === false) return { enabled: false };
  return {
    enabled: true,
    onStart: (reactions.onStart as string) ?? undefined,
    onSuccess: (reactions.onSuccess as string) ?? undefined,
    onError: (reactions.onError as string) ?? undefined,
  };
}

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

  // Touch any active binding for this conversation so idle timeout resets
  touchZulipBindingByConversation(account.accountId, peerId);

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

  // Resolve command authorization from allowlists
  const { commandAuthorized } = await resolveSenderCommandAuthorization({
    cfg,
    rawBody: msg.content,
    isGroup,
    dmPolicy: account.dmPolicy,
    configuredAllowFrom: account.allowFrom.map(String),
    senderId: senderEmail,
    isSenderAllowed: (sid, allowFrom) =>
      allowFrom.includes(sid) || allowFrom.includes(String(msg.sender_id)) || allowFrom.includes("*"),
    readAllowFromStore: () =>
      ctx.channelRuntime!.pairing.readAllowFromStore({
        channel: CHANNEL_ID,
        accountId: account.accountId,
      }),
    shouldComputeCommandAuthorized:
      ctx.channelRuntime.commands.shouldComputeCommandAuthorized,
    resolveCommandAuthorizedFromAuthorizers:
      ctx.channelRuntime.commands.resolveCommandAuthorizedFromAuthorizers,
  });

  const isCommand = msg.content.trim().startsWith("/");
  if (isCommand) {
    log?.info(`[cmd-debug] body=${JSON.stringify(msg.content)} sender=${senderEmail} senderId=${senderId} commandAuthorized=${commandAuthorized}`);
  }

  const ctxPayload = ctx.channelRuntime.reply.finalizeInboundContext({
    Body: msg.content,
    From: senderEmail,
    To: to,
    SessionKey: route.sessionKey,
    AccountId: account.accountId,
    MessageSid: String(msg.id),
    ChatType: chatType,
    SenderName: senderName,
    SenderId: senderEmail,
    SenderUsername: senderEmail,
    Timestamp: msg.timestamp * 1000,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: to,
    GroupChannel: groupChannel,
    ThreadLabel: topic,
    MessageThreadId: topic,
    CommandAuthorized: commandAuthorized ?? false,
  });

  // ----- Typing indicators -----
  const pipeline = createChannelReplyPipeline({
    cfg,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    typing: {
      start: async () => {
        if (isGroup && streamId != null && topic) {
          await client.sendTypingNotification({
            op: "start",
            type: "stream",
            streamId,
            topic,
          });
        } else {
          await client.sendTypingNotification({
            op: "start",
            type: "direct",
            to: [Number(to)],
          });
        }
      },
      stop: async () => {
        if (isGroup && streamId != null && topic) {
          await client.sendTypingNotification({
            op: "stop",
            type: "stream",
            streamId,
            topic,
          });
        } else {
          await client.sendTypingNotification({
            op: "stop",
            type: "direct",
            to: [Number(to)],
          });
        }
      },
      onStartError: (err) => log?.debug?.(`Typing start error: ${err}`),
      onStopError: (err) => log?.debug?.(`Typing stop error: ${err}`),
    },
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
    replyOptions: {
      onReplyStart: pipeline.typingCallbacks?.onReplyStart,
      onTypingCleanup: pipeline.typingCallbacks?.onCleanup,
    },
    deliver: async (payload) => {
      const text = payload.text ?? "";
      if (!text.trim() && !payload.mediaUrl && !payload.mediaUrls?.length) {
        if (isCommand) log?.info(`[cmd-debug] deliver: skipped (empty payload)`);
        return;
      }

      if (isCommand) {
        log?.info(`[cmd-debug] deliver: text=${JSON.stringify(text.slice(0, 120))} to=${to} threadId=${topic} isGroup=${isGroup}`);
      }

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

      if (isCommand) log?.info(`[cmd-debug] deliver: sent OK`);
    },
    onRecordError: (err) => log?.error(`Session record error: ${err}`),
    onDispatchError: (err) => {
      dispatchOk = false;
      log?.error(`Dispatch error: ${err}`);
      if (isCommand) log?.info(`[cmd-debug] dispatchError: ${err}`);
    },
  });

  if (isCommand) {
    log?.info(`[cmd-debug] dispatch complete: dispatchOk=${dispatchOk}`);
  }

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
