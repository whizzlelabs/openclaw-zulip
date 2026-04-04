// ---------------------------------------------------------------------------
// Zulip REST API client — Phase 1 endpoints
// ---------------------------------------------------------------------------

export type ZulipClientConfig = {
  serverUrl: string;
  email: string;
  apiKey: string;
};

export type ZulipMessage = {
  id: number;
  sender_id: number;
  sender_email: string;
  sender_full_name: string;
  type: "stream" | "private";
  stream_id?: number;
  subject?: string;
  display_recipient: string | Array<{ id: number; email: string; full_name: string }>;
  content: string;
  timestamp: number;
};

export type ZulipEventQueueRegistration = {
  queue_id: string;
  last_event_id: number;
};

export type ZulipEvent = {
  id: number;
  type: string;
  message?: ZulipMessage;
  flags?: string[];
};

export type ZulipStream = {
  stream_id: number;
  name: string;
  description: string;
  invite_only: boolean;
};

export type ZulipSendMessageResult = {
  id: number;
};

export class ZulipClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: ZulipClientConfig) {
    this.baseUrl = config.serverUrl.replace(/\/+$/, "");
    this.authHeader =
      "Basic " + Buffer.from(`${config.email}:${config.apiKey}`).toString("base64");
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    retryCount = 0,
  ): Promise<T> {
    const url = new URL(`/api/v1${path}`, this.baseUrl);

    const init: RequestInit = {
      method,
      headers: {
        Authorization: this.authHeader,
      },
    };

    if (method === "GET" && params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    } else if (params) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) body.set(k, String(v));
      }
      init.body = body.toString();
      (init.headers as Record<string, string>)["Content-Type"] =
        "application/x-www-form-urlencoded";
    }

    const res = await fetch(url.toString(), init);

    if (res.status === 429) {
      if (retryCount >= 3) {
        throw new Error(`Zulip API rate limited after ${retryCount} retries (${path})`);
      }
      const retryAfter = Number(res.headers.get("retry-after") || "1");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request(method, path, params, retryCount + 1);
    }

    const json = (await res.json()) as Record<string, unknown>;

    if (json.result !== "success") {
      const msg = typeof json.msg === "string" ? json.msg : JSON.stringify(json);
      throw new Error(`Zulip API error (${path}): ${msg}`);
    }

    return json as T;
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  async sendMessage(params: {
    type: "stream" | "direct";
    to: string | number[];
    topic?: string;
    content: string;
  }): Promise<ZulipSendMessageResult> {
    const body: Record<string, string> = {
      type: params.type,
      to: typeof params.to === "string" ? params.to : JSON.stringify(params.to),
      content: params.content,
    };
    if (params.topic) body.topic = params.topic;

    const res = await this.request<{ result: string; id: number }>(
      "POST",
      "/messages",
      body,
    );
    return { id: res.id };
  }

  // -------------------------------------------------------------------------
  // Event queue
  // -------------------------------------------------------------------------

  async registerEventQueue(params?: {
    eventTypes?: string[];
    allPublicStreams?: boolean;
  }): Promise<ZulipEventQueueRegistration> {
    const body: Record<string, string> = {};
    if (params?.eventTypes) {
      body.event_types = JSON.stringify(params.eventTypes);
    }
    if (params?.allPublicStreams) {
      body.all_public_streams = "true";
    }
    const res = await this.request<{
      result: string;
      queue_id: string;
      last_event_id: number;
    }>("POST", "/register", body);
    return { queue_id: res.queue_id, last_event_id: res.last_event_id };
  }

  async getEvents(params: {
    queueId: string;
    lastEventId: number;
    dontBlock?: boolean;
  }): Promise<ZulipEvent[]> {
    const res = await this.request<{ result: string; events: ZulipEvent[] }>(
      "GET",
      "/events",
      {
        queue_id: params.queueId,
        last_event_id: params.lastEventId,
        dont_block: params.dontBlock ? "true" : undefined,
      },
    );
    return res.events;
  }

  async deleteEventQueue(queueId: string): Promise<void> {
    await this.request("DELETE", "/events", { queue_id: queueId });
  }

  // -------------------------------------------------------------------------
  // Streams
  // -------------------------------------------------------------------------

  async getStreams(): Promise<ZulipStream[]> {
    const res = await this.request<{ result: string; streams: ZulipStream[] }>(
      "GET",
      "/streams",
    );
    return res.streams;
  }

  async getSubscriptions(): Promise<ZulipStream[]> {
    const res = await this.request<{
      result: string;
      subscriptions: ZulipStream[];
    }>("GET", "/users/me/subscriptions");
    return res.subscriptions;
  }

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  async getOwnUser(): Promise<{ user_id: number; email: string; full_name: string }> {
    const res = await this.request<{
      result: string;
      user_id: number;
      email: string;
      full_name: string;
    }>("GET", "/users/me");
    return { user_id: res.user_id, email: res.email, full_name: res.full_name };
  }
}
