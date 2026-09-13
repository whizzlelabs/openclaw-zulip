import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig, TestZulipClient, uniqueTopic, waitForReactionSequence, type E2EConfig, type User } from "./zulip.js";

describe("deployed OpenClaw/Zulip delivery failure", () => {
  let config: E2EConfig;
  let client: TestZulipClient;
  let agent: User;

  beforeAll(async () => {
    config = loadConfig();
    client = new TestZulipClient(config);
    const sender = await client.getSelf();
    agent = await client.findUser(config.failureAgentName);
    if (sender.user_id === agent.user_id) throw new Error("The failure probe sender must differ from its target agent");
  });

  it("cannot deliver a reply and applies the error acknowledgement", async () => {
    const topic = uniqueTopic("delivery-error");
    const queue = await client.registerReactionQueue();
    try {
      const mention = `@**${agent.full_name}|${agent.user_id}**`;
      const sentId = await client.sendStreamMessage(config.failureStream, topic, `${mention} Please reply once in this topic.`);
      console.log(`E2E sent delivery-failure probe to test topic ${topic}`);
      await waitForReactionSequence(client, queue, sentId, agent.user_id, [
        ["add", config.ackStart],
        ["remove", config.ackStart],
        ["add", config.ackError],
      ], config.timeoutMs);
      const message = await client.getMessage(sentId);
      expect(message.reactions).toContainEqual(expect.objectContaining({
        user_id: agent.user_id, emoji_name: config.ackError,
      }));
      expect(message.reactions).not.toContainEqual(expect.objectContaining({
        user_id: agent.user_id, emoji_name: config.ackSuccess,
      }));
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const later = await client.getTopicMessages(config.failureStream, topic, sentId);
      expect(later.filter((entry) => entry.id > sentId)).toEqual([]);
      console.log(`E2E delivery failure and error acknowledgement observed in test topic ${topic}`);
    } finally {
      await client.deleteQueue(queue.queue_id);
    }
  });
});
