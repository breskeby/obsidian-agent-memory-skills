# pi-obs-ambient

Pi extension that makes the [obs-memory](../../skills/obs/SKILL.md) vault *ambient*: lookup happens automatically before every assistant turn, and a status-line slot surfaces what the memory subsystem just did.

This is the **engine** for the agent-agnostic `obs-memory` skill. The skill defines what notes look like and how the agent should consult them; this extension wires the consultation into pi's lifecycle.

## What it does today (Milestone B — lookup-first)

- **Pre-turn entity extraction** (`before_agent_start`): scans the user's prompt for file paths and PascalCase tokens, runs `obsidian search` for each, and injects a compact `<vault-context>` block with the top hits' titles + summaries.
- **Status line** (`obs-memory` slot): shows what just happened — vault size on session start, "looking up…", "injected N notes", "no vault matches", etc.
- **Token budget**: injection capped at ~500 tokens; overflow degrades to title-only with a hint to call `obs lookup` for details.

## What it does **not** do yet (Milestone A — capture)

- No `obs_note` tool. Capture remains the skill's responsibility for now.
- No post-bash inbox drafts.
- No `<vault-context>` contradiction detection.

## Install

```bash
# Symlink for local development
ln -s /Users/rene/dev/obsidian-agent-memory-skills/extensions/pi-obs-ambient ~/.pi/agent/extensions/pi-obs-ambient
# Or copy
cp -r /Users/rene/dev/obsidian-agent-memory-skills/extensions/pi-obs-ambient ~/.pi/agent/extensions/
```

Then `/reload` in pi.

## Config

Reads `~/.pi/agent/extensions/pi-obs-ambient/config.json` if present:

```json
{
  "vaultName": "agent-memory",
  "tokenBudget": 500,
  "minTokenLength": 4,
  "projectRoots": ["/Users/rene/dev"]
}
```

Defaults to the values above.
