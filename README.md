# skillusage

> Skill / slash-command usage analytics for Claude Code (and soon Codex), parsed from your local on-disk data.

[ccusage](https://github.com/ccusage/ccusage) tells you what your agents **cost**. `skillusage` tells you what they **do**: which of your skills actually get used, how often, by you or by the agent itself.

```
npx skillusage
```

```
┌────┬───────────────────────────────────┬───────┬────────┬────────┬────────────┐
│  # │ Skill                             │ Total │ Manual │   Auto │ Last used  │
├────┼───────────────────────────────────┼───────┼────────┼────────┼────────────┤
│  1 │ lovstudio-git-commit-with-context │   191 │    191 │      0 │ 2026-06-11 │
│  2 │ frontend-design                   │    36 │     32 │ 4 (~1) │ 2026-06-11 │
│  3 │ lovstudio-release-via-cicd        │    13 │     13 │      0 │ 2026-06-11 │
└────┴───────────────────────────────────┴───────┴────────┴────────┴────────────┘
  357 invocations · 299 manual / 58 auto · 54 skills · all time · 444 transcripts in 1.3s
```

Everything runs locally. Nothing is uploaded anywhere.

## How it works

`skillusage` streams the Claude Code transcripts in `~/.claude/projects/**/*.jsonl` and detects three invocation signals:

| Signal | Counted as | Notes |
|---|---|---|
| `Skill` tool call (`tool_use` with `input.skill`) | **auto** | agent-initiated |
| `<command-name>` slash-command message | **manual** | user-typed; built-in commands (`/clear`, `/model`, ...) are filtered out |
| `Read`/`Bash` hitting `*/skills/<name>/SKILL.md` | **auto** (inferred) | heuristic; marked `(~n)` in the table, exclude with `--strict` |

Events are deduplicated on `(session, skill, second)`, subagent sidechains are excluded by default, and namespaced duplicate segments are collapsed (`frontend-design:frontend-design` → `frontend-design`).

## Usage

```sh
skillusage                  # all-time top skills
skillusage --days 30        # last 30 days only
skillusage --limit 0        # show every skill
skillusage --strict         # drop heuristic SKILL.md-read signals
skillusage --json           # machine-readable output (daily + per-project breakdowns included)
skillusage --include-subagents
skillusage --claude-dir /path/to/.claude
```

The `--json` output includes per-skill `daily` (local-timezone `YYYY-MM-DD` counts) and `projects` (cwd counts) maps, ready for dashboards.

## Roadmap

- **Codex adapter**: `~/.codex/history.jsonl` (`$skill` inputs) + rollout `<skill>` injections, with resume/fork replay dedup
- `daily` subcommand with sparkline trends
- More runtimes (OpenCode, Gemini CLI)

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
