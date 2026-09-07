import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import { zulipGatewayAdapter } from "./gateway.js";
import { getZulipBindingStore } from "./bindings.js";
import { clearZulipRuntime, setZulipRuntime } from "./runtime.js";
import { ZulipClient, type ZulipMessage } from "./zulip-client.js";
import type { ZulipResolvedAccount } from "./types.js";

afterEach(() => {
  vi.restoreAllMocks();
  clearZulipRuntime();
});

describe("gateway channel turn dispatch", () => {
  it("fails startup before network access when the plugin runtime is missing", async () => {
    clearZulipRuntime();
    const getOwnUser = vi.spyOn(ZulipClient.prototype, "getOwnUser");
    const abort = new AbortController();
    const account: ZulipResolvedAccount = {
      accountId: "default", mode: "bot", serverUrl: "https://zulip.example.com",
      email: "bot@example.com", apiKey: "test-key", enabled: true, configured: true,
      dmPolicy: "allowlist", allowFrom: [200], replyToMode: "all", streams: {},
    };
    const ctx = {
      accountId: "default", account, cfg: {}, abortSignal: abort.signal,
      setStatus: vi.fn(), getStatus: vi.fn(), runtime: { log: vi.fn(), error: vi.fn() },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as unknown as ChannelGatewayContext<ZulipResolvedAccount>;

    await expect(zulipGatewayAdapter.startAccount!(ctx)).rejects.toThrow(
      "Zulip runtime has not been initialized",
    );
    expect(getOwnUser).not.toHaveBeenCalled();
  });

  it.each([
    { label: "stream", type: "stream", topic: "topic/with/slash", subject: "topic/with/slash" },
    { label: "empty-topic stream", type: "stream", topic: "", subject: "" },
    { label: "private message with an empty subject", type: "private", topic: undefined, subject: "" },
  ] as const)("preserves $label routing, delivery and typing", async ({ type, topic, subject }) => {
    const abort = new AbortController();
    const account: ZulipResolvedAccount = {
      accountId: "default", mode: "bot", serverUrl: "https://zulip.example.com",
      email: "bot@example.com", apiKey: "test-key", enabled: true, configured: true,
      dmPolicy: "allowlist", allowFrom: [200], replyToMode: "all", streams: {},
    };
    const message: ZulipMessage = {
      id: 7, type, sender_id: 200, sender_email: "sender@example.com",
      sender_full_name: "Sender", content: "/status", timestamp: 1_700_000_000,
      subject,
      ...(type === "stream" ? { stream_id: 42 } : {}),
    };
    vi.spyOn(ZulipClient.prototype, "getOwnUser").mockResolvedValue({
      user_id: 100, email: account.email, full_name: "Bot",
    });
    vi.spyOn(ZulipClient.prototype, "getStreams").mockResolvedValue([]);
    vi.spyOn(ZulipClient.prototype, "registerEventQueue").mockResolvedValue({ queue_id: "queue", last_event_id: -1 });
    vi.spyOn(ZulipClient.prototype, "getEvents")
      .mockResolvedValueOnce([{ id: 1, type: "message", message }])
      .mockImplementation(async () => { abort.abort(); return []; });
    const deleteQueue = vi.spyOn(ZulipClient.prototype, "deleteEventQueue").mockResolvedValue(undefined);
    const send = vi.spyOn(ZulipClient.prototype, "sendMessage").mockResolvedValue({ id: 8 });
    const typing = vi.spyOn(ZulipClient.prototype, "sendTypingNotification").mockResolvedValue(undefined);
    const sessionKey = `agent:main:zulip:${type === "stream" ? `group:42/${topic}` : "direct:200"}`;
    const resolveAgentRoute = vi.fn(() => ({ agentId: "main", accountId: "default", sessionKey }));
    const dispatch = vi.fn(async (turn: Parameters<PluginRuntime["channel"]["inbound"]["dispatch"]>[0]) => {
      expect(turn.ctxPayload).toMatchObject({
        Body: "/status", BodyForAgent: "/status", SessionKey: sessionKey,
        SenderId: "sender@example.com", CommandAuthorized: true, MessageSid: "7",
        To: type === "stream" ? "stream:42" : "user:200",
        OriginatingTo: type === "stream" ? "stream:42" : "user:200",
        ...(type === "stream" ? { MessageThreadId: topic, ThreadParentId: "42" } : {}),
      });
      if (type === "private") expect(turn.ctxPayload.MessageThreadId).toBeUndefined();
      await turn.replyPipeline?.typing?.start();
      await turn.delivery.deliver!({ text: "reply" }, { kind: "final" });
      await turn.replyPipeline?.typing?.stop?.();
      abort.abort();
      return { dispatched: true };
    });
    // Only the host runtime boundary is stubbed; SDK context and binding helpers run normally.
    setZulipRuntime({ channel: {
      routing: { resolveAgentRoute },
      commands: { shouldComputeCommandAuthorized: () => true },
      pairing: { readAllowFromStore: async () => [] },
      inbound: { dispatch },
    } } as unknown as PluginRuntime);
    const ctx = {
      accountId: "default", account, cfg: {}, abortSignal: abort.signal,
      setStatus: vi.fn(), getStatus: vi.fn(), runtime: { log: vi.fn(), error: vi.fn() },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as unknown as ChannelGatewayContext<ZulipResolvedAccount>;

    await zulipGatewayAdapter.startAccount!(ctx);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(resolveAgentRoute).toHaveBeenCalledWith(expect.objectContaining({
      peer: { kind: type === "stream" ? "group" : "direct", id: type === "stream" ? `42/${topic}` : "200" },
      parentPeer: type === "stream" ? { kind: "group", id: "42" } : undefined,
    }));
    expect(send).toHaveBeenCalledWith(type === "stream"
      ? { type: "stream", to: "42", topic, content: "reply" }
      : { type: "direct", to: [200], content: "reply" });
    expect(typing.mock.calls.map(([params]) => params.type)).toEqual([type === "stream" ? "stream" : "direct", type === "stream" ? "stream" : "direct"]);
    if (type === "stream") {
      expect(typing.mock.calls.map(([params]) => params.topic)).toEqual([topic, topic]);
    }
    expect(typing.mock.calls.map(([params]) => params.op)).toEqual(["start", "stop"]);
    expect(deleteQueue).toHaveBeenCalledWith("queue");
    expect(getZulipBindingStore(account.accountId).size).toBe(0);
    expect(ctx.log?.error).not.toHaveBeenCalled();
  });
});
