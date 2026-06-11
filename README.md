# skillusage

> Skill / slash-command usage analytics for Claude Code and Codex, parsed from your local on-disk data.

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
skillusage                    # all-time top skills across Claude Code + Codex
skillusage daily              # per-day counts with a sparkline trend
skillusage --days 30          # last 30 days only
skillusage --source claude    # claude | codex | all (default: all)
skillusage --limit 0          # show every skill
skillusage --strict           # drop heuristic SKILL.md-read signals
skillusage --json             # machine-readable output (daily + per-project breakdowns)
skillusage --include-subagents
skillusage --claude-dir /path/to/.claude --codex-dir /path/to/.codex
```

The `--json` output includes per-skill `daily` (local-timezone `YYYY-MM-DD` counts), `projects` (cwd counts), `sources`, and `aliases` maps, ready for dashboards.

## How it works

### Claude Code (`~/.claude/projects/**/*.jsonl`)

| Signal | Counted as | Notes |
|---|---|---|
| `Skill` tool call (`tool_use` with `input.skill`) | **auto** | agent-initiated |
| `<command-name>` slash-command message | **manual** | user-typed; built-in commands (`/clear`, `/model`, ...) are filtered out |
| `Read`/`Bash` hitting `*/skills/<name>/SKILL.md` | **auto** (inferred) | heuristic; shown as `(~n)`, exclude with `--strict` |

### Codex (`~/.codex/sessions`, `archived_sessions`, `history.jsonl`)

| Signal | Counted as | Notes |
|---|---|---|
| `$skill` user input (history.jsonl + rollout `user_message`) | **manual** | both sources merged with a time-window dedup (Codex Desktop skips history.jsonl) |
| `<skill><name>` injection in rollout | **auto** | unless it is the echo of a nearby manual `$skill` in the same session; resume/fork replays are deduplicated |
| `exec`/`shell` call reading a `SKILL.md` | **auto** (inferred) | heuristic; shown as `(~n)`, exclude with `--strict` |

### Counting rules

- Explicit signals dedupe on `(session, skill, second)`.
- Inferred signals (SKILL.md reads) count **at most once per session** and are suppressed when the same session already has an explicit invocation — agents read skill files in chunks, and chunks are not invocations.
- Subagent sidechains are excluded by default (`--include-subagents` to keep them).
- Names are normalized: duplicate namespace segments collapse (`frontend-design:frontend-design` → `frontend-design`) and install-dir version suffixes are stripped (`debug-pro-1.0.0` → `debug-pro`). Raw names are kept in `aliases`.

### Known limitations

- Claude Code prunes old transcripts, so all-time counts are a lower bound.
- Some older Codex sessions only contain the injection row; those count as auto even if they were user-typed.

## Roadmap

- More runtimes (OpenCode, Gemini CLI)
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
