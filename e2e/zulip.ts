import { randomUUID } from "node:crypto";

export interface E2EConfig {
  url: string;
  email: string;
  apiKey: string;
  botName: string;
  stream: string;
  timeoutMs: number;
}

export interface User {
  user_id: number;
  full_name: string;
}

export interface Message {
  id: number;
  sender_id: number;
  subject: string;
  content: string;
}

export function loadConfig(): E2EConfig {
  const required = ["E2E_ZULIP_URL", "E2E_SENDER_EMAIL", "E2E_SENDER_API_KEY", "E2E_BOT_NAME", "E2E_STREAM"] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing E2E configuration: ${missing.join(", ")}`);
  const timeoutMs = Number(process.env.E2E_REPLY_TIMEOUT_MS ?? "120000");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error("E2E_REPLY_TIMEOUT_MS must be an integer from 1000 to 120000");
  }
  let url: URL;
  try {
    url = new URL(process.env.E2E_ZULIP_URL!);
  } catch {
    throw new Error("E2E_ZULIP_URL must be a valid HTTP(S) origin");
  }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash) {
    throw new Error("E2E_ZULIP_URL must be an HTTP(S) origin without credentials or a query");
  }
  return {
    url: url.origin,
    email: process.env.E2E_SENDER_EMAIL!,
    apiKey: process.env.E2E_SENDER_API_KEY!,
    botName: process.env.E2E_BOT_NAME!,
    stream: process.env.E2E_STREAM!,
    timeoutMs,
  };
}

export class TestZulipClient {
  constructor(private readonly config: E2EConfig) {}

  private async request<T>(method: string, path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`/api/v1${path}`, this.config.url);
    if (method === "GET" && params) {
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.email}:${this.config.apiKey}`).toString("base64")}`,
          ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: method === "POST" ? new URLSearchParams(params).toString() : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error(`Zulip ${method} ${path} transport failed`);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Zulip ${method} ${path} returned invalid JSON (${response.status})`);
    }
    if (!response.ok || !data || typeof data !== "object" || (data as { result?: string }).result !== "success") {
      throw new Error(`Zulip ${method} ${path} failed (${response.status})`);
    }
    return data as T;
  }

  async getSelf(): Promise<User> {
    return this.request<User>("GET", "/users/me");
  }

  async findUser(name: string): Promise<User> {
    const data = await this.request<{ members: User[] }>("GET", "/users");
    const matches = data.members.filter((user) => user.full_name === name);
    if (matches.length !== 1) throw new Error(`Expected exactly one configured bot user, found ${matches.length}`);
    return matches[0];
  }

  async sendStreamMessage(stream: string, topic: string, content: string): Promise<number> {
    const data = await this.request<{ id: number }>("POST", "/messages", {
      type: "stream", to: stream, topic, content,
    });
    return data.id;
  }

  async getTopicMessages(stream: string, topic: string, afterId: number): Promise<Message[]> {
    const data = await this.request<{ messages: Message[] }>("GET", "/messages", {
      anchor: String(afterId),
      num_before: "0",
      num_after: "100",
      include_anchor: "false",
      apply_markdown: "false",
      narrow: JSON.stringify([
        { operator: "stream", operand: stream },
        { operator: "topic", operand: topic },
      ]),
    });
    return data.messages;
  }
}

export function uniqueTopic(label: string): string {
  return `e2e-${label}-${randomUUID().slice(0, 8)}`;
}

export async function waitForReply(
  client: TestZulipClient,
  stream: string,
  topic: string,
  afterId: number,
  botId: number,
  timeoutMs: number,
): Promise<Message> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await client.getTopicMessages(stream, topic, afterId);
    const reply = messages.find((message) => message.id > afterId && message.sender_id === botId);
    if (reply) return reply;
    await new Promise((resolve) => setTimeout(resolve, Math.min(2000, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`No bot reply in test topic ${topic} within ${timeoutMs}ms`);
}
