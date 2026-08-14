import { describe, it, expect, beforeEach } from "vitest";
import {
  rememberStreamName,
  lookupStreamName,
  lookupStreamId,
  hydrateStreamNames,
  clearStreamRegistry,
  resolveStreamConfig,
} from "./stream-registry.js";

const ACCOUNT = "default";

beforeEach(() => {
  clearStreamRegistry(ACCOUNT);
  clearStreamRegistry("other");
});

describe("stream name registry", () => {
  it("remembers and looks up a name by id", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    expect(lookupStreamName(ACCOUNT, 42)).toBe("Homelab");
  });

  it("returns undefined for an unknown id", () => {
    expect(lookupStreamName(ACCOUNT, 999)).toBeUndefined();
  });

  it("ignores empty names", () => {
    rememberStreamName(ACCOUNT, 42, "");
    expect(lookupStreamName(ACCOUNT, 42)).toBeUndefined();
  });

  it("keeps accounts isolated", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    expect(lookupStreamName("other", 42)).toBeUndefined();
  });

  it("hydrates from a stream listing", () => {
    hydrateStreamNames(ACCOUNT, [
      { stream_id: 1, name: "general" },
      { stream_id: 2, name: "Homelab" },
    ]);

    expect(lookupStreamName(ACCOUNT, 1)).toBe("general");
    expect(lookupStreamName(ACCOUNT, 2)).toBe("Homelab");
  });

  it("lets a later rename win", () => {
    rememberStreamName(ACCOUNT, 42, "Old Name");
    hydrateStreamNames(ACCOUNT, [{ stream_id: 42, name: "New Name" }]);

    expect(lookupStreamName(ACCOUNT, 42)).toBe("New Name");
  });

  it("keeps names not present in a hydration batch", () => {
    rememberStreamName(ACCOUNT, 42, "Seen On A Message");
    hydrateStreamNames(ACCOUNT, [{ stream_id: 1, name: "general" }]);

    expect(lookupStreamName(ACCOUNT, 42)).toBe("Seen On A Message");
  });

  it("looks up an id by name", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    expect(lookupStreamId(ACCOUNT, "Homelab")).toBe(42);
  });

  it("looks up an id ignoring case and whitespace", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    expect(lookupStreamId(ACCOUNT, "  homelab ")).toBe(42);
  });

  it("looks up an id for a numerically-named stream", () => {
    rememberStreamName(ACCOUNT, 7, "42");
    expect(lookupStreamId(ACCOUNT, "42")).toBe(7);
  });

  it("returns undefined for an unknown or empty name", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    expect(lookupStreamId(ACCOUNT, "Nowhere")).toBeUndefined();
    expect(lookupStreamId(ACCOUNT, "   ")).toBeUndefined();
  });

  it("keeps reverse lookups account-isolated", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    expect(lookupStreamId("other", "Homelab")).toBeUndefined();
  });

  it("drops everything for an account on clear", () => {
    rememberStreamName(ACCOUNT, 42, "Homelab");
    clearStreamRegistry(ACCOUNT);

    expect(lookupStreamName(ACCOUNT, 42)).toBeUndefined();
  });
});

describe("resolveStreamConfig", () => {
  const account = {
    streams: {
      Homelab: { requireMention: true },
      "AI System": { enabled: false },
      "42": { enabled: false },
    },
  };

  it("matches an exact name", () => {
    expect(resolveStreamConfig(account, { streamName: "Homelab" })).toEqual({
      requireMention: true,
    });
  });

  it("matches ignoring case and whitespace", () => {
    expect(resolveStreamConfig(account, { streamName: " ai system " })).toEqual({
      enabled: false,
    });
  });

  it("matches a numeric key against the stream id", () => {
    expect(resolveStreamConfig(account, { streamId: 42 })).toEqual({ enabled: false });
  });

  it("prefers a name match over an id match", () => {
    const byName = { streams: { Homelab: { enabled: true }, "42": { enabled: false } } };

    expect(resolveStreamConfig(byName, { streamId: 42, streamName: "Homelab" })).toEqual({
      enabled: true,
    });
  });

  it("returns undefined for an unconfigured stream", () => {
    expect(resolveStreamConfig(account, { streamName: "Nowhere" })).toBeUndefined();
  });

  // A numeric key is an ID selector, so it must not also match a stream that
  // happens to be *named* that number — otherwise one key silently configures
  // two unrelated streams. See the PR #63 review.
  it("does not let a numeric key match a stream named that number", () => {
    const cfg = { streams: { "42": { enabled: false } } };

    // Stream ID 43, display name "42" — must not pick up the ID-42 config.
    expect(resolveStreamConfig(cfg, { streamId: 43, streamName: "42" })).toBeUndefined();
    // Stream ID 42 still resolves.
    expect(resolveStreamConfig(cfg, { streamId: 42, streamName: "Homelab" })).toEqual({
      enabled: false,
    });
  });

  it("ignores numeric keys when matching by name only", () => {
    const cfg = { streams: { "42": { enabled: false } } };
    expect(resolveStreamConfig(cfg, { streamName: "42" })).toBeUndefined();
  });

  it("treats a padded numeric key as an ID selector, not a name", () => {
    const cfg = { streams: { " 42 ": { enabled: false } } };

    expect(resolveStreamConfig(cfg, { streamId: 42 })).toEqual({ enabled: false });
    expect(resolveStreamConfig(cfg, { streamName: "42" })).toBeUndefined();
  });

  it("returns undefined when given no identity at all", () => {
    expect(resolveStreamConfig(account, {})).toBeUndefined();
  });

  it("returns undefined when the account has no stream config", () => {
    expect(resolveStreamConfig({ streams: {} }, { streamName: "Homelab" })).toBeUndefined();
  });
});
