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

function requireMention(cfg: CoreConfig, groupId: string | undefined) {
  return zulipGroupsAdapter.resolveRequireMention?.({
    cfg,
    accountId: ACCOUNT,
    groupId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
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
