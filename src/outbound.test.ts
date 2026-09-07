import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOutboundTarget, zulipOutboundAdapter } from "./outbound.js";
import { ZulipClient } from "./zulip-client.js";

afterEach(() => vi.restoreAllMocks());

describe("resolveOutboundTarget", () => {
  it("treats numeric string as DM when no threadId", () => {
    const result = resolveOutboundTarget("8", undefined);
    expect(result).toEqual({ type: "direct", to: [8] });
  });

  it("treats numeric string with threadId as stream message", () => {
    const result = resolveOutboundTarget("42", "general");
    expect(result).toEqual({ type: "stream", to: "42", topic: "general" });
  });

  it("treats a bare email as a DM after host normalization", () => {
    const result = resolveOutboundTarget("alice@example.com", undefined);
    expect(result).toEqual({ type: "direct", to: ["alice@example.com"] });
  });

  it("treats a bare email with an empty thread id as a DM", () => {
    const result = resolveOutboundTarget("alice@example.com", "");
    expect(result).toEqual({ type: "direct", to: ["alice@example.com"] });
  });

  it("handles user: prefix with numeric ID", () => {
    const result = resolveOutboundTarget("user:8", "some-topic");
    expect(result).toEqual({ type: "direct", to: [8] });
  });

  it("handles user: prefix with email address", () => {
    const result = resolveOutboundTarget("user:alice@example.com", "some-topic");
    expect(result).toEqual({ type: "direct", to: ["alice@example.com"] });
  });

  it("handles dm: prefix with numeric ID", () => {
    const result = resolveOutboundTarget("dm:8", undefined);
    expect(result).toEqual({ type: "direct", to: [8] });
  });

  it("handles dm: prefix with email address", () => {
    const result = resolveOutboundTarget("dm:bob@example.com", undefined);
    expect(result).toEqual({ type: "direct", to: ["bob@example.com"] });
  });

  it("user: prefix overrides threadId (always DM)", () => {
    const result = resolveOutboundTarget("user:42", "topic");
    expect(result).toEqual({ type: "direct", to: [42] });
  });

  it("splits stream/topic from to when no threadId", () => {
    const result = resolveOutboundTarget("Jeeves/agent-output", undefined);
    expect(result).toEqual({ type: "stream", to: "Jeeves", topic: "agent-output" });
  });

  it("handles an explicit stream target", () => {
    const result = resolveOutboundTarget("stream:Jeeves/agent-output", undefined);
    expect(result).toEqual({ type: "stream", to: "Jeeves", topic: "agent-output" });
  });

  it("splits stream/topic from to with numeric stream ID", () => {
    const result = resolveOutboundTarget("42/general", undefined);
    expect(result).toEqual({ type: "stream", to: "42", topic: "general" });
  });

  it("explicit threadId overrides embedded topic", () => {
    const result = resolveOutboundTarget("Jeeves/agent-output", "override-topic");
    expect(result).toEqual({ type: "stream", to: "Jeeves", topic: "override-topic" });
  });

  it("treats an empty thread id on a bare numeric target as a DM", () => {
    const result = resolveOutboundTarget("8", "");
    expect(result).toEqual({ type: "direct", to: [8] });
  });

  it("preserves an empty topic supplied with an explicit stream", () => {
    const result = resolveOutboundTarget("stream:8", "");
    expect(result).toEqual({ type: "stream", to: "8", topic: "" });
  });

  it("preserves an empty topic embedded in a stream target", () => {
    const result = resolveOutboundTarget("stream:8/", undefined);
    expect(result).toEqual({ type: "stream", to: "8", topic: "" });
  });

  it("does not let an empty thread id override an embedded topic", () => {
    const result = resolveOutboundTarget("stream:8/actual-topic", "");
    expect(result).toEqual({ type: "stream", to: "8", topic: "actual-topic" });
  });

  it("handles null threadId as DM", () => {
    const result = resolveOutboundTarget("8", null);
    expect(result).toEqual({ type: "direct", to: [8] });
  });

  it("rejects a topic-less explicit stream", () => {
    expect(() => resolveOutboundTarget("stream:42", undefined)).toThrow(
      "Zulip stream targets require a topic",
    );
  });

  it("rejects an ambiguous bare target", () => {
    expect(() => resolveOutboundTarget("general", undefined)).toThrow(
      "Ambiguous Zulip target",
    );
  });

  it("rejects a topic-less stream before any Zulip API call", async () => {
    const sendMessage = vi.spyOn(ZulipClient.prototype, "sendMessage");
    const cfg = {
      channels: { zulip: { accounts: { default: {
        serverUrl: "https://zulip.example.com",
        email: "bot@example.com",
        apiKey: "test-key",
      } } } },
    };

    await expect(zulipOutboundAdapter.sendText!({
      cfg,
      accountId: "default",
      to: "stream:42",
      text: "must not send",
    })).rejects.toThrow("Zulip stream targets require a topic");
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
