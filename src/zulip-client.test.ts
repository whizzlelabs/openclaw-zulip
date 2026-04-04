import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZulipClient } from "./zulip-client.js";

function mockFetch(response: Record<string, unknown>, status = 200) {
  return vi.fn().mockResolvedValue({
    status,
    headers: new Headers(),
    json: () => Promise.resolve(response),
  });
}

describe("ZulipClient", () => {
  const config = {
    serverUrl: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "test-api-key",
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends correct Basic auth header", async () => {
    const fetchSpy = mockFetch({ result: "success", id: 42 });
    globalThis.fetch = fetchSpy;

    const client = new ZulipClient(config);
    await client.sendMessage({ type: "stream", to: "general", topic: "test", content: "hello" });

    const expectedAuth =
      "Basic " + Buffer.from("bot@example.com:test-api-key").toString("base64");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Authorization).toBe(expectedAuth);
  });

  it("strips trailing slash from server URL", async () => {
    const fetchSpy = mockFetch({ result: "success", id: 1 });
    globalThis.fetch = fetchSpy;

    const client = new ZulipClient({ ...config, serverUrl: "https://zulip.example.com///" });
    await client.sendMessage({ type: "stream", to: "general", topic: "hi", content: "test" });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("https://zulip.example.com/api/v1/messages");
  });

  describe("sendMessage", () => {
    it("sends a stream message", async () => {
      const fetchSpy = mockFetch({ result: "success", id: 99 });
      globalThis.fetch = fetchSpy;

      const client = new ZulipClient(config);
      const res = await client.sendMessage({
        type: "stream",
        to: "general",
        topic: "greetings",
        content: "Hello world",
      });

      expect(res.id).toBe(99);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain("/api/v1/messages");
      expect(init.method).toBe("POST");
      const body = new URLSearchParams(init.body);
      expect(body.get("type")).toBe("stream");
      expect(body.get("to")).toBe("general");
      expect(body.get("topic")).toBe("greetings");
      expect(body.get("content")).toBe("Hello world");
    });

    it("sends a DM with JSON array of user ids", async () => {
      const fetchSpy = mockFetch({ result: "success", id: 50 });
      globalThis.fetch = fetchSpy;

      const client = new ZulipClient(config);
      await client.sendMessage({
        type: "direct",
        to: [123, 456],
        content: "hey",
      });

      const body = new URLSearchParams(fetchSpy.mock.calls[0][1].body);
      expect(body.get("type")).toBe("direct");
      expect(body.get("to")).toBe("[123,456]");
    });
  });

  describe("registerEventQueue", () => {
    it("registers with event types", async () => {
      const fetchSpy = mockFetch({
        result: "success",
        queue_id: "q-123",
        last_event_id: -1,
      });
      globalThis.fetch = fetchSpy;

      const client = new ZulipClient(config);
      const res = await client.registerEventQueue({ eventTypes: ["message"] });

      expect(res.queue_id).toBe("q-123");
      expect(res.last_event_id).toBe(-1);
      const body = new URLSearchParams(fetchSpy.mock.calls[0][1].body);
      expect(body.get("event_types")).toBe('["message"]');
    });
  });

  describe("getEvents", () => {
    it("polls with correct query params", async () => {
      const fetchSpy = mockFetch({
        result: "success",
        events: [{ id: 0, type: "heartbeat" }],
      });
      globalThis.fetch = fetchSpy;

      const client = new ZulipClient(config);
      const events = await client.getEvents({ queueId: "q-123", lastEventId: -1 });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("heartbeat");
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain("queue_id=q-123");
      expect(url).toContain("last_event_id=-1");
    });
  });

  describe("deleteEventQueue", () => {
    it("sends DELETE with queue_id", async () => {
      const fetchSpy = mockFetch({ result: "success" });
      globalThis.fetch = fetchSpy;

      const client = new ZulipClient(config);
      await client.deleteEventQueue("q-123");

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.method).toBe("DELETE");
    });
  });

  describe("getStreams", () => {
    it("returns stream list", async () => {
      const fetchSpy = mockFetch({
        result: "success",
        streams: [
          { stream_id: 1, name: "general", description: "General chat", invite_only: false },
        ],
      });
      globalThis.fetch = fetchSpy;

      const client = new ZulipClient(config);
      const streams = await client.getStreams();

      expect(streams).toHaveLength(1);
      expect(streams[0].name).toBe("general");
    });
  });

  describe("getOwnUser", () => {
    it("returns user info", async () => {
      const fetchSpy = mockFetch({
        result: "success",
        user_id: 42,
        email: "bot@example.com",
        full_name: "Test Bot",
      });
      globalThis.fetch = fetchSpy;

      const client = new ZulipClient(config);
      const user = await client.getOwnUser();

      expect(user.user_id).toBe(42);
      expect(user.email).toBe("bot@example.com");
      expect(user.full_name).toBe("Test Bot");
    });
  });

  describe("error handling", () => {
    it("throws on non-success result", async () => {
      globalThis.fetch = mockFetch({ result: "error", msg: "Invalid API key" });

      const client = new ZulipClient(config);
      await expect(client.sendMessage({ type: "stream", to: "x", content: "y" }))
        .rejects.toThrow("Invalid API key");
    });

    it("retries on 429 rate limit", async () => {
      const fetchSpy = vi.fn()
        .mockResolvedValueOnce({
          status: 429,
          headers: new Headers({ "retry-after": "0" }),
          json: () => Promise.resolve({ result: "error", msg: "rate limited" }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({ result: "success", id: 1 }),
        });
      globalThis.fetch = fetchSpy;

      const client = new ZulipClient(config);
      const res = await client.sendMessage({ type: "stream", to: "x", topic: "t", content: "y" });

      expect(res.id).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
