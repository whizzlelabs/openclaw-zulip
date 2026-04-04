import { describe, it, expect, beforeEach } from "vitest";
import {
  zulipBindingsAdapter,
  zulipConversationBindingsSupport,
  getZulipBindingStore,
  clearZulipBindingStore,
  touchZulipBindingByConversation,
  createZulipSessionBindingAdapter,
  type ZulipTopicBinding,
} from "./bindings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBinding(
  accountId: string,
  conversationId: string,
  targetSessionKey: string,
  overrides: Partial<ZulipTopicBinding> = {},
): ZulipTopicBinding {
  const now = Date.now();
  return {
    bindingId: `test:${conversationId}`,
    accountId,
    conversationId,
    parentConversationId: conversationId.includes("/")
      ? conversationId.split("/")[0]
      : undefined,
    targetSessionKey,
    targetKind: "session",
    boundAt: now,
    lastActivityAt: now,
    ...overrides,
  };
}

function seedBinding(accountId: string, binding: ZulipTopicBinding): void {
  getZulipBindingStore(accountId).set(binding.bindingId, binding);
}

// ---------------------------------------------------------------------------
// compileConfiguredBinding
// ---------------------------------------------------------------------------

describe("zulipBindingsAdapter.compileConfiguredBinding", () => {
  const compile = (conversationId: string) =>
    zulipBindingsAdapter.compileConfiguredBinding({
      binding: { type: "route", agentId: "bot", match: { channel: "zulip" } },
      conversationId,
    });

  it("returns bare conversationId for DM (no slash)", () => {
    expect(compile("456")).toEqual({ conversationId: "456" });
  });

  it("returns conversationId and parentConversationId for exact stream+topic", () => {
    expect(compile("123/support")).toEqual({
      conversationId: "123/support",
      parentConversationId: "123",
    });
  });

  it("returns no parentConversationId when stream is wildcard", () => {
    expect(compile("*/standup")).toEqual({
      conversationId: "*/standup",
      parentConversationId: undefined,
    });
  });

  it("returns parentConversationId for exact stream with wildcard topic", () => {
    expect(compile("123/*")).toEqual({
      conversationId: "123/*",
      parentConversationId: "123",
    });
  });
});

// ---------------------------------------------------------------------------
// matchInboundConversation
// ---------------------------------------------------------------------------

describe("zulipBindingsAdapter.matchInboundConversation", () => {
  const binding = { type: "route" as const, agentId: "bot", match: { channel: "zulip" } };

  function match(pattern: string, conversationId: string, parentConversationId?: string) {
    const compiled = zulipBindingsAdapter.compileConfiguredBinding!({
      binding,
      conversationId: pattern,
    })!;
    return zulipBindingsAdapter.matchInboundConversation({
      binding,
      compiledBinding: compiled,
      conversationId,
      parentConversationId,
    });
  }

  it("matches exact stream+topic", () => {
    const result = match("123/support", "123/support", "123");
    expect(result).not.toBeNull();
    expect(result?.conversationId).toBe("123/support");
    expect(result?.matchPriority).toBe(3);
  });

  it("does not match different topic", () => {
    expect(match("123/support", "123/billing", "123")).toBeNull();
  });

  it("does not match different stream", () => {
    expect(match("123/support", "999/support", "999")).toBeNull();
  });

  it("matches wildcard topic (123/*)", () => {
    const result = match("123/*", "123/billing", "123");
    expect(result).not.toBeNull();
    expect(result?.matchPriority).toBe(2);
  });

  it("does not match wildcard-topic pattern for different stream", () => {
    expect(match("123/*", "999/billing", "999")).toBeNull();
  });

  it("matches wildcard stream (*/standup)", () => {
    const result = match("*/standup", "42/standup", "42");
    expect(result).not.toBeNull();
    expect(result?.matchPriority).toBe(1);
  });

  it("does not match wildcard-stream pattern for different topic", () => {
    expect(match("*/standup", "42/billing", "42")).toBeNull();
  });

  it("matches bare stream-level pattern against parentConversationId", () => {
    const result = match("123", "123/any-topic", "123");
    expect(result).not.toBeNull();
    expect(result?.matchPriority).toBe(1);
  });

  it("matches bare pattern exactly for DM", () => {
    const result = match("456", "456");
    expect(result).not.toBeNull();
    expect(result?.matchPriority).toBe(3);
  });

  it("returns null when topic-only pattern has no slash in inbound conversationId", () => {
    expect(match("123/support", "123")).toBeNull();
  });

  it("higher priority for exact > stream-wildcard > topic-wildcard", () => {
    const exact = match("123/support", "123/support", "123");
    const streamWild = match("123/*", "123/support", "123");
    const topicWild = match("*/support", "123/support", "123");

    expect(exact!.matchPriority!).toBeGreaterThan(streamWild!.matchPriority!);
    expect(streamWild!.matchPriority!).toBeGreaterThan(topicWild!.matchPriority!);
  });
});

// ---------------------------------------------------------------------------
// resolveCommandConversation
// ---------------------------------------------------------------------------

describe("zulipBindingsAdapter.resolveCommandConversation", () => {
  const resolveCmd = zulipBindingsAdapter.resolveCommandConversation!;
  const resolve = (params: {
    accountId?: string;
    threadId?: string;
    threadParentId?: string;
    originatingTo?: string;
    commandTo?: string;
    sessionKey?: string;
    parentSessionKey?: string;
    senderId?: string;
    fallbackTo?: string;
  }) => resolveCmd(params as Parameters<typeof resolveCmd>[0]);

  it("returns null when no stream context available", () => {
    expect(resolve({ accountId: "acc" })).toBeNull();
  });

  it("returns topic-scoped ref when threadId is present", () => {
    expect(resolve({ originatingTo: "123", threadId: "support" })).toEqual({
      conversationId: "123/support",
      parentConversationId: "123",
    });
  });

  it("prefers threadParentId over originatingTo for stream", () => {
    expect(resolve({ threadParentId: "123", threadId: "support", originatingTo: "999" })).toEqual({
      conversationId: "123/support",
      parentConversationId: "123",
    });
  });

  it("prefers commandTo over everything", () => {
    expect(resolve({ commandTo: "42", threadId: "billing", originatingTo: "999" })).toEqual({
      conversationId: "42/billing",
      parentConversationId: "42",
    });
  });

  it("returns bare stream ref when no threadId", () => {
    expect(resolve({ originatingTo: "123" })).toEqual({ conversationId: "123" });
  });
});

// ---------------------------------------------------------------------------
// ChannelConversationBindingSupport
// ---------------------------------------------------------------------------

describe("zulipConversationBindingsSupport", () => {
  const ACC = "acc-test";

  beforeEach(() => {
    clearZulipBindingStore(ACC);
  });

  it("supportsCurrentConversationBinding is true", () => {
    expect(zulipConversationBindingsSupport.supportsCurrentConversationBinding).toBe(true);
  });

  describe("setIdleTimeoutBySessionKey", () => {
    it("returns empty array when no bindings exist for session key", () => {
      const result = zulipConversationBindingsSupport.setIdleTimeoutBySessionKey!({
        targetSessionKey: "sk1",
        accountId: ACC,
        idleTimeoutMs: 60_000,
      });
      expect(result).toEqual([]);
    });

    it("updates idleTimeoutMs on matching records", () => {
      const b = makeBinding(ACC, "123/support", "sk1");
      seedBinding(ACC, b);

      const result = zulipConversationBindingsSupport.setIdleTimeoutBySessionKey!({
        targetSessionKey: "sk1",
        accountId: ACC,
        idleTimeoutMs: 30_000,
      });

      expect(result).toHaveLength(1);
      expect(result[0].idleTimeoutMs).toBe(30_000);
      expect(result[0].boundAt).toBe(b.boundAt);
      expect(result[0].lastActivityAt).toBe(b.lastActivityAt);
    });

    it("scopes to accountId when provided", () => {
      seedBinding(ACC, makeBinding(ACC, "123/support", "sk1"));
      seedBinding("other-acc", makeBinding("other-acc", "123/support", "sk1"));

      const result = zulipConversationBindingsSupport.setIdleTimeoutBySessionKey!({
        targetSessionKey: "sk1",
        accountId: ACC,
        idleTimeoutMs: 10_000,
      });

      expect(result).toHaveLength(1);
    });
  });

  describe("setMaxAgeBySessionKey", () => {
    it("updates maxAgeMs on matching records", () => {
      const b = makeBinding(ACC, "123/billing", "sk2");
      seedBinding(ACC, b);

      const result = zulipConversationBindingsSupport.setMaxAgeBySessionKey!({
        targetSessionKey: "sk2",
        accountId: ACC,
        maxAgeMs: 3_600_000,
      });

      expect(result).toHaveLength(1);
      expect(result[0].maxAgeMs).toBe(3_600_000);
    });
  });

  describe("createManager", () => {
    it("returns a manager with stop()", async () => {
      const createManager = zulipConversationBindingsSupport.createManager!;
      const manager = await createManager({
        cfg: {} as Parameters<typeof createManager>[0]["cfg"],
        accountId: ACC,
      });
      expect(manager).toHaveProperty("stop");
      expect(typeof (manager as { stop: () => void }).stop).toBe("function");
      (manager as { stop: () => void }).stop();
    });
  });
});

// ---------------------------------------------------------------------------
// SessionBindingAdapter
// ---------------------------------------------------------------------------

describe("createZulipSessionBindingAdapter", () => {
  const ACC = "acc-adapter";

  beforeEach(() => {
    clearZulipBindingStore(ACC);
  });

  it("binds and lists by session", async () => {
    const adapter = createZulipSessionBindingAdapter(ACC);
    const record = await adapter.bind!({
      targetSessionKey: "sk-test",
      targetKind: "session",
      conversation: {
        channel: "zulip",
        accountId: ACC,
        conversationId: "42/standup",
        parentConversationId: "42",
      },
    });

    expect(record).not.toBeNull();
    expect(record!.targetSessionKey).toBe("sk-test");
    expect(record!.conversation.conversationId).toBe("42/standup");

    const listed = adapter.listBySession("sk-test");
    expect(listed).toHaveLength(1);
    expect(listed[0].bindingId).toBe(record!.bindingId);
  });

  it("returns null for bind when channel/accountId mismatch", async () => {
    const adapter = createZulipSessionBindingAdapter(ACC);
    const result = await adapter.bind!({
      targetSessionKey: "sk-test",
      targetKind: "session",
      conversation: { channel: "slack", accountId: ACC, conversationId: "C123" },
    });
    expect(result).toBeNull();
  });

  it("resolves by conversation", async () => {
    const adapter = createZulipSessionBindingAdapter(ACC);
    await adapter.bind!({
      targetSessionKey: "sk-test",
      targetKind: "session",
      conversation: {
        channel: "zulip",
        accountId: ACC,
        conversationId: "99/support",
      },
    });

    const found = adapter.resolveByConversation({
      channel: "zulip",
      accountId: ACC,
      conversationId: "99/support",
    });
    expect(found).not.toBeNull();
    expect(found!.conversation.conversationId).toBe("99/support");
  });

  it("unbinds by bindingId", async () => {
    const adapter = createZulipSessionBindingAdapter(ACC);
    const record = await adapter.bind!({
      targetSessionKey: "sk-x",
      targetKind: "session",
      conversation: { channel: "zulip", accountId: ACC, conversationId: "1/a" },
    });

    const removed = await adapter.unbind!({ bindingId: record!.bindingId, reason: "test" });
    expect(removed).toHaveLength(1);
    expect(adapter.listBySession("sk-x")).toHaveLength(0);
  });

  it("unbinds by targetSessionKey", async () => {
    const adapter = createZulipSessionBindingAdapter(ACC);
    await adapter.bind!({
      targetSessionKey: "sk-y",
      targetKind: "session",
      conversation: { channel: "zulip", accountId: ACC, conversationId: "1/b" },
    });
    await adapter.bind!({
      targetSessionKey: "sk-y",
      targetKind: "session",
      conversation: { channel: "zulip", accountId: ACC, conversationId: "1/c" },
    });

    const removed = await adapter.unbind!({ targetSessionKey: "sk-y", reason: "test" });
    expect(removed).toHaveLength(2);
    expect(adapter.listBySession("sk-y")).toHaveLength(0);
  });

  it("touches binding updates lastActivityAt", async () => {
    const adapter = createZulipSessionBindingAdapter(ACC);
    const record = await adapter.bind!({
      targetSessionKey: "sk-z",
      targetKind: "session",
      conversation: { channel: "zulip", accountId: ACC, conversationId: "5/f" },
    });

    const future = Date.now() + 5000;
    adapter.touch!(record!.bindingId, future);

    const store = getZulipBindingStore(ACC);
    const updated = store.get(record!.bindingId);
    expect(updated?.lastActivityAt).toBe(future);
  });
});

// ---------------------------------------------------------------------------
// touchZulipBindingByConversation
// ---------------------------------------------------------------------------

describe("touchZulipBindingByConversation", () => {
  const ACC = "acc-touch";

  beforeEach(() => {
    clearZulipBindingStore(ACC);
  });

  it("updates lastActivityAt for matching conversationId", async () => {
    const adapter = createZulipSessionBindingAdapter(ACC);
    const record = await adapter.bind!({
      targetSessionKey: "sk-touch",
      targetKind: "session",
      conversation: { channel: "zulip", accountId: ACC, conversationId: "7/news" },
    });

    const ts = Date.now() + 9999;
    touchZulipBindingByConversation(ACC, "7/news", ts);

    const store = getZulipBindingStore(ACC);
    const updated = store.get(record!.bindingId);
    expect(updated?.lastActivityAt).toBe(ts);
  });

  it("does not update unrelated conversationId", async () => {
    const adapter = createZulipSessionBindingAdapter(ACC);
    const record = await adapter.bind!({
      targetSessionKey: "sk-touch2",
      targetKind: "session",
      conversation: { channel: "zulip", accountId: ACC, conversationId: "7/news" },
    });

    const originalAt = record!.boundAt;
    touchZulipBindingByConversation(ACC, "7/other", Date.now() + 9999);

    const store = getZulipBindingStore(ACC);
    const unchanged = store.get(record!.bindingId);
    expect(unchanged?.lastActivityAt).toBe(originalAt);
  });
});
