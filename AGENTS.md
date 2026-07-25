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
Published to npm as `openclaw-zulip` (currently 0.2.x); work is now incremental fixes and hardening.

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

  *.test.ts             # Unit tests, colocated with the module they cover
  zulip-client.integration.test.ts   # Live-instance tests (needs .env, separate config)
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
npm test               # vitest (unit)
npm run lint           # eslint
npm run test:integration   # live Zulip tests — needs a filled-in .env
```

**Pre-commit hook:** `.husky/pre-commit` runs `build && lint && test` on *every* commit, so
commits take ~as long as a full verification pass. Don't run the three manually right before
committing — the hook already does it. If a commit is rejected, fix the cause; only use
`--no-verify` when the user explicitly asks.

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
- All tests run locally with `npm test` — there is no CI, so local verification is the only gate

## Gotchas

Non-obvious behaviour that has cost debugging time before:

- **Config is read raw, not through the Zod schema.** Adapters call `resolveZulipAccount(cfg, …)`
  and read fields straight off the account object. `src/config-schema.ts` drives config *validation
  and UI hints* only. A field can therefore work at runtime while being absent from the schema —
  when adding a config field, add it in **both** places.
- **ACP topic bindings are in-memory only** (`bindingsByAccount` in `src/bindings.ts`). They do not
  survive a gateway restart. Don't assume persistence when reasoning about binding behaviour.
- **A successful DM dispatch logs nothing.** Silence in the gateway log is not evidence of failure;
  only errors are logged. Verify delivery in Zulip itself, not by grepping logs.
- **`main` history is squash-merged.** Merged feature branches keep tips that are not ancestors of
  `main`, so `git branch --merged` under-reports. Check by content, not by reachability.

### Testing against a live instance

Deployment topology is specific to whoever is running the plugin, so it is deliberately not
described here. If a machine-local `live-deploy` skill is present (see [Skills](#skills)), follow it
— it carries the host details, install layout and health checks for that particular setup. Without
one, assume nothing about how or where the plugin is installed and ask.

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

## Skills

Machine-local skills for testing and debugging a live instance may be available — e.g. a
`live-deploy` skill covering test deployment and rollback against a real gateway. If present, load
them via the skill tool.

These are deliberately **not committed**: deployment topology differs per operator, and this repo is
public. `.claude/skills/` and `.opencode/skills/` are gitignored, as are agent settings under
`.claude/`. Keep host names, addresses, install paths and live config out of tracked files, commit
messages, PRs and issues — put them in a local skill instead.

## Reference

- **Plugin SDK types:** `node_modules/openclaw/dist/plugin-sdk/`
- **Zulip API docs:** https://zulip.com/api/
- **Project issue:** whizzlelabs/openclaw-zulip#1

---

**Last Updated:** 2026-07-25
