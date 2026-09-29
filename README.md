# skillusage

> Skill / slash-command usage analytics for local coding agents (Claude Code, Codex, Factory Droid, Pi, Cindy, OpenCode, DSH, Reasonix), parsed from your local on-disk data.

[ccusage](https://github.com/ccusage/ccusage) tells you what your agents **cost**. `skillusage` tells you what they **do**: which of your skills actually get used, how often, by you or by the agent itself.

```
npx skillusage
```

```
┌────┬───────────────────────────────────┬───────┬────────┬────────────┬────────────────────────────────┬────────────┐
│  # │ Skill                             │ Total │ Manual │       Auto │ Trend (30d)                    │ Last used  │
├────┼───────────────────────────────────┼───────┼────────┼────────────┼────────────────────────────────┼────────────┤
│  1 │ lovstudio-git-commit-with-context │   242 │    241 │          1 │            ▁▅ ▁▁▄  ▂▁▁▂▃▁▄▁▆█▃ │ 2026-06-11 │
│  2 │ frontend-design                   │   225 │     41 │ 184 (~149) │ ▂▃▂  ▁ ▁▄▃▆▆█▁▁ ▂▄▁▃▃▂▃▅ ▇▆▂▇▂ │ 2026-06-11 │
│  3 │ deep-research                     │    48 │      8 │    40 (~3) │   ▃▃ ▃ ▆  █        ▃  █▆█▃     │ 2026-06-08 │
└────┴───────────────────────────────────┴───────┴────────┴────────────┴────────────────────────────────┴────────────┘
  1444 invocations · 391 manual / 1053 auto · 192 skills · all time · source: all · 1298 files in 8.3s
```

Everything runs locally. Nothing is uploaded anywhere.

## Usage

```sh
skillusage                    # all-time top skills across all detected sources
skillusage daily              # per-day counts with a sparkline trend
skillusage --days 30          # last 30 days only
skillusage --source claude    # comma-separated: claude | codex | factory | pi | cindy | opencode | dsh | reasonix | all (default: all)
skillusage --limit 0          # show every skill
skillusage --strict           # drop heuristic SKILL.md-read signals
skillusage --json             # machine-readable output (daily + per-project breakdowns)
skillusage --include-subagents
skillusage --claude-dir /path/to/.claude --codex-dir /path/to/.codex   # every source has a --<source>-dir override
```

Optional external tools: the `cindy` and `opencode` sources read SQLite through the system `sqlite3` CLI (preinstalled on macOS), and `dsh` needs `zstd`. When a tool is missing, that source is skipped with a warning and the rest still work.

The `--json` output includes per-skill `daily` (local-timezone `YYYY-MM-DD` counts), `projects` (cwd counts), `sources`, and `aliases` maps, ready for dashboards.

## How it works

### Claude Code (`~/.claude/projects/**/*.jsonl`)

| Signal | Counted as | Notes |
|---|---|---|
| `Skill` tool call (`tool_use` with `input.skill`) | **auto** | agent-initiated |
| `<command-name>` slash-command message | **manual** | user-typed; built-in commands (`/clear`, `/model`, ...) are filtered out |
| `Read`/`Bash` hitting `*/skills/<name>/SKILL.md` | **auto** (inferred) | heuristic; shown as `(~n)`, exclude with `--strict` |

### Codex (`~/.codex/sessions`, `archived_sessions`, `history.jsonl`)

Also scans Cindy's bundled Codex home (`~/Library/Application Support/Cindy/codex-home/sessions`) when present — those rollouts never land in `~/.codex`.

| Signal | Counted as | Notes |
|---|---|---|
| `$skill` user input (history.jsonl + rollout `user_message`) | **manual** | both sources merged with a time-window dedup (Codex Desktop skips history.jsonl) |
| `<skill><name>` injection in rollout | **auto** | unless it is the echo of a nearby manual `$skill` in the same session; resume/fork replays are deduplicated |
| `exec`/`shell` call reading a `SKILL.md` | **auto** (inferred) | heuristic; shown as `(~n)`, exclude with `--strict` |

### Factory Droid (`~/.factory/sessions/**/*.jsonl`)

| Signal | Counted as | Notes |
|---|---|---|
| `Skill` tool call (`tool_use` with `input.skill`) | **auto** | agent-initiated |
| `Read`/`Execute`/`Bash` hitting a `SKILL.md` path | **auto** (inferred) | heuristic; shown as `(~n)`, exclude with `--strict` |

### Pi (`~/.pi/agent/sessions/**`, plus Cindy's bundled Pi home)

Pi has no dedicated Skill tool, so only file reads leave a trace.

| Signal | Counted as | Notes |
|---|---|---|
| toolCall arguments (or activation-marker text) hitting a `SKILL.md` path | **auto** (inferred) | heuristic; nested skill directories (`document-skills/docx`) are kept as-is |

### Cindy (`~/Library/Application Support/Cindy/cindy-*.db`, read-only SQLite)

Cindy stores what no native transcript has, so nothing double-counts with the sources above.

| Signal | Counted as | Notes |
|---|---|---|
| `Skill` tool call (`toolName` in a `tool_use` message) | **auto** | deduplicated across forked sessions by `toolUseId` |
| user message with `slashCommandRanges` | **manual** | user-typed slash commands inside Cindy; 120s window dedup; built-ins filtered |

### OpenCode (`~/.local/share/opencode/opencode.db`, read-only SQLite)

| Signal | Counted as | Notes |
|---|---|---|
| `skill` tool call (`state.input.name`) | **auto** | agent-initiated |
| `read`/`bash`/`filesystem_read_text_file` hitting a `SKILL.md` path | **auto** (inferred) | heuristic; shown as `(~n)`, exclude with `--strict` |

### DSH (`~/.dsh/sessions/**/session.jsonl.zstd`, streamed via `zstd`)

| Signal | Counted as | Notes |
|---|---|---|
| `skill` tool call (`tool/call` row, arguments `{"name": ...}`) | **auto** | agent-initiated; the same call appearing as an assistant-message part is deduplicated by `callId` |
| tool-call arguments hitting a `SKILL.md` path | **auto** (inferred) | heuristic; shown as `(~n)`, exclude with `--strict` |

### Reasonix (`~/Library/Application Support/reasonix/sessions/*.jsonl`)

| Signal | Counted as | Notes |
|---|---|---|
| `tool_calls` arguments hitting a `SKILL.md` path | **auto** (inferred) | heuristic; opaque `skill_<digits>` ids are ignored |

### Counting rules

- Explicit signals dedupe on `(session, skill, second)`.
- Inferred signals (SKILL.md reads) count **at most once per session** and are suppressed when the same session already has an explicit invocation — agents read skill files in chunks, and chunks are not invocations.
- Subagent sidechains are excluded by default (`--include-subagents` to keep them).
- Names are normalized: duplicate namespace segments collapse (`frontend-design:frontend-design` → `frontend-design`) and install-dir version suffixes are stripped (`debug-pro-1.0.0` → `debug-pro`). Raw names are kept in `aliases`.

### Known limitations

- Claude Code prunes old transcripts, so all-time counts are a lower bound.
- Some older Codex sessions only contain the injection row; those count as auto even if they were user-typed.
- Pi and Reasonix have no dedicated Skill tool, so their signals are all inferred reads (drop with `--strict`).
- Reasonix transcripts carry no per-line timestamps; events are placed at session-granularity using the session's last-updated time.
- `cindy` and `opencode` read live databases; reads are done in read-only/immutable mode, so events written in the last few seconds may be missed.

## Roadmap

- More runtimes (Gemini CLI)
- Per-project subcommand

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
node dist/index.mjs
```

Zero runtime dependencies — everything is bundled at build time with [tsdown](https://github.com/rolldown/tsdown).

## License

MIT © [Lovstudio.ai](https://github.com/lovstudio)
