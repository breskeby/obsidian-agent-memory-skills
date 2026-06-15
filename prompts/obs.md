---
description: "Manage your Obsidian agent memory vault — initialize, analyze projects, write session summaries, scaffold projects, create notes, manage specs and branch-scoped plans, update TODOs, search vault knowledge, and manage relationships."
argument-hint: "<init|analyze|recap|project|note|spec|plan|todo|lookup|relate> [args]"
---

# /obs — Vault Management (Pi)

Read the skill instructions from `skills/obs/SKILL.md` (locate the skill package root first), resolve variables, then dispatch to the matching command procedure.

## Variable Resolution

**$VAULT**: `$OBSIDIAN_VAULT_PATH` env var → parse from agent config ("Obsidian Knowledge Vault" section) → `~/Documents/AgentMemory`

**$VAULT_NAME**: `basename "$VAULT"`

**$PROJECT**:
```bash
basename $(git rev-parse --show-toplevel 2>/dev/null) 2>/dev/null || basename $(pwd)
```

Verify `$VAULT/Home.md` exists. If not → suggest running `/obs init`.

## Dispatch

Execute the matching command procedure from the obs-memory skill (`skills/obs/SKILL.md` § Commands):

| `$1` | Skill procedure |
|---|---|
| `init` | `init` — pass `${@:2}` as path |
| `analyze` | `analyze` |
| `recap` | `recap` |
| `project` | `project` — pass `${@:2}` as name |
| `note` | `note` — pass `$2` as type, `${@:3}` as name |
| `spec` | `spec` — pass `$2` as action (`new`/`list`/`status`/`link`), `${@:3}` as args |
| `plan` | `plan` — pass `$2` as action (`new`/`current`/`list`/`refine`/`complete`/`abandon`), `${@:3}` as args |
| `todo` | `todo` — pass `${@:2}` as action |
| `lookup` | `lookup` — pass `${@:2}` as query |
| `relate` | `relate` — pass `${@:2}` as args |
| _(empty)_ | Session Start — Orientation |
