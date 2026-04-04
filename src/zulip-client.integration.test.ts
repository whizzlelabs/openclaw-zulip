import { describe, it, expect, beforeAll } from "vitest";
import { ZulipClient } from "./zulip-client.js";
import { config } from "dotenv";

config();

const serverUrl = process.env.ZULIP_SERVER_URL;
const email = process.env.ZULIP_BOT_EMAIL;
const apiKey = process.env.ZULIP_BOT_API_KEY;
const hasCredentials = !!(serverUrl && email && apiKey);

describe.skipIf(!hasCredentials)("ZulipClient integration", () => {
  let client: ZulipClient;
  let botUserId: number;

  const TEST_STREAM = "openclaw-test";
  const TEST_TOPIC = `integration-${Date.now()}`;

  beforeAll(() => {
    client = new ZulipClient({ serverUrl: serverUrl!, email: email!, apiKey: apiKey! });
  });

  // -- Connectivity --

  it("getOwnUser returns bot identity", async () => {
    const user = await client.getOwnUser();
    expect(user.user_id).toBeTypeOf("number");
    expect(user.email).toBe(email);
    expect(user.full_name).toBeTruthy();
    botUserId = user.user_id;
  });

  // -- Streams --

  it("getStreams returns a list", async () => {
    const streams = await client.getStreams();
    expect(Array.isArray(streams)).toBe(true);
    expect(streams.length).toBeGreaterThan(0);
  });

  it("getSubscriptions returns a list", async () => {
    const subs = await client.getSubscriptions();
    expect(Array.isArray(subs)).toBe(true);
  });

  // -- Stream message lifecycle --

  let streamMessageId: number;

  it("sendMessage to stream", async () => {
    const res = await client.sendMessage({
      type: "stream",
      to: TEST_STREAM,
      topic: TEST_TOPIC,
      content: "Integration test message",
    });
    expect(res.id).toBeTypeOf("number");
    streamMessageId = res.id;
  });

  it("editMessage updates content", async () => {
    await client.editMessage(streamMessageId, "Integration test message (edited)");
  });

  it("addReaction to message", async () => {
    await client.addReaction(streamMessageId, "thumbs_up");
  });

  it("removeReaction from message", async () => {
    await client.removeReaction(streamMessageId, "thumbs_up");
  });

  it("deleteMessage removes the message", async () => {
    await client.deleteMessage(streamMessageId);
  });

  // -- DM (self-DM) --

  let dmMessageId: number;

  it("sendMessage DM to self", async () => {
    // botUserId set in first test
    const res = await client.sendMessage({
      type: "direct",
      to: [botUserId],
      content: "Self-DM integration test",
    });
    expect(res.id).toBeTypeOf("number");
    dmMessageId = res.id;
  });

  it("deleteMessage cleans up DM", async () => {
    await client.deleteMessage(dmMessageId);
  });

  // -- Event queue lifecycle --

  it("event queue register, poll, delete", async () => {
    const reg = await client.registerEventQueue({ eventTypes: ["message"] });
    expect(reg.queue_id).toBeTruthy();
    expect(reg.last_event_id).toBeTypeOf("number");

    const events = await client.getEvents({
      queueId: reg.queue_id,
      lastEventId: reg.last_event_id,
      dontBlock: true,
    });
    expect(Array.isArray(events)).toBe(true);

    await client.deleteEventQueue(reg.queue_id);
  });

  // -- Search --

  it("searchMessages finds messages in stream", async () => {
    // Send a message to search for
    const tag = `search-tag-${Date.now()}`;
    const sent = await client.sendMessage({
      type: "stream",
      to: TEST_STREAM,
      topic: TEST_TOPIC,
      content: `Searchable ${tag}`,
    });

    // Small delay for indexing
    await new Promise((r) => setTimeout(r, 1000));

    const msgs = await client.searchMessages({
      anchor: "newest",
      numBefore: 10,
      numAfter: 0,
      narrow: [
        { operator: "stream", operand: TEST_STREAM },
        { operator: "topic", operand: TEST_TOPIC },
      ],
    });
    expect(msgs.some((m) => m.content.includes(tag))).toBe(true);

    // Cleanup
    await client.deleteMessage(sent.id);
  });

  // -- Users --

  it("getUsers returns members including bot", async () => {
    const users = await client.getUsers();
    expect(users.length).toBeGreaterThan(0);
    expect(users.some((u) => u.email === email)).toBe(true);
  });

  it("getUser returns bot details", async () => {
    const user = await client.getUser(botUserId);
    expect(user.email).toBe(email);
    expect(user.user_id).toBe(botUserId);
  });

  // -- Stream details --

  it("getStreamById and getStreamMembers", async () => {
    const streams = await client.getStreams();
    const testStream = streams.find((s) => s.name === TEST_STREAM);
    expect(testStream).toBeTruthy();

    const details = await client.getStreamById(testStream!.stream_id);
    expect(details.name).toBe(TEST_STREAM);

    const members = await client.getStreamMembers(testStream!.stream_id);
    expect(Array.isArray(members)).toBe(true);
  });
});
