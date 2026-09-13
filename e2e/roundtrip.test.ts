import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig, TestZulipClient, uniqueTopic, waitForReply, type E2EConfig, type User } from "./zulip.js";

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
    const sentId = await client.sendStreamMessage(config.stream, topic, `${mention} Please reply briefly.`);
    console.log(`E2E sent to test topic ${topic}`);
    const reply = await waitForReply(client, config.stream, topic, sentId, bot.user_id, config.timeoutMs);
    console.log(`E2E reply observed in test topic ${topic}`);
    expect(reply.subject).toBe(topic);
    expect(reply.content.trim()).not.toBe("");
  });

  it("keeps replies in their respective topics", async () => {
    const topics = [uniqueTopic("first"), uniqueTopic("second")];
    const mention = `@**${bot.full_name}|${bot.user_id}**`;
    const sentIds: number[] = [];
    for (const topic of topics) {
      const id = await client.sendStreamMessage(config.stream, topic, `${mention} Please reply briefly in this topic.`);
      sentIds.push(id);
      console.log(`E2E sent to test topic ${topic}`);
    }
    const replies = await Promise.all(topics.map((topic, index) =>
      waitForReply(client, config.stream, topic, sentIds[index], bot.user_id, config.timeoutMs)));
    for (let index = 0; index < topics.length; index++) {
      console.log(`E2E reply observed in test topic ${topics[index]}`);
      expect(replies[index].subject).toBe(topics[index]);
      expect(replies[index].content.trim()).not.toBe("");
    }
  });
});
