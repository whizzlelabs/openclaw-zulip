# openclaw-zulip

A clean-room [OpenClaw](https://github.com/openclaw/openclaw) channel plugin for [Zulip](https://zulip.com), built from scratch with the OpenClaw Plugin SDK.

## Features

- **Full Zulip messaging** — Streams, topics, DMs, reactions, media, edits, unsend
- **ACP topic bindings** — Bind ACP agent sessions to specific Zulip topics
- **Dual account modes** — Run as a bot or impersonate a user account
- **Stream-level controls** — Per-stream config (require mention, enable/disable)
- **Security** — DM policy enforcement, allow-from lists
- **Actions** — Channel list, channel info, member info queries

## Installation

```bash
openclaw plugins install openclaw-zulip
```

## Configuration

Add a `channels.zulip` section to your OpenClaw config:

```yaml
channels:
  zulip:
    serverUrl: https://your-org.zulipchat.com
    email: bot@your-org.zulipchat.com
    apiKey: your-bot-api-key
    mode: bot  # or "user"

    # Optional: per-stream overrides
    streams:
      general:
        requireMention: true
      private-ops:
        enabled: false

    # Optional: multi-account setup
    accounts:
      work-bot:
        serverUrl: https://work.zulipchat.com
        email: bot@work.zulipchat.com
        apiKey: ...
```

### Account modes

| Mode | Description |
|------|-------------|
| `bot` | Connects as a Zulip bot (default). Messages appear from the bot identity. |
| `user` | Connects as a regular Zulip user. Messages appear from that user's identity. |

### Configuration fields

| Field | Required | Description |
|-------|----------|-------------|
| `serverUrl` | Yes | Zulip server URL |
| `email` | Yes | Bot or user email address |
| `apiKey` | Yes | Zulip API key |
| `mode` | No | `bot` (default) or `user` |
| `streams` | No | Per-stream config overrides |
| `dmPolicy` | No | DM handling policy |
| `allowFrom` | No | Allowed user IDs or emails |
| `replyToMode` | No | Reply targeting behavior |

## Capabilities

| Feature | Supported |
|---------|-----------|
| Direct messages | Yes |
| Group conversations (streams) | Yes |
| Threads (topics) | Yes |
| Reactions | Yes |
| Message editing | Yes |
| Unsend | Yes |
| Reply | Yes |
| Media | Yes |
| ACP topic bindings | Yes |
| Native commands | No |
| Polls | No |

## Development

```bash
git clone https://github.com/whizzlelabs/openclaw-zulip.git
cd openclaw-zulip
npm install
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow.

## License

TBD
