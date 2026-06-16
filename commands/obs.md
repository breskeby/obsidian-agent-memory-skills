---
description: "Manage your Obsidian agent memory vault — initialize, analyze projects, write session summaries, scaffold projects, create notes, update TODOs, search vault knowledge, and manage relationships."
argument-hint: "<init|analyze|recap|sync|project|note|todo|lookup|relate> [args]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git log:*), Bash(git diff:*), Bash(git rev-parse:*), Bash(git branch:*), Bash(git remote:*), Bash(basename:*), Bash(obsidian:*), Bash(date:*), Bash(cp:*), Bash(mkdir:*), Bash(cat:*), Bash(touch:*), Bash(ls:*)
---

# /obs — Vault Management (Claude Code)

Resolve variables, then dispatch to the obs-memory skill procedure.

## Variable Resolution

**$VAULT**: `$OBSIDIAN_VAULT_PATH` env var → parse from CLAUDE.md ("Obsidian Knowledge Vault" section) → `~/Documents/AgentMemory`

**$VAULT_NAME**: `basename "$VAULT"`

**$PROJECT**:
```bash
common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
if [ -n "$common_dir" ]; then
  case "$common_dir" in
    */.git) basename "$(dirname "$common_dir")" ;;
    *)      basename "${common_dir%.git}" ;;
  esac
else
  basename "$(pwd)"
fi
# Canonical repo name; stable across git worktrees. Do NOT use --show-toplevel.
# See skills/obs/SKILL.md § Session Start Step 2.
```

Verify `$VAULT/Home.md` exists. If not → suggest `/obs init`.

## Dispatch

Execute the matching command procedure from the obs-memory skill (`skills/obs/SKILL.md` § Commands):

| `$ARGUMENTS[0]` | Skill procedure |
|---|---|
| `init` | `init` — pass `$ARGUMENTS[1]` as path |
| `analyze` | `analyze` |
| `recap` | `recap` |
| `sync` | `sync` — pass `$ARGUMENTS[1..]` as target |
| `project` | `project` — pass `$ARGUMENTS[1]` as name |
| `note` | `note` — pass `$ARGUMENTS[1]` as type, `$ARGUMENTS[2]` as name |
| `todo` | `todo` — pass `$ARGUMENTS[1..]` as action |
| `lookup` | `lookup` — pass `$ARGUMENTS[1..]` as query |
| `relate` | `relate` — pass `$ARGUMENTS[1..]` as args |
| _(empty)_ | Session Start — Orientation |
