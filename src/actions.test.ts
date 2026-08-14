import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { zulipActionsAdapter, resolveStreamNarrowOperand } from "./actions.js";
import { lookupStreamName, clearStreamRegistry } from "./stream-registry.js";

vi.mock("./outbound.js", () => ({
  buildClient: vi.fn(),
}));

const baseCfg = {
  channels: {
    zulip: {
      accounts: {
        default: {
          enabled: true,
          serverUrl: "https://zulip.example.com",
          email: "bot@example.com",
          apiKey: "key",
        },
      },
    },
  },
} as any;

const HOMELAB = { stream_id: 17, name: "Homelab", description: "", invite_only: false };

/** Records what reached searchMessages so the narrow can be asserted on. */
function searchClient(overrides: Record<string, unknown> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    client: {
      getStreamById: async (id: number) => {
        if (id !== 17) throw new Error(`No such stream ${id}`);
        return HOMELAB;
      },
      searchMessages: async (params: Record<string, unknown>) => {
        calls.push(params);
        return [];
      },
      ...overrides,
    } as any,
  };
}

async function runSearch(params: Record<string, unknown>, overrides = {}) {
  const { buildClient } = await import("./outbound.js");
  const { calls, client } = searchClient(overrides);
  vi.mocked(buildClient).mockReturnValue(client);

  const result = await zulipActionsAdapter.handleAction!({
    cfg: baseCfg,
    accountId: "default",
    action: "search",
    params,
  } as any);

  return { result, calls };
}

const narrowOf = (calls: Array<Record<string, unknown>>) =>
  (calls[0]?.narrow ?? []) as Array<{ operator: string; operand: string }>;

beforeEach(() => {
  clearStreamRegistry("default");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveStreamNarrowOperand", () => {
  const client = {
    getStreamById: async (id: number) => {
      if (id !== 17) throw new Error(`No such stream ${id}`);
      return HOMELAB;
    },
  };

  it("resolves a numeric id to the canonical stream name", async () => {
    expect(await resolveStreamNarrowOperand(client, 17)).toEqual({
      ok: true,
      operand: "Homelab",
      streamId: 17,
    });
  });

  it("resolves a numeric id passed as a string", async () => {
    expect(await resolveStreamNarrowOperand(client, "17")).toEqual({
      ok: true,
      operand: "Homelab",
      streamId: 17,
    });
  });

  it("resolves a padded numeric id", async () => {
    expect(await resolveStreamNarrowOperand(client, " 17 ")).toEqual({
      ok: true,
      operand: "Homelab",
      streamId: 17,
    });
  });

  // The schema types the field as a number, but agents do pass names. A name is
  // already what the narrow operator wants, so it needs no round trip.
  it("passes a non-numeric value through as a stream name", async () => {
    expect(await resolveStreamNarrowOperand(client, "Homelab")).toEqual({
      ok: true,
      operand: "Homelab",
    });
  });

  it("does not call the API for a non-numeric value", async () => {
    let called = false;
    const spy = {
      getStreamById: async () => {
        called = true;
        return HOMELAB;
      },
    };
    await resolveStreamNarrowOperand(spy, "Homelab");
    expect(called).toBe(false);
  });

  it("reports an unresolvable id instead of guessing", async () => {
    const result = await resolveStreamNarrowOperand(client, 999);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("999");
  });

  it("rejects an empty value", async () => {
    expect((await resolveStreamNarrowOperand(client, "")).ok).toBe(false);
    expect((await resolveStreamNarrowOperand(client, "   ")).ok).toBe(false);
  });

  it("reports a stream with no usable name", async () => {
    const nameless = { getStreamById: async () => ({ stream_id: 17, name: "" }) };
    expect((await resolveStreamNarrowOperand(nameless, 17)).ok).toBe(false);
  });
});

describe("search action narrow", () => {
  // Issue #64: the numeric ID went in as the operand, so Zulip looked for a
  // channel *named* "17" and failed the whole search.
  it("sends the stream name, not the id", async () => {
    const { calls } = await runSearch({ zulip_stream_id: 17 });

    expect(narrowOf(calls)).toEqual([{ operator: "stream", operand: "Homelab" }]);
  });

  it("combines a resolved stream with a topic", async () => {
    const { calls } = await runSearch({ zulip_stream_id: 17, zulip_topic: "soak" });

    expect(narrowOf(calls)).toEqual([
      { operator: "stream", operand: "Homelab" },
      { operator: "topic", operand: "soak" },
    ]);
  });

  it("keeps topic-only search unchanged", async () => {
    const { calls } = await runSearch({ zulip_topic: "soak" });

    expect(narrowOf(calls)).toEqual([{ operator: "topic", operand: "soak" }]);
  });

  it("keeps query-only search unchanged", async () => {
    const { calls } = await runSearch({ zulip_query: "deploy" });

    expect(narrowOf(calls)).toEqual([{ operator: "search", operand: "deploy" }]);
  });

  it("errors without issuing a search when the stream id is unknown", async () => {
    const { result, calls } = await runSearch({ zulip_stream_id: 999, zulip_topic: "soak" });

    expect(calls).toHaveLength(0);
    expect(result.details).toEqual({ ok: false });
    expect(result.content[0].text).toContain("999");
  });

  it("passes the limit through as num_before", async () => {
    const { calls } = await runSearch({ zulip_query: "deploy", zulip_limit: 25 });

    expect(calls[0]).toMatchObject({ anchor: "newest", numBefore: 25, numAfter: 0 });
  });

  it("caches the resolved name for per-stream config lookups", async () => {
    await runSearch({ zulip_stream_id: 17 });

    expect(lookupStreamName("default", 17)).toBe("Homelab");
  });

  it("does not cache anything when the caller supplied a name", async () => {
    await runSearch({ zulip_stream_id: "Homelab" });

    expect(lookupStreamName("default", 17)).toBeUndefined();
  });
});
