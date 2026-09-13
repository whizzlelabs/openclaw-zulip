import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig, TestZulipClient, uniqueTopic, waitForDirectReply, waitForReactionSequence, waitForReply, type E2EConfig, type User } from "./zulip.js";

describe("deployed OpenClaw/Zulip round trip", () => {
  let config: E2EConfig;
  let client: TestZulipClient;
  let bot: User;

  beforeAll(async () => {
    config = loadConfig();
    client = new TestZulipClient(config);
    const sender = await client.getSelf();
    bot = await client.findUser(config.botName);
    if (sender.user_id === bot.user_id) throw new Error("The test sender must be a different Zulip user from OpenClaw");
  });

  it("replies to a stream mention in the same topic", async () => {
    const topic = uniqueTopic("mention");
    const mention = `@**${bot.full_name}|${bot.user_id}**`;
    const sentId = await client.sendStreamMessage(config.stream, topic, `${mention} Include this exact marker in your reply: ${topic}`);
    console.log(`E2E sent to test topic ${topic}`);
    const reply = await waitForReply(client, config.stream, topic, sentId, bot.user_id, config.timeoutMs);
    console.log(`E2E reply observed in test topic ${topic}`);
    expect(reply.subject).toBe(topic);
    expect(reply.content.toLowerCase()).toContain(topic);
  });

  it("keeps replies in their respective topics", async () => {
    const topics = [uniqueTopic("first"), uniqueTopic("second")];
    const mention = `@**${bot.full_name}|${bot.user_id}**`;
    const sentIds: number[] = [];
    for (const topic of topics) {
      const id = await client.sendStreamMessage(config.stream, topic, `${mention} Include this exact marker in your reply: ${topic}`);
      sentIds.push(id);
      console.log(`E2E sent to test topic ${topic}`);
    }
    const replies = await Promise.all(topics.map((topic, index) =>
      waitForReply(client, config.stream, topic, sentIds[index], bot.user_id, config.timeoutMs)));
    for (let index = 0; index < topics.length; index++) {
      console.log(`E2E reply observed in test topic ${topics[index]}`);
      expect(replies[index].subject).toBe(topics[index]);
      expect(replies[index].content.toLowerCase()).toContain(topics[index]);
    }
  });

  it("replies to a direct message and carries a unique prompt marker", async () => {
    const marker = uniqueTopic("dm-marker");
    const sentId = await client.sendDirectMessage(bot.user_id, `Reply with this exact test marker: ${marker}`);
    console.log("E2E sent direct message to configured identity");
    const reply = await waitForDirectReply(client, sentId, bot.user_id, config.timeoutMs);
    console.log("E2E direct reply observed from configured identity");
    expect(reply.content.toLowerCase()).toContain(marker);
  });

  it("acknowledges a topic message while processing and after delivery", async () => {
    const topic = uniqueTopic("ack");
    const queue = await client.registerReactionQueue();
    try {
      const mention = `@**${bot.full_name}|${bot.user_id}**`;
      const sentId = await client.sendStreamMessage(config.stream, topic, `${mention} Include this exact marker in your reply: ${topic}`);
      console.log(`E2E sent acknowledgement probe to test topic ${topic}`);
      const expected = [
        ["add", config.ackStart],
        ["remove", config.ackStart],
        ["add", config.ackSuccess],
      ] as const;
      await waitForReactionSequence(client, queue, sentId, bot.user_id, expected, config.timeoutMs);
      const message = await client.getMessage(sentId);
      expect(message.reactions).toContainEqual(expect.objectContaining({
        user_id: bot.user_id, emoji_name: config.ackSuccess,
      }));
      expect(message.reactions).not.toContainEqual(expect.objectContaining({
        user_id: bot.user_id, emoji_name: config.ackStart,
      }));
      const reply = await waitForReply(client, config.stream, topic, sentId, bot.user_id, config.timeoutMs);
      expect(reply.content.toLowerCase()).toContain(topic);
      console.log(`E2E acknowledgement transition and reply observed in test topic ${topic}`);
    } finally {
      await client.deleteQueue(queue.queue_id);
    }
  });
});
