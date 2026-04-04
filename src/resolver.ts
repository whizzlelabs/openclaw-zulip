import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { CoreConfig } from "./types.js";
import { resolveZulipAccount } from "./config.js";
import { ZulipClient } from "./zulip-client.js";

// ---------------------------------------------------------------------------
// Resolver adapter — resolve user/stream names to IDs
// ---------------------------------------------------------------------------

export const zulipResolverAdapter: NonNullable<ChannelPlugin["resolver"]> = {
  async resolveTargets({ cfg, accountId, inputs, kind }) {
    const account = resolveZulipAccount(cfg as CoreConfig, accountId);
    const client = new ZulipClient({
      serverUrl: account.serverUrl,
      email: account.email,
      apiKey: account.apiKey,
    });

    if (kind === "user") {
      const users = await client.getUsers();
      return inputs.map((input) => {
        const q = input.toLowerCase();
        const match = users.find(
          (u) => u.email.toLowerCase() === q || u.full_name.toLowerCase() === q,
        );
        if (match) {
          return { input, resolved: true, id: String(match.user_id), name: match.full_name };
        }
        return { input, resolved: false, note: "No matching Zulip user found" };
      });
    }

    if (kind === "group") {
      const streams = await client.getStreams();
      return inputs.map((input) => {
        const q = input.toLowerCase().replace(/^#/, "");
        const match = streams.find((s) => s.name.toLowerCase() === q);
        if (match) {
          return { input, resolved: true, id: String(match.stream_id), name: match.name };
        }
        return { input, resolved: false, note: "No matching Zulip stream found" };
      });
    }

    return inputs.map((input) => ({ input, resolved: false, note: `Unknown kind: ${kind}` }));
  },
};
