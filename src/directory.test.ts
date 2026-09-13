import { afterEach, describe, expect, it, vi } from "vitest";
import { zulipDirectoryAdapter } from "./directory.js";
import { ZulipClient } from "./zulip-client.js";

const cfg = {
  channels: { zulip: { serverUrl: "https://zulip.example.com", email: "bot@example.com", apiKey: "test-key" } },
};
const params = { cfg, accountId: "default", runtime: {} } as Parameters<
  NonNullable<typeof zulipDirectoryAdapter.listGroups>
>[0];

afterEach(() => vi.restoreAllMocks());

describe("Zulip directory discovery", () => {
  it("finds both people and bots by name or email for new DMs", async () => {
    vi.spyOn(ZulipClient.prototype, "getUsers").mockResolvedValue([
      { user_id: 10, email: "reader@example.com", full_name: "Reader", is_bot: false },
      { user_id: 11, email: "helper-bot@example.com", full_name: "Helper Bot", is_bot: true },
    ]);

    expect(await zulipDirectoryAdapter.listPeers!({ ...params, query: "helper" })).toEqual([
      { kind: "user", id: "11", name: "Helper Bot", handle: "helper-bot@example.com" },
    ]);
    expect(await zulipDirectoryAdapter.listPeers!({ ...params, query: "reader@example.com" })).toEqual([
      { kind: "user", id: "10", name: "Reader", handle: "reader@example.com" },
    ]);
  });

  it("lists streams by name or ID without fetching their topics", async () => {
    vi.spyOn(ZulipClient.prototype, "getStreams").mockResolvedValue([
      { stream_id: 42, name: "general", description: "", invite_only: false },
    ]);
    const topics = vi.spyOn(ZulipClient.prototype, "getStreamTopics");

    expect(await zulipDirectoryAdapter.listGroups!({ ...params, query: "42" })).toEqual([
      { kind: "group", id: "42", name: "general" },
    ]);
    expect(topics).not.toHaveBeenCalled();
  });

  it("explores one stream's topics and returns exact topic IDs", async () => {
    vi.spyOn(ZulipClient.prototype, "getStreams").mockResolvedValue([
      { stream_id: 42, name: "general", description: "", invite_only: false },
      { stream_id: 43, name: "other", description: "", invite_only: false },
    ]);
    const topics = vi.spyOn(ZulipClient.prototype, "getStreamTopics").mockResolvedValue([
      { name: "releases", max_id: 20 },
      { name: "operations", max_id: 19 },
      { name: "", max_id: 18 },
    ]);

    expect(await zulipDirectoryAdapter.listGroups!({ ...params, query: "42/release" })).toEqual([
      { kind: "group", id: "42/releases", name: "general/releases" },
    ]);
    expect(await zulipDirectoryAdapter.listGroups!({ ...params, query: "42/" })).toEqual([
      { kind: "group", id: "42/releases", name: "general/releases" },
      { kind: "group", id: "42/operations", name: "general/operations" },
    ]);
    expect(topics).toHaveBeenCalledTimes(2);
    expect(topics).toHaveBeenNthCalledWith(1, 42);
    expect(topics).toHaveBeenNthCalledWith(2, 42);
  });

  it("finds stream names containing a slash without fetching topics", async () => {
    vi.spyOn(ZulipClient.prototype, "getStreams").mockResolvedValue([
      { stream_id: 41, name: "ops", description: "", invite_only: false },
      { stream_id: 42, name: "ops/alerts", description: "", invite_only: false },
    ]);
    const topics = vi.spyOn(ZulipClient.prototype, "getStreamTopics").mockResolvedValue([]);

    expect(await zulipDirectoryAdapter.listGroups!({ ...params, query: "ops/alerts" })).toEqual([
      { kind: "group", id: "42", name: "ops/alerts" },
    ]);
    expect(topics).not.toHaveBeenCalled();
    expect(await zulipDirectoryAdapter.listGroups!({ ...params, query: "ops/ale" })).toEqual([
      { kind: "group", id: "42", name: "ops/alerts" },
    ]);
    topics.mockResolvedValue([{ name: "incidents", max_id: 20 }]);
    expect(await zulipDirectoryAdapter.listGroups!({ ...params, query: "ops/inc" })).toEqual([
      { kind: "group", id: "41/incidents", name: "ops/incidents" },
    ]);
    expect(topics).toHaveBeenLastCalledWith(41);
  });

  it("uses only stream IDs for numeric topic selectors", async () => {
    vi.spyOn(ZulipClient.prototype, "getStreams").mockResolvedValue([
      { stream_id: 41, name: "42", description: "", invite_only: false },
      { stream_id: 42, name: "general", description: "", invite_only: false },
    ]);
    const topics = vi.spyOn(ZulipClient.prototype, "getStreamTopics").mockResolvedValue([
      { name: "releases", max_id: 20 },
    ]);

    expect(await zulipDirectoryAdapter.listGroups!({ ...params, query: "42/" })).toEqual([
      { kind: "group", id: "42/releases", name: "general/releases" },
    ]);
    expect(topics).toHaveBeenCalledExactlyOnceWith(42);
  });
});
