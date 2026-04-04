# AI Agent Guide for openclaw-zulip

**Quick reference for AI agents working on this OpenClaw channel plugin.**

For details see:

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Git workflow, code standards, contribution guidelines
- **[README.md](README.md)** — Project overview, setup, and usage

---

## Repository Purpose

A clean-room OpenClaw channel plugin for Zulip, built with the OpenClaw Plugin SDK.

**Primary goal:** Zulip integration for OpenClaw — streams, topics, DMs, reactions, media, edits, unsend.

**Differentiator:** ACP topic bindings — bind ACP agent sessions to Zulip topics.

**Status:** Core implementation complete (Phases 1–4). All adapter surfaces are wired and functional.

## Repository Structure

```text
src/
  index.ts              # Plugin entry — defineChannelPluginEntry(...)
  plugin.ts             # Plugin assembly — createChatChannelPlugin(...)
  types.ts              # ZulipAccount, resolved account shape, config types
  config.ts             # ChannelConfigAdapter — account CRUD
  config-schema.ts      # Zod schema for config validation
  setup.ts              # ChannelSetupAdapter — onboarding
  gateway.ts            # ChannelGatewayAdapter — Zulip event queue
  outbound.ts           # ChannelOutboundAdapter — send messages
  security.ts           # DM policy, allow-from
  allowlist.ts          # Allow-from list adapter
  threading.ts          # Topic-as-thread mapping
  messaging.ts          # Session key grammar, target parsing
  bindings.ts           # ACP topic bindings
  actions.ts            # Channel-list, channel-info, member-info actions
  commands.ts           # Command adapter
  directory.ts          # User/member directory adapter
  groups.ts             # Groups adapter
  resolver.ts           # Account resolver adapter
  status.ts             # Connection status / health probes
  agent-prompt.ts       # Agent prompt adapter
  zulip-client.ts       # Zulip REST API wrapper
```

## Tech Stack

- **Language:** TypeScript (strict mode, ESM)
- **Target:** ES2022, NodeNext module resolution
- **SDK:** `openclaw` Plugin SDK (`openclaw/plugin-sdk/core`)
- **Testing:** vitest (local only, no CI)
- **Package:** npm — `openclaw-zulip`

## Build & Test

```bash
npm install
npm run build          # tsc
npm test               # vitest
npm run lint           # eslint
```

## Key SDK Concepts

This plugin implements the `ChannelPlugin` interface from `openclaw/plugin-sdk/core`. Key entry points:

- **`defineChannelPluginEntry(...)`** — Registers the plugin with OpenClaw
- **`createChatChannelPlugin(...)`** — Assembles adapter surfaces into a `ChannelPlugin`
- **Adapter surfaces** — Each aspect (config, gateway, outbound, threading, etc.) is a separate adapter object

### Important Types

- `ChannelPlugin<ResolvedAccount, ZulipProbe>` — Full plugin contract
- `ChannelGatewayAdapter` — Lifecycle (start/stop account)
- `ChannelOutboundAdapter` — Message delivery
- `ChannelConfiguredBindingProvider` — ACP binding compilation and matching
- `ChannelMessagingAdapter` — Session key grammar, target resolution
- `ChannelActionsAdapter` — Channel-list, channel-info, member-info queries
- `ChannelDirectoryAdapter` — User/member directory lookups
- `ChannelResolverAdapter` — Account resolution from config
- `ChannelStatusAdapter` — Health probes and connection status

### Zulip Mapping

| Zulip Concept | OpenClaw Concept |
|---|---|
| Stream | Group conversation |
| Topic (within stream) | Thread |
| DM | Direct conversation |
| Stream + Topic | Session key (thread-scoped) |
| Bot API key | Account credential |

## Working with the Codebase

### Before Making Changes

1. Read the relevant SDK type definitions in `node_modules/openclaw/dist/plugin-sdk/`
2. Check whizzlelabs/openclaw-zulip issues for related tasks
3. Understand how the adapter surface you're touching fits into the plugin lifecycle
4. Run `npm run build` to verify types compile

### Code Conventions

- **Strict TypeScript** — No `any` unless interfacing with untyped SDK boundaries
- **ESM only** — Use `import`/`export`, no CommonJS
- **One adapter per file** — Each SDK adapter surface gets its own module
- **Explicit types** — Export interfaces for resolved account shapes, config sections
- **Errors** — Let SDK handle error propagation; don't swallow errors silently

### Testing

- Test adapter logic in isolation — mock the Zulip API, not the SDK
- Integration tests against a real Zulip instance are optional but valuable
- All tests run locally with `npm test`

## Git Workflow

### Branch Naming

```text
<type>/<description>
```

Types: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`

### Commit Format

```text
<type>(<scope>): <description>
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

**Scopes:** `config`, `gateway`, `outbound`, `threading`, `messaging`, `bindings`, `security`, `setup`, `client`, `actions`, `directory`, `resolver`, `status`, `commands`, `groups`, `allowlist`, `repo`

**Examples:**

```bash
feat(gateway): implement Zulip event queue polling
fix(outbound): handle topic-less DM delivery
chore(repo): add vitest config
```

### PR Workflow

1. Create a feature branch from `main`
2. Make changes, ensure `npm run build` and `npm test` pass
3. Push and create a PR
4. Self-review and merge

## Security

**Never commit:**

- Zulip bot API keys or tokens
- Server URLs with embedded credentials
- `.env` files with real values

**Always:**

- Use `.env.example` with placeholder values
- Reference secrets via OpenClaw config, not hardcoded

## Reference

- **Existing plugin source:** `~/.openclaw/extensions/zulip/` (if installed)
- **Plugin SDK types:** `node_modules/openclaw/dist/plugin-sdk/`
- **Zulip API docs:** https://zulip.com/api/
- **Project issue:** whizzlelabs/openclaw-zulip#1

---

**Last Updated:** 2026-04-04
