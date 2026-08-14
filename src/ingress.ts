import type { ZulipResolvedAccount } from "./types.js";
import type { ZulipMessage } from "./zulip-client.js";
import { resolveStreamConfig } from "./stream-registry.js";

// ---------------------------------------------------------------------------
// Ingress policy — which inbound messages are accepted for processing
//
// Every reason to ignore a message lives here, and the gateway consults it
// once, before anything observable happens. Keeping the checks inline in
// handleInboundMessage made "no side effect before the decision" a property
// of statement ordering inside a 250-line function; here it is structural,
// and the policy is testable without a client or a live server.
// ---------------------------------------------------------------------------

export type IngressDropReason = "self" | "stream-disabled" | "dm-not-allowed";

export type IngressDecision =
  | { action: "process" }
  | { action: "drop"; reason: IngressDropReason; detail: string };

export type IngressInput = {
  account: ZulipResolvedAccount;
  selfUserId: number;
  message: ZulipMessage;
  /**
   * Stream name, when the caller resolved it from somewhere other than the
   * message itself. Defaults to `display_recipient`, which Zulip populates
   * with the stream name on stream messages.
   */
  streamName?: string;
};

export function resolveStreamName(message: ZulipMessage): string | undefined {
  return typeof message.display_recipient === "string"
    ? message.display_recipient
    : undefined;
}

export function resolveIngressDecision(input: IngressInput): IngressDecision {
  const { account, selfUserId, message } = input;

  // Our own messages, echoed back through the event queue.
  if (message.sender_id === selfUserId) {
    return { action: "drop", reason: "self", detail: "message sent by this account" };
  }

  const isStream = message.type === "stream";

  if (isStream) {
    const streamName = input.streamName ?? resolveStreamName(message);
    const streamConfig = resolveStreamConfig(account, {
      streamId: message.stream_id,
      streamName,
    });

    // Only an explicit `enabled: false` drops. Unconfigured streams and
    // streams without an explicit value keep the historical behavior, so
    // adding this gate cannot change how an existing config behaves.
    if (streamConfig?.enabled === false) {
      const label = streamName ? `#${streamName}` : `stream ${message.stream_id}`;
      return {
        action: "drop",
        reason: "stream-disabled",
        detail: `${label} is configured with enabled: false`,
      };
    }

    return { action: "process" };
  }

  // Hard-enforce the DM allowlist: drop messages from unauthorized senders
  // before dispatching to the agent. For dmPolicy "allowlist" the configured
  // allowFrom is authoritative (the pairing store is intentionally not
  // consulted, matching the SDK's own ingress behavior). Other policies keep
  // their existing soft behavior (the agent runs and decides via
  // CommandAuthorized).
  if (account.dmPolicy === "allowlist") {
    const allowFrom = account.allowFrom.map(String);
    const allowed =
      allowFrom.includes(message.sender_email) ||
      allowFrom.includes(String(message.sender_id)) ||
      allowFrom.includes("*");
    if (!allowed) {
      return {
        action: "drop",
        reason: "dm-not-allowed",
        detail: `DM from ${message.sender_email} (id=${message.sender_id}); dmPolicy=allowlist`,
      };
    }
  }

  return { action: "process" };
}
