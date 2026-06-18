# Changelog

All notable changes to obs-memory are documented here.

## [2.4.0] — 2026-06-18

### Added

- **`scripts/sync_todos.py`** — deterministic, idempotent archival of `[x]` items from `Active TODOs.md` to `Completed TODOs Archive.md`, grouped by `## {project}` heading and dated. Replaces the multi-step LLM-driven move in the `recap` procedure, which routinely missed items or duplicated headings.
- **`sync_sessions.py` summary backfill** — when a session note has an empty `summary:`, the script now writes the first H1 of the body back into the frontmatter, so the Dataview-rendered Session Log always has a stable label even if the agent forgot to fill it.
- **`/obs sync todos` and `/obs sync all`** — the `sync` subcommand now covers both derived indexes; `all` is the new default and runs both helpers.
- **`/obs-finalize-recap` command** in the pi extension — manually re-runs both sync helpers; useful if the agent_end hook ever fails or you want to repair a vault.

### Changed

- **Pi `obs-memory` extension recap detection rewritten** — previously only fired when the user input literally contained `/obs recap`. Now:
  - Matches a wider set of recap phrasings (`wrap up`, `write a session summary`, `recap`, etc.)
  - Snapshots `sessions/*.md` mtimes before each turn and fires the sync helpers whenever a new or modified session note is detected at `agent_end`, even if no recap phrase was used. This catches sessions written via `/obs recap`, prompt templates, or other extensions uniformly.
  - Always runs both `sync_sessions.py` and `sync_todos.py` after a recap signal, with per-target error reporting so a partial failure is visible instead of silent.
- **`SKILL.md recap` procedure simplified** — step 5 (TODO update) now only asks the agent to mark items `[x]` and add new ones; the archival move is delegated to `sync_todos.py`. Step 6 invokes both helpers explicitly and notes that the pi extension runs them automatically.

### Fixed

- Session Log rows could end up blank when the agent forgot to fill `summary:` — backfill now guarantees a useful label.
- Completed `[x]` items could accumulate in `Active TODOs.md` indefinitely when the agent skipped the archival step — the helper now removes them deterministically on every recap.

### Tests

- `tests/test_sync_todos.py` — grouping by project heading, archive auto-creation, idempotency, `Uncategorized` fallback when no H2 precedes a completed item.
- `tests/test_sync_sessions.py` — new cases for summary backfill and not clobbering existing summaries.

## [2.3.0] — 2026-06-15

### Added

- **Pi agent first-class support** — mirrors the full Claude Code feature set:
  - `package.json` with `pi` key — enables `pi install git:github.com/adamtylerlynch/obsidian-agent-memory-skills` and automatic resource discovery
  - `extensions/obs-memory.ts` — Pi extension that hooks `before_agent_start`; on the first turn of each new session it injects the full `SKILL.md` into the system prompt, triggering the Session Start — Orientation procedure automatically (the Pi equivalent of Claude Code’s always-present plugin skill)
  - `prompts/obs.md` — Pi prompt template registering `/obs` as a native command with argument dispatch (mirrors `commands/obs.md` for Claude Code)
  - `init` command now emits a Pi-appropriate `AGENTS.md` config snippet alongside the existing Claude Code (`CLAUDE.md`) and generic (env var) snippets
- Pi added to Agent Compatibility table in README with "Full support" tier
- README explains proactive skill mechanisms per agent (plugin.json vs extension vs progressive disclosure)

### Fixed

- `plugin.json` referenced non-existent path `./skills/obs-memory` — corrected to `./skills/obs`
- `commands/obs.md` and `setup.sh` also referenced the stale `skills/obs-memory` path — corrected to `skills/obs`
- README Package Contents tree showed `skills/obs-memory/` — corrected to `skills/obs/`

## [2.2.0] — 2026-02-17

### Added

- **`analyze` command** — scans the current repo for knowledge sources (CLAUDE.md, README, ADRs, package manifests, CI configs), analyzes project structure, and writes populated vault notes (project overview, components, patterns, ADR imports, domain links) with idempotency to preserve existing manual work
- `Bash(ls:*)` added to allowed-tools (needed by `analyze` for directory listing)
- `type: pattern` added to pattern note frontmatter convention

### Fixed

- Duplicate paragraph in README "Search vault knowledge" section

## [2.1.0] — 2026-02-16

### Breaking Changes

- **Slash command renamed**: `/obs-memory` → `/obs` — shorter, easier to type
- **`end` command renamed to `recap`** — clearer intent, avoids "terminate session" ambiguity
- **Activation triggers tightened** — skill now activates on "obsidian memory", "obsidian vault", "obsidian notes", "/obs commands" instead of overly generic "agent memory", "knowledge graph", "project architecture"

### Added

- **Automatic Behaviors** — agent-agnostic lifecycle that works without explicit commands:
  - **Session start**: auto-orients (TODOs + project overview) without being asked
  - **Session end signals**: detects "done", "wrapping up", etc. and offers to write a recap
  - **Component discovery**: offers to create vault notes when agent deeply analyzes undocumented components
  - **First run**: guides through `init` when no vault exists
- **Enhanced `init`** — three new steps:
  - Generates agent config snippet (CLAUDE.md for Claude Code, env var for others)
  - Auto-scaffolds current project if inside a git repo
  - Concise 5-8 line output
- `Bash(git remote:*)` added to allowed-tools (needed by `project` command)

### Changed

- **Single source of truth** — all command procedures consolidated into `SKILL.md` (~666 lines); command adapter `obs.md` is dispatch-only (~37 lines)
- **Net reduction**: −484 lines of duplication removed (504 insertions, 988 deletions)
- SKILL.md version: `2.1`
- plugin.json version: `2.1.0`

### Removed

- `commands/obs-memory.md` — replaced by `commands/obs.md`
- `skills/obs-memory/references/commands.md` — merged into SKILL.md
- `skills/obs-memory/references/` directory — empty after merge

## [2.0.0] — 2026-02-15

### Added

- **CLI-first relationship engine** — `relate` command with bidirectional relationship management
  - `relate <source> <target> [type]` — creates `depends-on`/`depended-on-by`, `extends`/`extended-by`, `implements`/`implemented-by`, `consumes`/`consumed-by`
  - `relate show <name>` — displays all relationships for a note
  - `relate tree <name> [depth]` — BFS walk of dependency tree
- **Enhanced `lookup`** with structured subcommands:
  - `lookup deps`, `lookup consumers`, `lookup related`, `lookup type`, `lookup layer`, `lookup files`
- CLI-first patterns with file-read fallbacks throughout all commands

## [1.0.0] — 2026-02-15

### Added

- Multi-agent support via Agent Skills specification
- `init` command with bundled vault template
- `end` command for session summaries
- `project` command for vault scaffolding
- `note` command (component, adr, pattern templates)
- `todo` command for TODO management
- `lookup` command for freetext vault search
- Session start orientation (TODOs + project overview)
- Graph navigation with wikilinks
- Token budget rules

## [0.1.0] — 2026-02-15

### Added

- Initial obs-memory skill package
