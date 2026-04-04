import type { ChannelPlugin } from "openclaw/plugin-sdk";
import type {
  SessionBindingAdapter,
  SessionBindingRecord,
  SessionBindingBindInput,
  SessionBindingUnbindInput,
} from "openclaw/plugin-sdk/conversation-runtime";

type ChannelConfiguredBindingProvider = NonNullable<ChannelPlugin["bindings"]>;
type ChannelConversationBindingSupport = NonNullable<ChannelPlugin["conversationBindings"]>;

// ---------------------------------------------------------------------------
// Internal binding lifecycle store
// ---------------------------------------------------------------------------

export type ZulipTopicBinding = {
  bindingId: string;
  accountId: string;
  conversationId: string;
  parentConversationId?: string;
  targetSessionKey: string;
  targetKind: "subagent" | "session";
  boundAt: number;
  lastActivityAt: number;
  idleTimeoutMs?: number;
  maxAgeMs?: number;
};

// Per-account store: bindingId → ZulipTopicBinding
const bindingsByAccount = new Map<string, Map<string, ZulipTopicBinding>>();
let bindingIdSeq = 0;

export function getZulipBindingStore(accountId: string): Map<string, ZulipTopicBinding> {
  let store = bindingsByAccount.get(accountId);
  if (!store) {
    store = new Map();
    bindingsByAccount.set(accountId, store);
  }
  return store;
}

export function clearZulipBindingStore(accountId: string): void {
  bindingsByAccount.delete(accountId);
}

export function touchZulipBindingByConversation(
  accountId: string,
  conversationId: string,
  at?: number,
): void {
  const store = getZulipBindingStore(accountId);
  const now = at ?? Date.now();
  for (const record of store.values()) {
    if (record.conversationId === conversationId) {
      record.lastActivityAt = now;
    }
  }
}

function toSessionBindingRecord(record: ZulipTopicBinding): SessionBindingRecord {
  const expiresAt = resolveExpiresAt(record);
  return {
    bindingId: record.bindingId,
    targetSessionKey: record.targetSessionKey,
    targetKind: record.targetKind,
    conversation: {
      channel: "zulip",
      accountId: record.accountId,
      conversationId: record.conversationId,
      parentConversationId: record.parentConversationId,
    },
    status: "active",
    boundAt: record.boundAt,
    expiresAt,
    metadata: {
      idleTimeoutMs: record.idleTimeoutMs,
      maxAgeMs: record.maxAgeMs,
      lastActivityAt: record.lastActivityAt,
    },
  };
}

function resolveExpiresAt(record: ZulipTopicBinding): number | undefined {
  const { idleTimeoutMs, maxAgeMs, lastActivityAt, boundAt } = record;
  const candidates: number[] = [];
  if (idleTimeoutMs != null) candidates.push(lastActivityAt + idleTimeoutMs);
  if (maxAgeMs != null) candidates.push(boundAt + maxAgeMs);
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}

// ---------------------------------------------------------------------------
// SessionBindingAdapter factory — register one per account in gateway
// ---------------------------------------------------------------------------

export function createZulipSessionBindingAdapter(
  accountId: string,
): SessionBindingAdapter {
  return {
    channel: "zulip",
    accountId,
    capabilities: {
      placements: ["current"],
      bindSupported: true,
      unbindSupported: true,
    },
    bind: async (input: SessionBindingBindInput): Promise<SessionBindingRecord | null> => {
      if (input.conversation.channel !== "zulip" || input.conversation.accountId !== accountId) {
        return null;
      }
      const store = getZulipBindingStore(accountId);
      const bindingId = `zulip:${accountId}:${input.conversation.conversationId}:${Date.now()}:${++bindingIdSeq}`;
      const now = Date.now();
      const record: ZulipTopicBinding = {
        bindingId,
        accountId,
        conversationId: input.conversation.conversationId,
        parentConversationId: input.conversation.parentConversationId,
        targetSessionKey: input.targetSessionKey,
        targetKind: input.targetKind,
        boundAt: now,
        lastActivityAt: now,
      };
      store.set(bindingId, record);
      return toSessionBindingRecord(record);
    },
    listBySession: (targetSessionKey: string): SessionBindingRecord[] => {
      const store = getZulipBindingStore(accountId);
      return Array.from(store.values())
        .filter((r) => r.targetSessionKey === targetSessionKey)
        .map(toSessionBindingRecord);
    },
    resolveByConversation: (ref): SessionBindingRecord | null => {
      if (ref.channel !== "zulip" || ref.accountId !== accountId) return null;
      const store = getZulipBindingStore(accountId);
      for (const record of store.values()) {
        if (record.conversationId === ref.conversationId) {
          return toSessionBindingRecord(record);
        }
      }
      return null;
    },
    touch: (bindingId: string, at?: number): void => {
      const store = getZulipBindingStore(accountId);
      const record = store.get(bindingId);
      if (record) record.lastActivityAt = at ?? Date.now();
    },
    unbind: async (input: SessionBindingUnbindInput): Promise<SessionBindingRecord[]> => {
      const store = getZulipBindingStore(accountId);
      const removed: SessionBindingRecord[] = [];
      if (input.bindingId) {
        const record = store.get(input.bindingId);
        if (record) {
          store.delete(input.bindingId);
          removed.push(toSessionBindingRecord(record));
        }
      } else if (input.targetSessionKey) {
        for (const [id, record] of store) {
          if (record.targetSessionKey === input.targetSessionKey) {
            store.delete(id);
            removed.push(toSessionBindingRecord(record));
          }
        }
      }
      return removed;
    },
  };
}

// ---------------------------------------------------------------------------
// ChannelConfiguredBindingProvider
// ---------------------------------------------------------------------------
//
// Zulip conversation ID format:
//   stream + topic:  "<stream_id>/<topic>"
//   direct message:  "<user_id>"
//
// Binding patterns (peer.id in AgentBindingMatch):
//   "<stream_id>/<topic>"   — exact stream + topic
//   "<stream_id>/*"         — any topic in stream
//   "*/<topic>"             — named topic in any stream
//   "<stream_id>"           — stream-level (any topic) or DM

export const zulipBindingsAdapter: ChannelConfiguredBindingProvider = {
  compileConfiguredBinding({ conversationId }) {
    const slashIdx = conversationId.indexOf("/");
    if (slashIdx === -1) {
      // DM or bare stream ID (no topic component)
      return { conversationId };
    }
    const streamPart = conversationId.slice(0, slashIdx);
    return {
      conversationId,
      // parentConversationId is the stream when stream is not a wildcard
      parentConversationId: streamPart !== "*" ? streamPart : undefined,
    };
  },

  matchInboundConversation({ compiledBinding, conversationId, parentConversationId }) {
    const pattern = compiledBinding.conversationId;
    const slashIdx = pattern.indexOf("/");

    if (slashIdx === -1) {
      // Bare pattern (DM or stream-level)
      if (conversationId === pattern) {
        return { conversationId, matchPriority: 3 };
      }
      // Match if the incoming message's parent stream matches
      if (parentConversationId != null && parentConversationId === pattern) {
        return { conversationId, parentConversationId, matchPriority: 1 };
      }
      return null;
    }

    const streamPattern = pattern.slice(0, slashIdx);
    const topicPattern = pattern.slice(slashIdx + 1);

    // Parse incoming conversationId — must be "<stream_id>/<topic>"
    const incomingSlash = conversationId.indexOf("/");
    if (incomingSlash === -1) return null;

    const incomingStream = conversationId.slice(0, incomingSlash);
    const incomingTopic = conversationId.slice(incomingSlash + 1);

    const streamMatch = streamPattern === "*" || streamPattern === incomingStream;
    const topicMatch = topicPattern === "*" || topicPattern === incomingTopic;

    if (!streamMatch || !topicMatch) return null;

    // Higher priority for more specific matches:
    //   exact stream + exact topic = 3
    //   exact stream + wildcard topic = 2
    //   wildcard stream + exact topic = 1
    //   wildcard stream + wildcard topic = 0
    const matchPriority =
      (streamPattern !== "*" ? 2 : 0) + (topicPattern !== "*" ? 1 : 0);

    return {
      conversationId,
      parentConversationId: incomingStream,
      matchPriority,
    };
  },

  resolveCommandConversation({ threadId, threadParentId, originatingTo, commandTo }) {
    const streamId = commandTo ?? threadParentId ?? originatingTo;
    if (!streamId) return null;
    if (threadId) {
      return {
        conversationId: `${streamId}/${threadId}`,
        parentConversationId: streamId,
      };
    }
    return { conversationId: streamId };
  },
};

// ---------------------------------------------------------------------------
// ChannelConversationBindingSupport
// ---------------------------------------------------------------------------

function listForSessionKey(
  targetSessionKey: string,
  accountId?: string | null,
): ZulipTopicBinding[] {
  const results: ZulipTopicBinding[] = [];
  for (const [accId, store] of bindingsByAccount) {
    if (accountId != null && accId !== accountId) continue;
    for (const record of store.values()) {
      if (record.targetSessionKey === targetSessionKey) results.push(record);
    }
  }
  return results;
}

function sweepExpiredBindings(accountId?: string): void {
  const now = Date.now();
  for (const [accId, store] of bindingsByAccount) {
    if (accountId != null && accId !== accountId) continue;
    for (const [bindingId, record] of store) {
      const expiresAt = resolveExpiresAt(record);
      if (expiresAt != null && now >= expiresAt) {
        store.delete(bindingId);
      }
    }
  }
}

export const zulipConversationBindingsSupport: ChannelConversationBindingSupport = {
  supportsCurrentConversationBinding: true,

  setIdleTimeoutBySessionKey({ targetSessionKey, accountId, idleTimeoutMs }) {
    const records = listForSessionKey(targetSessionKey, accountId);
    return records.map((record) => {
      record.idleTimeoutMs = idleTimeoutMs;
      return {
        boundAt: record.boundAt,
        lastActivityAt: record.lastActivityAt,
        idleTimeoutMs: record.idleTimeoutMs,
        maxAgeMs: record.maxAgeMs,
      };
    });
  },

  setMaxAgeBySessionKey({ targetSessionKey, accountId, maxAgeMs }) {
    const records = listForSessionKey(targetSessionKey, accountId);
    return records.map((record) => {
      record.maxAgeMs = maxAgeMs;
      return {
        boundAt: record.boundAt,
        lastActivityAt: record.lastActivityAt,
        idleTimeoutMs: record.idleTimeoutMs,
        maxAgeMs: record.maxAgeMs,
      };
    });
  },

  async createManager({ accountId }) {
    const accId = accountId ?? undefined;
    const interval = setInterval(() => {
      sweepExpiredBindings(accId);
    }, 60_000);

    return {
      stop: () => {
        clearInterval(interval);
        if (accId != null) {
          clearZulipBindingStore(accId);
        }
      },
    };
  },
};
