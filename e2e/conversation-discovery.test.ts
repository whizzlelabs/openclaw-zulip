import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig, TestZulipClient, uniqueTopic, type E2EConfig, type User } from "./zulip.js";

const execFileAsync = promisify(execFile);

interface Conversation {
  conversationRef: string;
  channel: string;
  accountId: string;
  kind: string;
  target: string;
  threadId?: string;
}

interface ConversationListResult {
  conversations: Conversation[];
}

interface ConversationSendResult {
  status: string;
  channel: string;
  conversationRef: string;
  messageId?: string;
}

async function gatewayCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  // The OpenClaw CLI suppresses normal Gateway output in its own Vitest mode.
  // This child is an external test client, not part of Vitest's runtime.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "VITEST" || key.startsWith("VITEST_") || key.startsWith("OPENCLAW_VITEST_")) delete env[key];
  }
  if (env.NODE_ENV === "test") delete env.NODE_ENV;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("openclaw", [
      "gateway", "call", method, "--params", JSON.stringify(params), "--json", "--timeout", "15000",
    ], { env, timeout: 20_000, maxBuffer: 1_048_576 }));
  } catch {
    throw new Error(`OpenClaw gateway call ${method} failed`);
  }
  if (!stdout.trim()) throw new Error(`OpenClaw gateway call ${method} returned no JSON`);
  const result: unknown = JSON.parse(stdout);
  return result as T;
}

async function listConversations(config: E2EConfig, query: string): Promise<Conversation[]> {
  const result = await gatewayCall<ConversationListResult>("conversations.list", {
    agentId: config.agentId, channel: "zulip", query, limit: 50,
  });
  return result.conversations;
}

function requireConversation(conversations: Conversation[], predicate: (entry: Conversation) => boolean): Conversation {
  const matches = conversations.filter(predicate);
  if (matches.length !== 1) throw new Error(`Expected one matching conversation, found ${matches.length}`);
  return matches[0];
}

async function sendToConversation(config: E2EConfig, conversation: Conversation, message: string): Promise<number> {
  const result = await gatewayCall<ConversationSendResult>("conversations.send", {
    agentId: config.agentId,
    operationId: `convop_${randomUUID().replaceAll("-", "")}`,
    conversationRef: conversation.conversationRef,
    message,
  });
  expect(result).toMatchObject({ status: "sent", channel: "zulip", conversationRef: conversation.conversationRef });
  const messageId = Number(result.messageId);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error("Conversation send returned no Zulip message ID");
  return messageId;
}

describe("deployed OpenClaw conversation discovery and send", () => {
  let config: E2EConfig;
  let client: TestZulipClient;
  let sender: User;
  let identity: User;

  beforeAll(async () => {
    config = loadConfig();
    client = new TestZulipClient(config);
    sender = await client.getSelf();
    identity = await client.findUser(config.botName);
    if (sender.user_id === identity.user_id) throw new Error("The test sender must be separate from OpenClaw");
  });

  it("finds a bot user by name", async () => {
    const directoryBot = await client.findUser(config.directoryBotName);
    expect(directoryBot.is_bot).toBe(true);
    const conversations = await listConversations(config, config.directoryBotName);
    requireConversation(conversations, (entry) =>
      entry.accountId === config.accountId && entry.kind === "direct" &&
      entry.target === `user:${directoryBot.user_id}`);
  });

  it("sends to a discovered DM through the gateway", async () => {
    const conversation = requireConversation(await listConversations(config, config.email), (entry) =>
      entry.accountId === config.accountId && entry.kind === "direct" &&
      entry.target === `user:${sender.user_id}`);
    const marker = uniqueTopic("conversation-dm");
    const messageId = await sendToConversation(config, conversation, marker);
    const delivered = await client.getMessage(messageId);
    expect(delivered).toMatchObject({ id: messageId, type: "private", sender_id: identity.user_id, content: marker });
    expect(Array.isArray(delivered.display_recipient) &&
      delivered.display_recipient.some((user) => user.id === sender.user_id)).toBe(true);
    console.log(`E2E discovered-DM send verified as message ${messageId}`);
  });

  it("explores an existing topic and sends through its conversation reference", async () => {
    const topic = uniqueTopic("conversation-topic");
    await client.sendStreamMessage(config.stream, topic, "E2E topic discovery fixture; no response needed.");
    const stream = requireConversation(await listConversations(config, config.stream), (entry) =>
      entry.accountId === config.accountId && entry.kind === "group" &&
      /^stream:\d+$/.test(entry.target) && !entry.threadId);
    const streamId = stream.target.slice("stream:".length);
    const conversation = requireConversation(await listConversations(config, `${streamId}/${topic}`), (entry) =>
      entry.accountId === config.accountId && entry.kind === "group" &&
      entry.target === `stream:${streamId}` && entry.threadId === topic);
    const marker = uniqueTopic("conversation-topic-send");
    const messageId = await sendToConversation(config, conversation, marker);
    const delivered = await client.getMessage(messageId);
    expect(delivered).toMatchObject({
      id: messageId, type: "stream", display_recipient: config.stream,
      subject: topic, sender_id: identity.user_id, content: marker,
    });
    console.log(`E2E discovered-topic send verified as message ${messageId}`);
  });
});
