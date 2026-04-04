# openclaw-zulip

A clean-room [OpenClaw](https://github.com/openclaw/openclaw) channel plugin for [Zulip](https://zulip.com), built from scratch with the OpenClaw Plugin SDK.

## Why

The existing community plugin (`FtlC-ian/openclaw-channel-zulip`) is stale and lacks ACP topic binding support. This plugin provides:

- **Full Zulip messaging** — Streams, topics, DMs, reactions, media
- **ACP topic bindings** — Bind ACP agent sessions to specific Zulip topics
- **Active maintenance** — Under the `whizzlelabs` org with a clear release cycle

## Status

🚧 **Early development** — Not yet functional. See whizzlelabs/openclaw-zulip#1 for the project vision and plan.

## Installation

> Not yet published. Coming soon.

```bash
openclaw plugins install openclaw-zulip
```

## Configuration

> Details TBD. Will require:
> - Zulip server URL
> - Bot email address
> - Bot API key

## Development

```bash
git clone https://github.com/whizzlelabs/openclaw-zulip.git
cd openclaw-zulip
npm install
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow.

## License

TBD
