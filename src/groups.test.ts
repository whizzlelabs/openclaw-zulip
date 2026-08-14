import { describe, it, expect, beforeEach } from "vitest";
import { zulipGroupsAdapter } from "./groups.js";
import { rememberStreamName, clearStreamRegistry } from "./stream-registry.js";
import type { CoreConfig, ZulipStreamConfig } from "./types.js";

const ACCOUNT = "default";

function makeConfig(streams: Record<string, ZulipStreamConfig>): CoreConfig {
  return {
    channels: {
      zulip: {
        accounts: {
          [ACCOUNT]: {
            serverUrl: "https://zulip.example.com",
            email: "bot@example.com",
            apiKey: "secret-key",
            streams,
          },
        },
      },
    },
  } as CoreConfig;
}

function requireMention(
  cfg: CoreConfig,
  groupId: string | undefined,
  groupChannel?: string,
) {
  return zulipGroupsAdapter.resolveRequireMention?.({
    cfg,
    accountId: ACCOUNT,
    groupId,
    groupChannel,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

/**
 * The shape the SDK actually hands us for a Zulip stream message.
 *
 * resolveGroupSessionKey() cannot parse this plugin's bare "<stream_id>"
 * OriginatingTo, so it falls back to ctx.From — meaning groupId arrives as the
 * *sender's email*. The stream name comes through groupChannel instead. See
 * the PR #63 review; the earlier synthetic `groupId: "42"` tests missed this.
 */
function gatewayShaped(cfg: CoreConfig, streamName: string, senderEmail = "alice@example.com") {
  return requireMention(cfg, senderEmail, `#${streamName}`);
}

beforeEach(() => {
  clearStreamRegistry(ACCOUNT);
});

describe("resolveRequireMention", () => {
  it("resolves a stream ID to its configured name", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    const cfg = makeConfig({ Homelab: { requireMention: true } });

    expect(requireMention(cfg, "42")).toBe(true);
  });

  // Before the stream registry existed, resolveRequireMention returned true if
  // *any* stream set requireMention, silently mention-gating every stream on
  // the account. See #61.
  it("does not leak one stream's requireMention onto another", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    rememberStreamName(ACCOUNT, 43, "Chatty");
    const cfg = makeConfig({ Homelab: { requireMention: true } });

    expect(requireMention(cfg, "42")).toBe(true);
    expect(requireMention(cfg, "43")).toBeUndefined();
  });

  it("honors an explicit requireMention: false over another stream's true", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    rememberStreamName(ACCOUNT, 43, "Chatty");
    const cfg = makeConfig({
      Homelab: { requireMention: true },
      Chatty: { requireMention: false },
    });

    expect(requireMention(cfg, "43")).toBe(false);
  });

  it("returns undefined for an unconfigured stream", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    expect(requireMention(makeConfig({}), "42")).toBeUndefined();
  });

  it("returns undefined without a groupId", () => {
    expect(requireMention(makeConfig({ Homelab: { requireMention: true } }), undefined)).toBeUndefined();
  });

  it("falls back to a numeric config key when the name is unknown", () => {
    const cfg = makeConfig({ "42": { requireMention: true } });
    expect(requireMention(cfg, "42")).toBe(true);
  });

  it("accepts a topic-qualified group id", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    const cfg = makeConfig({ Homelab: { requireMention: true } });

    expect(requireMention(cfg, "42/some topic")).toBe(true);
  });

  it("accepts a group id that is already a stream name", () => {
    const cfg = makeConfig({ Homelab: { requireMention: true } });
    expect(requireMention(cfg, "Homelab")).toBe(true);
  });
});

// The synthetic `groupId: "42"` cases above do not reflect what the SDK passes
// at runtime. These do.
describe("resolveRequireMention — gateway-shaped context", () => {
  it("resolves the stream from groupChannel when groupId is a sender email", () => {
    const cfg = makeConfig({ Homelab: { requireMention: true } });
    expect(gatewayShaped(cfg, "Homelab")).toBe(true);
  });

  it("returns undefined for an unconfigured stream in the runtime shape", () => {
    const cfg = makeConfig({ Homelab: { requireMention: true } });
    expect(gatewayShaped(cfg, "Chatty")).toBeUndefined();
  });

  it("does not leak requireMention across streams in the runtime shape", () => {
    const cfg = makeConfig({
      Homelab: { requireMention: true },
      Chatty: { requireMention: false },
    });

    expect(gatewayShaped(cfg, "Homelab")).toBe(true);
    expect(gatewayShaped(cfg, "Chatty")).toBe(false);
  });

  it("does not treat the sender email as a stream name", () => {
    const cfg = makeConfig({ "alice@example.com": { requireMention: true } });
    expect(gatewayShaped(cfg, "Homelab")).toBeUndefined();
  });

  it("matches groupChannel ignoring case and whitespace", () => {
    const cfg = makeConfig({ "  homelab  ": { requireMention: true } });
    expect(gatewayShaped(cfg, "Homelab")).toBe(true);
  });

  it("prefers groupChannel over a registry name for the same groupId", () => {
    rememberStreamName(ACCOUNT, 42, "Stale");
    const cfg = makeConfig({ Homelab: { requireMention: true }, Stale: { requireMention: false } });

    expect(requireMention(cfg, "42", "#Homelab")).toBe(true);
  });

  it("returns undefined when neither identity is usable", () => {
    const cfg = makeConfig({ Homelab: { requireMention: true } });
    expect(requireMention(cfg, undefined, undefined)).toBeUndefined();
    expect(requireMention(cfg, "", "#")).toBeUndefined();
  });

  // groupId never carries a stream ID in the runtime shape, so an ID-keyed
  // entry is only reachable by recovering the ID from the name.
  it("honors ID-keyed config when only the name is supplied", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    const cfg = makeConfig({ "42": { requireMention: true } });

    expect(gatewayShaped(cfg, "Homelab")).toBe(true);
  });

  // Stream ID 7 whose *name* is "42": resolveStreamConfig refuses to match a
  // numeric name, so this only works via the recovered ID.
  it("honors ID-keyed config for a numerically-named stream", () => {
    rememberStreamName(ACCOUNT, 7, "42");
    const cfg = makeConfig({ "7": { requireMention: true } });

    expect(gatewayShaped(cfg, "42")).toBe(true);
  });

  it("does not confuse a numerically-named stream with the ID it resembles", () => {
    rememberStreamName(ACCOUNT, 7, "42");
    const cfg = makeConfig({ "42": { requireMention: true } });

    // Config key "42" selects stream ID 42, which is not this stream (ID 7).
    expect(gatewayShaped(cfg, "42")).toBeUndefined();
  });

  it("returns undefined when the name is unknown to the registry", () => {
    const cfg = makeConfig({ "42": { requireMention: true } });
    expect(gatewayShaped(cfg, "Homelab")).toBeUndefined();
  });

  // A rename is never observed directly (message events only), so the registry
  // must not let a reused name resolve back to the stream that gave it up.
  it("applies the current stream's config after a rename and name reuse", () => {
    rememberStreamName(ACCOUNT, 42, "Ops");
    rememberStreamName(ACCOUNT, 43, "Chat");
    // 42 renamed away unseen; 43 renamed to "Ops" and posts.
    rememberStreamName(ACCOUNT, 43, "Ops");

    const cfg = makeConfig({
      "42": { requireMention: true },
      "43": { requireMention: false },
    });

    expect(gatewayShaped(cfg, "Ops")).toBe(false);
  });
});

// The gateway sets GroupChannel to `#${display_recipient}`, so a stream whose
// name already starts with "#" arrives double-prefixed.
describe("resolveRequireMention — stream names containing punctuation", () => {
  it("preserves a leading # that is part of the stream name", () => {
    const cfg = makeConfig({ "#ops": { requireMention: true } });

    expect(requireMention(cfg, "alice@example.com", "##ops")).toBe(true);
  });

  it("does not match the un-prefixed name for a #-named stream", () => {
    const cfg = makeConfig({ ops: { requireMention: true } });

    expect(requireMention(cfg, "alice@example.com", "##ops")).toBeUndefined();
  });

  it("still strips the single synthetic prefix for ordinary names", () => {
    const cfg = makeConfig({ Homelab: { requireMention: true } });

    expect(requireMention(cfg, "alice@example.com", "#Homelab")).toBe(true);
  });
});

describe("resolveGroupIntroHint", () => {
  it("describes a bot account", () => {
    const hint = zulipGroupsAdapter.resolveGroupIntroHint?.({
      cfg: makeConfig({}),
      accountId: ACCOUNT,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(hint).toContain("bot account");
    expect(hint).toContain("topic");
  });
});
