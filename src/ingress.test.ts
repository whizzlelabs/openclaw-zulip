import { describe, it, expect } from "vitest";
import { resolveIngressDecision, resolveStreamName } from "./ingress.js";
import type { ZulipResolvedAccount, ZulipStreamConfig } from "./types.js";
import type { ZulipMessage } from "./zulip-client.js";

const SELF_ID = 100;

function makeAccount(
  overrides: Partial<ZulipResolvedAccount> = {},
): ZulipResolvedAccount {
  return {
    accountId: "default",
    mode: "bot",
    serverUrl: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "secret-key",
    enabled: true,
    configured: true,
    dmPolicy: "pairing",
    allowFrom: [],
    replyToMode: "all",
    streams: {},
    ...overrides,
  };
}

function streamMessage(overrides: Partial<ZulipMessage> = {}): ZulipMessage {
  return {
    id: 1,
    sender_id: 200,
    sender_email: "someone@example.com",
    sender_full_name: "Someone",
    type: "stream",
    stream_id: 42,
    subject: "a topic",
    display_recipient: "Claudestial Planetarium",
    content: "hello",
    timestamp: 1_700_000_000,
    ...overrides,
  };
}

function dmMessage(overrides: Partial<ZulipMessage> = {}): ZulipMessage {
  return {
    id: 2,
    sender_id: 200,
    sender_email: "someone@example.com",
    sender_full_name: "Someone",
    type: "private",
    display_recipient: [
      { id: 200, email: "someone@example.com", full_name: "Someone" },
      { id: SELF_ID, email: "bot@example.com", full_name: "Bot" },
    ],
    content: "hello",
    timestamp: 1_700_000_000,
    ...overrides,
  };
}

function decide(account: ZulipResolvedAccount, message: ZulipMessage) {
  return resolveIngressDecision({ account, selfUserId: SELF_ID, message });
}

function withStream(name: string, config: ZulipStreamConfig) {
  return makeAccount({ streams: { [name]: config } });
}

describe("resolveIngressDecision — stream gating", () => {
  it("drops a message in a stream configured with enabled: false", () => {
    const account = withStream("Claudestial Planetarium", { enabled: false });
    const decision = decide(account, streamMessage());

    expect(decision.action).toBe("drop");
    expect(decision).toMatchObject({ reason: "stream-disabled" });
  });

  it("processes a message in a stream configured with enabled: true", () => {
    const account = withStream("Claudestial Planetarium", { enabled: true });
    expect(decide(account, streamMessage()).action).toBe("process");
  });

  it("processes a message in an unconfigured stream", () => {
    expect(decide(makeAccount(), streamMessage()).action).toBe("process");
  });

  it("processes a stream configured without an explicit enabled value", () => {
    const account = withStream("Claudestial Planetarium", { requireMention: true });
    expect(decide(account, streamMessage()).action).toBe("process");
  });

  it("matches config keys that differ in case and surrounding whitespace", () => {
    const account = withStream("  claudestial planetarium  ", { enabled: false });
    expect(decide(account, streamMessage()).action).toBe("drop");
  });

  it("matches a numeric config key against the stream id", () => {
    const account = withStream("42", { enabled: false });
    const message = streamMessage({ display_recipient: "Renamed Since Config" });

    expect(decide(account, message).action).toBe("drop");
  });

  it("does not confuse a different stream with a disabled one", () => {
    const account = withStream("Claudestial Planetarium", { enabled: false });
    const message = streamMessage({ stream_id: 43, display_recipient: "Homelab" });

    expect(decide(account, message).action).toBe("process");
  });

  it("suppresses messages from another OpenClaw identity in a disabled stream", () => {
    const account = withStream("Claudestial Planetarium", { enabled: false });
    const message = streamMessage({
      sender_id: 300,
      sender_email: "other-bot@example.com",
      sender_full_name: "Other OpenClaw Bot",
    });

    expect(decide(account, message)).toMatchObject({
      action: "drop",
      reason: "stream-disabled",
    });
  });

  it("decides per account when several accounts share a stream", () => {
    const passive = withStream("Claudestial Planetarium", { enabled: false });
    const active = makeAccount({ accountId: "active" });
    const message = streamMessage();

    expect(decide(passive, message).action).toBe("drop");
    expect(decide(active, message).action).toBe("process");
  });

  it("prefers an explicitly supplied stream name over display_recipient", () => {
    const account = withStream("Resolved Name", { enabled: false });
    const message = streamMessage({ display_recipient: "Stale Name" });

    const decision = resolveIngressDecision({
      account,
      selfUserId: SELF_ID,
      message,
      streamName: "Resolved Name",
    });

    expect(decision.action).toBe("drop");
  });

  it("never gates DMs on stream config", () => {
    const account = withStream("Claudestial Planetarium", { enabled: false });
    expect(decide(account, dmMessage()).action).toBe("process");
  });
});

describe("resolveIngressDecision — self filtering", () => {
  it("drops our own messages", () => {
    const decision = decide(makeAccount(), streamMessage({ sender_id: SELF_ID }));

    expect(decision).toMatchObject({ action: "drop", reason: "self" });
  });

  it("drops our own DMs", () => {
    expect(decide(makeAccount(), dmMessage({ sender_id: SELF_ID }))).toMatchObject({
      action: "drop",
      reason: "self",
    });
  });

  it("drops our own message before consulting stream config", () => {
    const account = withStream("Claudestial Planetarium", { enabled: true });
    const decision = decide(account, streamMessage({ sender_id: SELF_ID }));

    expect(decision).toMatchObject({ action: "drop", reason: "self" });
  });
});

// Regression guard for the allowlist logic moved out of gateway.ts — these
// cases must keep behaving exactly as they did inline.
describe("resolveIngressDecision — DM allowlist", () => {
  it("drops an unlisted sender under dmPolicy allowlist", () => {
    const account = makeAccount({ dmPolicy: "allowlist", allowFrom: ["other@example.com"] });

    expect(decide(account, dmMessage())).toMatchObject({
      action: "drop",
      reason: "dm-not-allowed",
    });
  });

  it("allows a sender listed by email", () => {
    const account = makeAccount({ dmPolicy: "allowlist", allowFrom: ["someone@example.com"] });
    expect(decide(account, dmMessage()).action).toBe("process");
  });

  it("allows a sender listed by numeric user id", () => {
    const account = makeAccount({ dmPolicy: "allowlist", allowFrom: [200] });
    expect(decide(account, dmMessage()).action).toBe("process");
  });

  it("allows any sender under a wildcard", () => {
    const account = makeAccount({ dmPolicy: "allowlist", allowFrom: ["*"] });
    expect(decide(account, dmMessage()).action).toBe("process");
  });

  it("leaves other dm policies to the soft CommandAuthorized path", () => {
    const account = makeAccount({ dmPolicy: "pairing", allowFrom: [] });
    expect(decide(account, dmMessage()).action).toBe("process");
  });

  it("does not apply the DM allowlist to stream messages", () => {
    const account = makeAccount({ dmPolicy: "allowlist", allowFrom: ["other@example.com"] });
    expect(decide(account, streamMessage()).action).toBe("process");
  });
});

describe("resolveStreamName", () => {
  it("returns the stream name for stream messages", () => {
    expect(resolveStreamName(streamMessage())).toBe("Claudestial Planetarium");
  });

  it("returns undefined for DMs, where display_recipient is a user list", () => {
    expect(resolveStreamName(dmMessage())).toBeUndefined();
  });
});
