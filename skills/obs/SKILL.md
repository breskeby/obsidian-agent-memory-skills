---
name: obs-memory
description: "Persistent Obsidian-based memory for coding agents. Use at session start to orient from a knowledge vault, during work to look up architecture/component/pattern/spec/plan notes, and when discoveries are made to write them back. Activate when the user mentions obsidian memory, obsidian vault, obsidian notes, or /obs commands. Provides commands: init, analyze, recap, sync, project, note, spec, plan, todo, lookup, relate."
metadata:
  author: adamtylerlynch
  version: "2.2"
license: MIT
---

# Obsidian Agent Memory

You have access to a persistent Obsidian knowledge vault — a graph-structured memory that persists across sessions. Use it to orient yourself, look up architecture and component knowledge, and write back discoveries.

## Vault Discovery

Resolve the vault path using this chain (first match wins):

1. **Environment variable**: `$OBSIDIAN_VAULT_PATH`
2. **Agent config reference**: Parse the vault path from the agent's project or global config (look for "Obsidian Knowledge Vault" section with a path like `~/Documents/SomeName/`)
3. **Default**: `~/Documents/AgentMemory`

Store the resolved path as `$VAULT` for all subsequent operations. Derive `$VAULT_NAME` as `basename "$VAULT"` for CLI calls.

Verify the vault exists by checking for `$VAULT/Home.md`. If the vault doesn't exist, inform the user and suggest running the `init` command to bootstrap a new vault from the bundled template.

## Session Start — Orientation

At the start of every session, orient yourself with **at most 2 operations**:

### Step 1: Read TODOs

**CLI-first**:
```bash
obsidian vault=$VAULT_NAME tasks path="todos" todo verbose
```
**Fallback**: Read the file at `$VAULT/todos/Active TODOs.md`.

Know what's pending, in-progress, and recently completed.

### Step 2: Detect current project and read its overview

Auto-detect the project from the current working directory. **Critical:** resolve to the *canonical* repo identity so git worktrees of the same repo map to a single vault project, not one per worktree directory.

Resolution order (first match wins):

1. **Git common dir basename** — points at the main repo even from a linked worktree:
   ```bash
   common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
   if [ -n "$common_dir" ]; then
     # $common_dir typically ends in `/.git` (or is a bare repo dir); its parent is the main repo root
     case "$common_dir" in
       */.git) basename "$(dirname "$common_dir")" ;;
       *)      basename "${common_dir%.git}" ;;
     esac
   fi
   ```
   This returns the same name whether you're in `~/dev/myproject` or in a worktree like `~/dev/myproject-feature-x` created via `git worktree add`.

2. **Git remote URL** (sanity check / tiebreaker) — if step 1 fails or you need to disambiguate:
   ```bash
   git remote get-url origin 2>/dev/null | sed -E 's#.*/([^/]+?)(\.git)?$#\1#'
   ```

3. **Current directory basename** — last resort when there's no git repo at all:
   ```bash
   basename "$(pwd)"
   ```

Then check if a matching project exists by listing files in `$VAULT/projects/*/`. Match the canonical name against project folder names. If a match is found, read the project overview at `$VAULT/projects/{matched-name}/{matched-name}.md`.

**Worktree note:** when you're in a worktree, the project overview's `path:` frontmatter still points at the main repo root. That's intentional — the vault tracks the *project*, not the checkout. Per-branch state belongs in `plans/` (scoped by branch), not in a separate project.

This project overview contains wikilinks to all components, patterns, architecture decisions, and domains. **Do not read those linked notes yet** — follow them on demand when the current task requires that context.

### What NOT to read at session start
- `Home.md` (only if you're lost and can't find the project)
- `sessions/` (only if the user references prior work)
- Domain indexes (only if you need cross-project knowledge)
- Component notes (only when working on that component)

## Automatic Behaviors

These behaviors apply to any agent using this skill. They do not require explicit commands.

### On session start

Auto-orient (TODOs + project overview) without being asked, following the Session Start procedure above. If the vault doesn't exist at the resolved path, inform the user and suggest running `init`.

### On session end signals

When the user says "done", "wrapping up", "that's it", "let's stop", or similar end-of-session language — offer to write a session summary. Don't auto-run; ask first: "Want me to write a session summary to the vault before we wrap up?"

### On component discovery

When you deeply analyze a component that has no vault note — and the project has an active vault — offer to create a component note and infer relationships from imports and dependencies. Example: "I noticed there's no vault note for the AuthMiddleware component. Want me to create one and map its dependencies?"

### On first run

When the vault doesn't exist at any resolved path, guide the user through `init`, then auto-scaffold the current project if inside a git repo.

## During Work — Graph Navigation

**Principle: Use CLI queries first, file reads second.** The Obsidian CLI provides structured access to properties, links, backlinks, tags, and search — prefer these over reading entire files.

### Injected `<vault-context>` is authoritative

If you see a `<vault-context source="obs-memory">` block in your system prompt or context, it was injected automatically by the **pi-obs-ambient** extension (when running under pi) or an equivalent host integration. The block lists vault notes that match entities in the current user prompt, with their `type`, `summary`, and vault-relative path.

**Rules when `<vault-context>` is present:**

1. **Treat it as ground truth.** The vault is your persistent memory; injected notes encode prior decisions, architecture constraints, and gotchas you have already learned. Do not re-derive what is already written down.
2. **Cite with `[[NoteTitle]]`** whenever a claim in your reply derives from an injected note. Citations are not decorative — they let the user (and future sessions) trace your reasoning back to the source. A reply that uses vault knowledge without citing it is incomplete.
3. **Fetch the body if the summary is insufficient.** Inject only summaries, never full bodies. If a summary points at the right note but you need the details, follow the path with a `read` or `obsidian outline`/`obsidian property:read` call.
4. **If the injected note is wrong, say so explicitly in your reply.** Flag the contradiction by name (e.g. "`[[Task Avoidance API]]` says X but the code now does Y — the note is stale"). An auto-update tool will land in a later milestone; for now a flag is enough so the user can decide.
5. **Do not parrot the block back to the user.** It is for your reasoning. Quote or summarise selectively only when directly relevant to what you are explaining.
6. **Absence is not authoritative.** No `<vault-context>` block means no matches were found for the prompt’s entities, not that the vault is empty. If you suspect a relevant note exists, run a CLI lookup (next section) before assuming you have to figure it out from scratch.

### CLI-first lookups (preferred)

Use these CLI commands for targeted queries without consuming file-read tokens:

```bash
# Query a component's dependencies
obsidian vault=$VAULT_NAME property:read file="Component Name" name="depends-on"

# Find what depends on a component
obsidian vault=$VAULT_NAME property:read file="Component Name" name="depended-on-by"
obsidian vault=$VAULT_NAME backlinks file="Component Name"

# Find all outgoing links from a note
obsidian vault=$VAULT_NAME links file="Component Name"

# Find all notes of a type
obsidian vault=$VAULT_NAME tag verbose name="component"

# Search vault content
obsidian vault=$VAULT_NAME search format=json query="search term" matches limit=10

# Get note structure without full read
obsidian vault=$VAULT_NAME outline file="Component Name"

# Read a specific property
obsidian vault=$VAULT_NAME property:read file="Component Name" name="key-files"
```

Where `$VAULT_NAME` is the vault folder name (basename of `$VAULT`).

### File-read fallback (when CLI unavailable)

Fall back to file reads when the Obsidian CLI is not available:
- Need to understand a component? The project overview links to it. Read that one note.
- Need an architecture decision? The component note or project overview links to it. Follow the link.
- Need cross-project knowledge? Component/pattern notes link to domain notes. Follow the link.
- Need session history? Only read if you're stuck or the user references prior work.

### Frontmatter-first scanning
When you need to scan multiple notes to find the right one, read just the first ~10 lines of each file. The `tags`, `project`, `type`, and `status` fields in the frontmatter tell you if the note is relevant before reading the full body.

### Directory listing before reading
List directory contents before reading files — know what exists without consuming tokens:
- `$VAULT/projects/{name}/**/*.md` — all notes for a project
- `$VAULT/domains/{tech}/*.md` — domain knowledge files

## Writing to the Vault

Write concisely. Notes are for your future context, not human documentation. Prefer:
- Bullet points over prose
- Wikilinks over repeated explanations (link to it, don't re-state it)
- Frontmatter tags for discoverability over verbose descriptions

### When to write
- **New component discovered**: Create a component note when you deeply understand a part of the codebase
- **Architecture decision made**: Record ADRs when significant design choices are made
- **Pattern identified**: Document recurring patterns that future sessions should follow
- **Domain knowledge learned**: Write to domain notes when you discover cross-project knowledge

### Scoping rules
| Knowledge type | Location | Example |
|---|---|---|
| One project only | `projects/{name}/` | How this API handles auth |
| Stable design (the *what*) | `projects/{name}/specs/` | "Multi-tenant billing" spec |
| Initiative impl plan (the *how*) | `projects/{name}/plans/` | "add-stripe-integration" plan for current branch or push |
| Shared across projects | `domains/{tech}/` | How Go interfaces work |
| Universal, tech-agnostic | `patterns/` | SOLID principles |
| Session summaries | `sessions/` | What was done and discovered |
| TODOs | `todos/Active TODOs.md` | Grouped by project |

### Frontmatter conventions
Always include in new notes:
```yaml
---
tags: [category, project/short-name]
type: <component|adr|session|project|pattern|spec|plan>
project: "[[projects/{name}/{name}]]"
created: YYYY-MM-DD
triggers:                # see “Triggers” below — lowercase phrases that should surface this note
  - example phrase
  - another phrase
---
```

### Triggers (first-class discoverability)

The `triggers:` frontmatter is a **list of lowercase natural-language phrases that should surface this note** when they appear in a user prompt. Hosts that run an ambient-lookup engine over the vault (such as the [`pi-obs-ambient`](../../extensions/pi-obs-ambient/README.md) pi extension) build an inverted index over all `triggers:` at session start and inject matching notes into the system prompt automatically. Without triggers, a note is reachable only via title/alias search, which fails for the way humans actually phrase questions (`"how does the gradle build work"` does not match `Task Avoidance API`).

**Authoring rules:**

1. **Lowercase, natural-language phrases.** Not titles, not identifiers — the form a colleague would actually type. `gradle build`, not `GradleBuild`; `task avoidance`, not `TaskAvoidanceAPI`.
2. **Multi-word phrases preferred over single words.** Single-word triggers (`gradle`, `build`) match too broadly and pull the note into unrelated prompts. Aim for 2–3 words.
3. **3–8 triggers per note.** Fewer and you miss real prompts; more and you spam unrelated turns. Stop when you can't think of a phrase that wouldn't also fit a different note.
4. **Cover synonyms and aliases.** `dependency rules`, `transitive deps`, `component metadata` all point at the same note — list them.
5. **Re-use a shared parent phrase to cluster related notes.** Multiple build notes can all carry `gradle build` so a generic question surfaces the whole cluster; a specific question hits the narrower triggers exclusively. This is by design.
6. **Don't add triggers to session notes.** Sessions are point-in-time logs; surfacing them in future turns is noise.
7. **Avoid words that are universal in the codebase.** A trigger of `class` or `service` in a Java project will match every prompt. Prefer domain-distinctive phrases.

**Matching semantics (host-defined, but follow these expectations):**

- Substring match against the lowercased prompt with **word-boundary** edges. `gradle build` matches `"the gradle build is great"` but not `"gradle builds"`.
- No stemming, no fuzzy matching, no synonyms inferred. If you want plural forms to match, list them explicitly.
- Notes are deduped across triggers — a single note matched by three triggers is injected once.

**When to skip triggers:**

For notes that are rarely useful out of context (e.g. ADRs that record a specific decision in detail), omit `triggers:` and rely on backlinks plus the project-overview injection fallback. The goal is signal, not coverage.

### Wikilink conventions
- Link to related notes: `[[projects/{name}/components/Component Name|Component Name]]`
- Link to domains: `[[domains/{tech}/{Tech Name}|Tech Name]]`
- Link back to project: `[[projects/{name}/{name}|project-name]]`

### Note templates

**Component Note:**
```yaml
---
tags: [components, project/{short-name}]
type: component
project: "[[projects/{name}/{name}]]"
created: {date}
status: active
layer: ""
depends-on: []
depended-on-by: []
key-files: []
triggers: []          # 3–8 lowercase phrases — see “Triggers” above
---
```
Sections: Purpose, Gotchas

**Architecture Decision:**
```yaml
---
tags: [architecture, decision, project/{short-name}]
type: adr
project: "[[projects/{name}/{name}]]"
status: proposed | accepted | superseded
created: {date}
triggers: []          # optional; ADRs that record narrow decisions usually skip this
---
```
Sections: Context, Decision, Alternatives Considered, Consequences

**Pattern Note:**
```yaml
---
tags: [patterns, project/{short-name}]
type: pattern
project: "[[projects/{name}/{name}]]"
created: {date}
triggers: []          # 3–8 lowercase phrases
---
```
Sections: Pattern, When to Use, Implementation, Examples

**Session Note:**
```yaml
---
tags: [sessions]
type: session
projects:
  - "[[projects/{name}/{name}]]"
created: {date}
branch: {branch-name}
summary: ""
---
```
Sections: Context, Work Done, Discoveries, Decisions, Next Steps

> Session notes intentionally have **no `triggers:`** — they are point-in-time records and should not surface in future turns.

## Commands

### `init` — Initialize the Vault

Bootstrap a new Obsidian Agent Memory vault from the bundled template.

**Usage**: `init [path]`

#### Steps:

1. **Determine vault path**: Use the first argument if provided, otherwise use the vault resolution chain (default: `~/Documents/AgentMemory`).

2. **Check if vault already exists**: Look for `$VAULT/Home.md`. If it exists, tell the user the vault already exists at that path and offer to open it.

3. **Locate the bundled template**: The template is at `vault-template/` relative to the skill package root. Search for the skill package installation directory — it may be in the agent's plugin/skill cache or a local checkout. Look for the `vault-template/Home.md` file to confirm the correct path.

4. **Create the vault**:
   ```bash
   mkdir -p "$VAULT"
   cp -r "$TEMPLATE_DIR/vault-template/"* "$VAULT/"
   ```

5. **Create Obsidian config directory**:
   ```bash
   mkdir -p "$VAULT/.obsidian"
   ```
   Write the following to `$VAULT/.obsidian/app.json`:
   ```json
   {
     "alwaysUpdateLinks": true,
     "newFileLocation": "folder",
     "newFileFolderPath": "inbox",
     "attachmentFolderPath": "attachments"
   }
   ```

6. **Create empty directories**:
   ```bash
   mkdir -p "$VAULT/inbox"
   mkdir -p "$VAULT/attachments"
   ```
   Create `.gitkeep` files in each empty directory.

7. **Report** the created vault and provide next steps:
   - Open in Obsidian: Vault Switcher → Open folder as vault → `$VAULT`
   - Set the vault path via `OBSIDIAN_VAULT_PATH` environment variable or agent config
   - Start working — the agent will build the knowledge graph as it goes

8. **Generate agent config snippet**: Output a vault path snippet appropriate for the user's agent:

   - **Claude Code** — output a `CLAUDE.md` snippet:
     ```markdown
     ## Obsidian Knowledge Vault
     Persistent knowledge vault at `$VAULT`.
     ```
   - **Pi** — output an `AGENTS.md` snippet (same format; pi reads `AGENTS.md` for global agent instructions):
     ```markdown
     ## Obsidian Knowledge Vault
     Persistent knowledge vault at `$VAULT`.
     ```
   - **Others** — output a generic instruction: "Add `OBSIDIAN_VAULT_PATH=$VAULT` to your shell profile or agent config."

9. **Auto-scaffold current project**: If inside a git repo, automatically run the `project` command to scaffold the current project in the vault.

10. **Concise output**: Keep the final output to 5-8 lines max: vault path created, project scaffolded (if applicable), how to open in Obsidian, how to set the vault path.

### `analyze` — Analyze Project & Hydrate Vault

Analyze the current codebase and populate the vault with interconnected, content-rich notes.

**Usage**: `analyze` (no arguments — uses current repo)

#### Phase 1: Discovery — Scan for Knowledge Sources

Scan the repo for files that contain pre-existing knowledge:

| Category | Files to scan |
|---|---|
| Agent configs | `CLAUDE.md`, `.claude/CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `AGENTS.md`, `Agents.md` |
| Documentation | `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `docs/architecture.md`, `docs/ARCHITECTURE.md` |
| Existing ADRs | `docs/adr/ADR-*.md`, `architecture/ADR-*.md`, `adr/*.md`, `docs/decisions/*.md` |
| Project metadata | `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `setup.py`, `Gemfile`, `pom.xml`, `build.gradle`, `*.csproj` |
| Build/CI | `Makefile`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/*.yml`, `.gitlab-ci.yml` |
| Config | `tsconfig.json`, `.eslintrc.*`, `jest.config.*`, `.goreleaser.yml` |

Read each discovered file. For large files (README, agent configs), read fully. For metadata files, extract key fields (name, version, dependencies).

Also gather:
- Repo URL from `git remote get-url origin`
- **Canonical repo root** from the git common dir (so worktrees resolve to the main repo):
  ```bash
  common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  case "$common_dir" in
    */.git) dirname "$common_dir" ;;
    *)      printf '%s\n' "${common_dir%.git}" ;;
  esac
  ```
  Do **not** use `git rev-parse --show-toplevel` here — it returns the worktree path, which would cause `analyze` to scaffold a duplicate project for every worktree.
- Active branch from `git branch --show-current` (used for plan scope, not project identity)
- Directory tree (top 2 levels of source directories, excluding hidden/vendor/node_modules)
- File extension frequency (for language detection)

#### Phase 2: Analysis — Extract & Synthesize

Using the discovered content, synthesize:

1. **Project metadata**: name, language(s), framework(s), repo URL, local path
2. **Architecture summary**: Entry points, layer organization (e.g., `internal/` → Go service layers, `src/components/` → React app), build system
3. **Component inventory**: Major functional modules — each top-level source directory or logical grouping that represents a distinct unit. For each: purpose (from README/agent config context), key files, and relationships
4. **Pattern inventory**: Coding conventions, error handling strategies, testing approaches — extracted from agent config files (CLAUDE.md sections like "Coding Guidelines", "Testing", etc.)
5. **Domain mapping**: Detected technologies → vault domain notes (e.g., Go, TypeScript, Terraform, React)
6. **Existing decisions**: ADR files found in the repo → import as vault ADR notes
7. **Dependency summary**: Key dependencies from package manifests (listed in project overview, not separate notes)

#### Phase 3: Hydration — Write Vault Notes

**Idempotency rules:**
- If project directory doesn't exist → create everything (scaffold + populate)
- If project directory exists but overview is a skeleton → **replace** overview with populated version
- If individual component/pattern/ADR notes already exist → **skip** and report (don't overwrite manual work)
- Domain notes: create if missing, **append** project link if existing

**Notes to write:**

Also scaffold the spec/plan folders during `analyze` and `project`:
- `$VAULT/projects/{name}/specs/` (with a `.gitkeep`)
- `$VAULT/projects/{name}/plans/` (with a `.gitkeep`)

During `analyze`, also detect existing spec/plan-like documents in the repo and import them:
- Files matching `docs/specs/*.md`, `specs/*.md`, `design/*.md`, `rfcs/*.md` → import as specs
- Files matching `docs/plans/*.md`, `plans/*.md`, `PLAN.md` → import as plans (best-effort; prompt the user before mass import if >5 files)

1. **Project overview** (`$VAULT/projects/{name}/{name}.md`) — Fully populated:
   ```yaml
   ---
   aliases: []
   tags: [project/{short-name}]
   type: project
   repo: {git remote url}
   path: {repo root path}
   language: {detected language(s)}
   framework: {detected framework(s)}
   created: {YYYY-MM-DD}
   status: active
   triggers: [{2–3 broad phrases like "{name} architecture", "{name} overview"}]
   ---
   ```

   The `path:` is consumed by ambient-lookup engines as the fallback target when no trigger or entity matches but the agent's `cwd` is inside this repo. Keep it accurate (the canonical repo root, not a worktree).
   Sections:
   - **Architecture**: Real description from analysis
   - **Components**: Table with wikilinks to component notes
   - **Project Patterns**: Table with wikilinks to pattern notes
   - **Architecture Decisions**: List with wikilinks to ADR notes
   - **Key Dependencies**: From package manifests
   - **Domains**: Wikilinks to domain notes

2. **Component notes** (`$VAULT/projects/{name}/components/{Component}.md`) — One per major module:
   ```yaml
   ---
   tags: [components, project/{short-name}]
   type: component
   project: "[[projects/{name}/{name}]]"
   created: {YYYY-MM-DD}
   status: active
   layer: {detected layer}
   depends-on: []
   depended-on-by: []
   key-files: [{key files list}]
   triggers: [{3–8 lowercase phrases derived from component name + role}]
   ---
   ```
   Sections: Purpose, Gotchas

   **Generating triggers during `analyze`**: for each component, derive triggers from (a) the component's directory name with dashes turned into spaces (`build-tools` → `build tools`), (b) the README/agent-config phrasing that describes its role ("the build system", "REST layer"), and (c) the layer (`layer: build` → add `build infrastructure`). Skip generic words (`server`, `core`) when they would match every prompt. Always include the project's short name in at least one trigger if it's distinctive (e.g. `elasticsearch build`).

3. **Pattern notes** (`$VAULT/projects/{name}/patterns/{Pattern}.md`) — From agent config conventions:
   ```yaml
   ---
   tags: [patterns, project/{short-name}]
   type: pattern
   project: "[[projects/{name}/{name}]]"
   created: {YYYY-MM-DD}
   triggers: [{3–8 lowercase phrases describing when this pattern applies}]
   ---
   ```
   Sections: Pattern, When to Use, Implementation

   **Generating triggers for patterns**: lift them from the pattern's *trigger conditions* in the agent config — "when handling REST requests" → `rest handler`, `rest endpoint`. Patterns are answers to questions, so triggers should be the question shape (`how do I add an endpoint`, `error handling`).

4. **ADR imports** (`$VAULT/projects/{name}/architecture/ADR-{NNNN} {title}.md`) — From existing repo ADRs:
   ```yaml
   ---
   tags: [architecture, decision, project/{short-name}]
   type: adr
   project: "[[projects/{name}/{name}]]"
   status: accepted
   created: {YYYY-MM-DD}
   ---
   ```
   Preserve original content, add vault frontmatter.

5. **Domain notes** (`$VAULT/domains/{tech}/{Tech}.md`):
   - If new: create with project link
   - If existing: add this project to "Projects Using This Domain" section

6. **Index updates**:
   - `$VAULT/projects/Projects.md` — add/update row
   - `$VAULT/domains/Domains.md` — add/update rows for new domains

#### Phase 4: Report

Print a summary:
```
Analyzed: {project-name}
  Sources read: {N} knowledge files
  Created: project overview (populated)
  Created: {N} component notes
  Created: {N} pattern notes
  Imported: {N} architecture decisions
  Linked: {N} domain notes
  Skipped: {N} existing notes (preserved)
```

### `recap` — Write Session Summary

Write a session summary note and update TODOs.

**Usage**: `recap`

#### Steps:

1. **Gather session context** by running:
   ```bash
   git log --oneline -20
   git diff --stat HEAD~5..HEAD 2>/dev/null || git diff --stat
   git branch --show-current
   ```

2. **Read current TODOs** — CLI-first:
   ```bash
   obsidian vault=$VAULT_NAME tasks path="todos" todo verbose
   ```
   Fallback: Read `$VAULT/todos/Active TODOs.md`.

3. **Read project overview** from `$VAULT/projects/$PROJECT/$PROJECT.md` (for wikilinks and context).

4. **Write session note** — CLI-first:
   ```bash
   obsidian vault=$VAULT_NAME create path="sessions/{YYYY-MM-DD} - {title}" template="Session Note" silent
   obsidian vault=$VAULT_NAME property:set path="sessions/{YYYY-MM-DD} - {title}" name="type" value="session" type="text"
   obsidian vault=$VAULT_NAME property:set path="sessions/{YYYY-MM-DD} - {title}" name="branch" value="{current-branch}" type="text"
   obsidian vault=$VAULT_NAME property:set path="sessions/{YYYY-MM-DD} - {title}" name="projects" value="[[projects/$PROJECT/$PROJECT]]" type="list"
   obsidian vault=$VAULT_NAME property:set path="sessions/{YYYY-MM-DD} - {title}" name="summary" value="{one-line-summary}" type="text"
   ```
   Then append body content:
   ```bash
   obsidian vault=$VAULT_NAME append path="sessions/{YYYY-MM-DD} - {title}" content="..."
   ```
   Fallback: Write the file directly at `$VAULT/sessions/{YYYY-MM-DD} - {title}.md`:
   ```yaml
   ---
   tags: [sessions]
   type: session
   projects:
     - "[[projects/$PROJECT/$PROJECT]]"
   created: {YYYY-MM-DD}
   branch: {current-branch}
   summary: "{one-line-summary}"
   ---
   ```
   Sections to fill:
   - **Context**: What was being worked on (from git log context)
   - **Work Done**: Numbered list of accomplishments (from commits and diffs)
   - **Discoveries**: Technical findings worth remembering
   - **Decisions**: Design choices made during this session
   - **Next Steps**: What should happen next (checkboxes)

5. **Update TODOs (edits only)**: Edit `$VAULT/todos/Active TODOs.md` to:
   - Mark items completed in this session with `[x]` (leave them in place — the archival step below moves them)
   - Add any new items discovered during the session, grouped under the project's `## {project}` heading
   - Do **not** manually move `[x]` items to the archive; the helper script does it deterministically in step 6.

6. **Run the post-recap helpers** (deterministic, idempotent — safe to re-run):
   ```bash
   python3 "$SKILL_ROOT/scripts/sync_sessions.py" "$VAULT" sessions
   python3 "$SKILL_ROOT/scripts/sync_todos.py"    "$VAULT" todos
   ```
   - `sync_sessions.py` rebuilds `$VAULT/sessions/Session Log.md` from every `type: session` note **and** backfills any missing `summary:` frontmatter from the note's first H1 — so Dataview rows are never blank.
   - `sync_todos.py` removes every `[x]` checklist item from `Active TODOs.md` and appends it to `Completed TODOs Archive.md` under a `## {project} (YYYY-MM-DD)` heading. Empty groups are skipped.
   - If running under pi with the bundled `obs-memory` extension, these run automatically on `agent_end` after a recap — you can skip this step but it's still safe to call.
   - If `$SKILL_ROOT` is unknown, locate it by finding `skills/obs/SKILL.md`, then resolve the package root as its grandparent directory.

7. **Report** what was written (note path, # TODOs archived, log row count).

### `sync` — Rebuild Derived Indexes

Rebuild denormalized index notes from canonical note files.

**Usage**: `sync [sessions|todos|all]` (default: `all`)

#### `sync sessions`

Regenerate `$VAULT/sessions/Session Log.md` from the session note files under `$VAULT/sessions/`.

Preferred implementation:
```bash
python3 "$SKILL_ROOT/scripts/sync_sessions.py" "$VAULT" sessions
```

Where `$SKILL_ROOT` is the package root containing `scripts/`, `skills/`, and `vault-template/`. If the package root is unknown, locate `skills/obs/SKILL.md` first and resolve `$SKILL_ROOT` as its grandparent directory.

The helper script:
1. Scans all `*.md` files in `$VAULT/sessions/` excluding `Session Log.md`
2. Reads frontmatter and extracts `created`, `projects`/`project`, `branch`, `summary`
3. Backfills missing `summary` from the first heading/title
4. Rewrites `Session Log.md` with generated-note frontmatter, Dataview block, and static fallback table
5. Sorts newest-first by `created`, then filename
6. Is idempotent — every run rewrites the whole note from disk state

If the helper script is unavailable, fall back to the manual rebuild procedure above rather than appending a single row.

#### `sync todos`

Archive every `[x]` checklist item in `$VAULT/todos/Active TODOs.md` to `$VAULT/todos/Completed TODOs Archive.md`, grouped by the nearest `## {project}` heading and tagged with today's date.

```bash
python3 "$SKILL_ROOT/scripts/sync_todos.py" "$VAULT" todos
```

Idempotent: running with no completed items is a no-op.

#### `sync all` (default when no argument)

Run both `sync sessions` and `sync todos`. This is what the pi `obs-memory` extension invokes automatically after every recap.

### `project` — Scaffold New Project

Scaffold a new project in the vault. Uses the first argument as the project name, or defaults to `$PROJECT`.

**Usage**: `project [name]`

#### Steps:

1. **Determine project name**: Use the argument if provided, otherwise use `$PROJECT` (which was resolved via the canonical-name chain in Session Start — git common dir → remote URL → cwd basename, so worktrees collapse to the main repo name).

2. **Check if project exists**: Look for `$VAULT/projects/{name}/{name}.md`. If it exists, tell the user and offer to open it instead.

3. **Create directory structure**:
   - `$VAULT/projects/{name}/`
   - `$VAULT/projects/{name}/architecture/`
   - `$VAULT/projects/{name}/components/`
   - `$VAULT/projects/{name}/patterns/`
   - `$VAULT/projects/{name}/specs/`
   - `$VAULT/projects/{name}/plans/`

4. **Create project overview** at `$VAULT/projects/{name}/{name}.md`:
   ```yaml
   ---
   aliases: []
   tags: [project/{short-name}]
   type: project
   repo: {git remote url if available}
   path: {canonical repo root — not the worktree path; see Session Start Step 2}
   language: {detected from files}
   framework:
   created: {YYYY-MM-DD}
   status: active
   ---
   ```
   Sections: Architecture, Components, Project Patterns, Architecture Decisions, Domains

   Auto-detect and fill:
   - Language from file extensions in the repo
   - Repo URL from `git remote get-url origin`
   - Link to relevant domains that exist in `$VAULT/domains/`

5. **Update Projects.md**: Add a row to the project table in `$VAULT/projects/Projects.md`.

6. **Report** the scaffolded structure.

### `note` — Create a Note from Template

Create a note using a template. The first argument specifies the type: `component`, `adr`, `pattern`, `spec`, or `plan`.

**Usage**: `note <component|adr|pattern|spec|plan> [name]`

For specs and plans, prefer the dedicated `spec` and `plan` top-level commands below — they handle branch detection, status updates, and spec↔plan linking.

#### `note component [name]`

Create at `$VAULT/projects/$PROJECT/components/{name}.md`:
```yaml
---
tags: [components, project/{short-name}]
type: component
project: "[[projects/$PROJECT/$PROJECT]]"
created: {YYYY-MM-DD}
status: active
layer: ""
depends-on: []
depended-on-by: []
key-files: []
triggers: []
---
```
Sections: Purpose, Gotchas

If a name argument is provided, use it as the component name. Otherwise, ask the user.

**Triggers**: propose 3–8 lowercase phrases at creation time based on the component name and role (see “Triggers” in *Writing to the Vault*). Confirm with the user before writing. Examples for a `build-tools` component: `build tools`, `gradle plugins`, `published plugins`. Skip triggers only when the component is intentionally niche.

#### `note adr [title]`

Determine the next ADR number by listing existing ADRs in `$VAULT/projects/$PROJECT/architecture/ADR-*.md`.

Create at `$VAULT/projects/$PROJECT/architecture/ADR-{NNNN} {title}.md`:
```yaml
---
tags: [architecture, decision, project/{short-name}]
type: adr
project: "[[projects/$PROJECT/$PROJECT]]"
status: proposed
created: {YYYY-MM-DD}
---
```
Sections: Context, Decision, Alternatives Considered, Consequences

**Triggers**: ADRs usually omit triggers because they record a single decision in narrow context. Add triggers only when the decision touches a topic that future agents will repeatedly ask about (e.g. a deployment-model ADR for the whole project deserves `deployment model`, `infrastructure choice`).

#### `note pattern [name]`

Create at `$VAULT/projects/$PROJECT/patterns/{name}.md`:
```yaml
---
tags: [patterns, project/{short-name}]
type: pattern
project: "[[projects/$PROJECT/$PROJECT]]"
created: {YYYY-MM-DD}
triggers: []
---
```
Sections: Pattern, When to Use, Implementation, Examples

**Triggers**: required for patterns. They are the question shapes the pattern answers (`error handling`, `how do I add an endpoint`). Without triggers a pattern is invisible to ambient lookup and only reachable by exact title.

After creating any note, add a wikilink to it from the project overview.

### `spec` — Manage Design Specs

Specs describe **what** to build and **why**. They are stable, branch-independent, and outlive any single implementation attempt. One spec typically maps to many plans over time.

**Usage**: `spec [action] [args]`

#### `spec new [title]`

Create a new spec at `$VAULT/projects/$PROJECT/specs/{title}.md` using the `Spec` template.

1. If no title argument, ask the user.
2. Resolve target path. If it already exists, show it instead of overwriting.
3. CLI-first creation:
   ```bash
   obsidian vault=$VAULT_NAME create path="projects/$PROJECT/specs/{title}" template="Spec" silent
   obsidian vault=$VAULT_NAME property:set path="projects/$PROJECT/specs/{title}" name="project" value="[[projects/$PROJECT/$PROJECT]]" type="text"
   ```
   Fallback: write the file directly from the template at `vault-template/templates/Spec.md`.
4. Add a wikilink under the `## Specs` section of the project overview.
5. Report the path and remind the user to fill in Problem, Goals, Proposed Design.

#### `spec list`

List active specs for the current project.

```bash
obsidian vault=$VAULT_NAME search query="type: spec" path="projects/$PROJECT/specs"
```
Fallback: list files under `$VAULT/projects/$PROJECT/specs/` and read frontmatter (first ~10 lines) for `status`.

#### `spec status <title> <draft|accepted|implemented|superseded>`

Update a spec's status.

```bash
obsidian vault=$VAULT_NAME property:set file="<title>" name="status" value="<new-status>" type="text"
```

#### `spec link <spec-title> <plan-title>`

Link a spec to a plan bidirectionally.

1. Append `[[projects/$PROJECT/plans/<plan-title>]]` to the spec's `related-plans` list.
2. Set the plan's `spec` property to `[[projects/$PROJECT/specs/<spec-title>]]`.

Use the read-then-set pattern from `relate` to avoid clobbering.

### `plan` — Manage Implementation Plans

Plans are the **how** — the executable implementation strategy for an *initiative*. An initiative is whatever the user is focused on right now: typically a git branch, but it can also be a feature push on `main`, a spike, or a focused session. One plan per initiative. Plans accumulate refinements across sessions (mirror the bear-plan extension model) and are archived when the work ships or is dropped.

**Usage**: `plan [action] [args]`

#### Scope detection

Plans use a single `scope` identifier (not separate branch + commit). Resolve it in this order:

1. Current git branch: `git branch --show-current` — use as-is.
2. If detached HEAD or no git repo: ask the user for a short slug (e.g. `multi-tenant-billing`).

Plan file naming: `{scope} — {short-title}.md` where `scope` has `/` replaced by `-`. One plan per scope by default.

#### Single-file invariant

**One plan per scope. Ever.** Refining a plan must update the original file in place — never create a copy, a v2, a new dated file, or a renamed sibling. This mirrors the bear-plan extension's "one Bear note per (repo, branch)" rule and is what makes plans persist usefully across sessions.

Concretely:
- Before creating any plan file, search for an existing one by `scope:` frontmatter. If found → hand off to `plan refine`. Do not create.
- The plan's filename (`{scope} — {title}.md`) is set once at creation and never changed, even if the human title in the body evolves. The `scope` identifier is the stable key.
- Even if the user's branch is renamed or rebased, keep editing the existing plan file. Update the `scope` frontmatter if the branch was truly renamed; do not fork.

#### `plan new [title]`

Create a new plan for the current initiative — only if one does not already exist for this scope.

1. Resolve scope (see above).
2. **Existence check (mandatory).** Search by `scope:` frontmatter property:
   ```bash
   obsidian vault=$VAULT_NAME search query="scope: {scope}" path="projects/$PROJECT/plans"
   ```
   Fallback: grep `$VAULT/projects/$PROJECT/plans/` for `scope: {scope}`.
   - If a match exists → **do not create**. Print the path and invoke `plan refine` instead.
3. If no title argument, derive one from the scope or ask the user.
4. CLI-first creation at `$VAULT/projects/$PROJECT/plans/{scope} — {title}.md`:
   ```bash
   obsidian vault=$VAULT_NAME create path="projects/$PROJECT/plans/{scope} — {title}" template="Plan" silent
   obsidian vault=$VAULT_NAME property:set path="projects/$PROJECT/plans/{scope} — {title}" name="project" value="[[projects/$PROJECT/$PROJECT]]" type="text"
   obsidian vault=$VAULT_NAME property:set path="projects/$PROJECT/plans/{scope} — {title}" name="scope" value="{scope}" type="text"
   ```
   Fallback: write directly from `vault-template/templates/Plan.md` with placeholders substituted.
5. Add a wikilink under the `## Plans` section of the project overview.
6. If the user mentions a related spec, run `spec link` to bind them.

#### `plan current`

Resolve the plan for the current initiative. CLI-first:
```bash
obsidian vault=$VAULT_NAME search query="scope: {current-scope}" path="projects/$PROJECT/plans"
```
Fallback: grep `$VAULT/projects/$PROJECT/plans/` for `scope: {current-scope}` in frontmatter.

If zero matches → offer to run `plan new`.
If one match → read and display it.
If multiple → list them; prefer the one with `status: active`.

#### `plan list [status]`

List plans for the current project, optionally filtered by status (`active`, `completed`, `abandoned`).

```bash
obsidian vault=$VAULT_NAME search query="type: plan" path="projects/$PROJECT/plans"
```

#### `plan refine [note]`

Update the existing plan for the current scope **in place**. This is the default verb for any ongoing planning work — it never creates a new file.

1. Resolve the current plan via `plan current`. If none exists, offer `plan new` and stop.
2. Update the plan body directly. Two complementary update modes:
   - **Steps mutation** — when the work shape itself changes (steps added, removed, reordered, marked done): edit the `## Steps` checklist directly in the existing file. Check off completed items as `[x]`, add new items, remove obsolete ones. Use the obsidian CLI `read` + targeted edits, or the `edit` tool with exact-text replacement on the markdown file path. Do not duplicate the steps section.
   - **Refinement log entry** — when the *reasoning* changes (a decision was made, a constraint emerged, scope shifted): append a dated section under `## Refinement Log`:
     ```bash
     obsidian vault=$VAULT_NAME append path="projects/$PROJECT/plans/{...}" content="\n### {YYYY-MM-DD HH:mm} — refinement\n\n{note}"
     ```
3. Discoveries and decisions made while executing the plan go under `## Discoveries` and `## Decisions Made` of the same file — append, do not branch off into a new note. Promote items to a Component note, Spec edit, or ADR only when they outgrow the plan.

**Never** in `plan refine`:
- Create a new file in `plans/`.
- Rename the existing plan file (even if the human title in `# {{title}}` is updated).
- Duplicate the steps section with a "v2" or "updated" heading.

#### `plan complete [title]`

Mark the current (or named) plan as completed.

1. Set `status: completed` on the plan.
2. Append a final "Outcome" section summarizing what shipped.
3. Move completed `[x]` TODO items for this project to the archive (same as `recap`).
4. If the plan was linked to a spec, optionally set the spec's `status: implemented`.

#### `plan abandon [title]`

Mark the plan as `status: abandoned`. Useful when a branch is dropped without merging. Append a short note explaining why — future sessions on similar problems should be able to learn from the abandonment.

#### Auto-behaviors for plans

- **On session start**, after orienting from the project overview, also run `plan current` silently. If an active plan exists for the current scope, surface it as part of orientation so the agent knows the in-flight strategy.
- **On significant turns** (e.g. when the agent produces something that detects as a plan — a heading like `## Plan` followed by numbered steps), offer to run `plan refine` to capture the refinement in the existing plan file. Don't auto-write; ask first. Never offer `plan new` if `plan current` resolved a file — always refine.
- **On branch switch** detected mid-session (via `git branch --show-current` changing), re-resolve `plan current` for the new scope.

### `todo` — Manage TODOs

View and update the Active TODOs for the current project.

**Usage**: `todo [action]`

#### Steps:

1. **Read current TODOs** from `$VAULT/todos/Active TODOs.md`.

2. **If no additional arguments**: Display the current TODOs for `$PROJECT` and ask what to update.

3. **If arguments provided**: Parse as a TODO action:
   - Plain text → Add as a new pending item under `$PROJECT`
   - `done: <text>` → Mark item done: remove from Active TODOs, append to `$VAULT/todos/Completed TODOs Archive.md` under a dated `## $PROJECT (YYYY-MM-DD)` heading (create the file if it doesn't exist)
   - `remove: <text>` → Remove matching item

4. **Write back** Active TODOs (and archive file if items were completed).

### `lookup` — Search the Vault

Search the vault for knowledge. Supports targeted subcommands and freetext search.

**Usage**: `lookup <subcommand|freetext>`

#### `lookup deps <name>`

Query what a component depends on.

```bash
obsidian vault=$VAULT_NAME property:read file="<name>" name="depends-on"
```
Fallback: Read the component note and parse the `depends-on` frontmatter list.

#### `lookup consumers <name>`

Query what depends on a component (reverse dependencies).

```bash
obsidian vault=$VAULT_NAME property:read file="<name>" name="depended-on-by"
obsidian vault=$VAULT_NAME backlinks file="<name>"
```
Combine results — `depended-on-by` gives explicit relationships, `backlinks` catches implicit references. Fallback: Read the component note and search for backlinks via Grep.

#### `lookup related <name>`

Query all notes connected to a given note (both directions).

```bash
obsidian vault=$VAULT_NAME links file="<name>"
obsidian vault=$VAULT_NAME backlinks file="<name>"
```
Fallback: Read the note and extract wikilinks, then Grep for `[[<name>` across the vault.

#### `lookup type <type> [project]`

Find all notes of a given type (component, adr, session, project).

```bash
obsidian vault=$VAULT_NAME tag verbose name="<type>"
```
If `[project]` is specified, filter results to notes also tagged `project/<short-name>`:
```bash
obsidian vault=$VAULT_NAME search query="type: <type>" path="projects/<project>"
```
Fallback: Grep for `type: <type>` across `$VAULT`.

#### `lookup layer <layer> [project]`

Find all components in a specific layer.

```bash
obsidian vault=$VAULT_NAME search query="layer: <layer>" path="projects/<project>"
```
If no project specified, search across all projects:
```bash
obsidian vault=$VAULT_NAME search query="layer: <layer>" path="projects"
```
Fallback: Grep for `layer: <layer>` across `$VAULT/projects/`.

#### `lookup files <component>`

Query key files for a component.

```bash
obsidian vault=$VAULT_NAME property:read file="<component>" name="key-files"
```
Fallback: Read the component note and parse the `key-files` frontmatter list.

#### `lookup <freetext>`

General search across the vault.

```bash
obsidian vault=$VAULT_NAME search format=json query="<freetext>" matches limit=10
```
Fallback: Search file contents for the query across all `.md` files in `$VAULT`.

If the query looks like a tag (starts with `#` or `project/`):
```bash
obsidian vault=$VAULT_NAME tags name="<query>"
```

If the query matches a note name:
```bash
obsidian vault=$VAULT_NAME backlinks file="<query>"
```

**Present results**: Show matching notes with their frontmatter (first ~10 lines) so the user can decide which to read in full.

### `relate` — Manage Relationships

Create and query bidirectional relationships between notes via frontmatter properties.

**Usage**: `relate <subcommand> [args]`

#### Supported relationship types

| Forward property | Inverse property |
|---|---|
| `depends-on` | `depended-on-by` |
| `extends` | `extended-by` |
| `implements` | `implemented-by` |
| `consumes` | `consumed-by` |

#### `relate <source> <target> [type]`

Create a bidirectional relationship between two notes. Default type is `depends-on`/`depended-on-by`.

##### Steps:

1. **Resolve note names**: Use `file=` parameter for note display names. If ambiguity is possible (same name, different folders), use `path=` with full vault-relative path.

2. **Read current property on source** (forward direction):
   ```bash
   obsidian vault=$VAULT_NAME property:read file="<source>" name="<forward-property>"
   ```
   Fallback: Read the source note frontmatter.

3. **Check if relationship already exists**: If `<target>` (as a wikilink) is already in the list, skip and report "already related".

4. **Append to source** (forward direction):
   Build the new list locally by appending `[[<target>]]` to the current values, then set:
   ```bash
   obsidian vault=$VAULT_NAME property:set file="<source>" name="<forward-property>" value="<full-list>" type="list"
   ```
   Fallback: Edit the source note's frontmatter directly.

5. **Read current property on target** (inverse direction):
   ```bash
   obsidian vault=$VAULT_NAME property:read file="<target>" name="<inverse-property>"
   ```

6. **Append to target** (inverse direction):
   ```bash
   obsidian vault=$VAULT_NAME property:set file="<target>" name="<inverse-property>" value="<full-list>" type="list"
   ```

7. **Report** the created relationship.

**Safety**: Always read-then-set. Never blind-append. The full list is constructed locally and set atomically.

#### `relate show <name>`

Display all relationships for a note.

##### Steps:

1. **Query all 8 relationship properties**:
   ```bash
   obsidian vault=$VAULT_NAME property:read file="<name>" name="depends-on"
   obsidian vault=$VAULT_NAME property:read file="<name>" name="depended-on-by"
   obsidian vault=$VAULT_NAME property:read file="<name>" name="extends"
   obsidian vault=$VAULT_NAME property:read file="<name>" name="extended-by"
   obsidian vault=$VAULT_NAME property:read file="<name>" name="implements"
   obsidian vault=$VAULT_NAME property:read file="<name>" name="implemented-by"
   obsidian vault=$VAULT_NAME property:read file="<name>" name="consumes"
   obsidian vault=$VAULT_NAME property:read file="<name>" name="consumed-by"
   ```
   Fallback: Read the note frontmatter and parse all relationship properties.

2. **Query structural links**:
   ```bash
   obsidian vault=$VAULT_NAME links file="<name>"
   obsidian vault=$VAULT_NAME backlinks file="<name>"
   ```

3. **Present results** grouped by relationship type. Show explicit (property) relationships first, then structural (wikilink) relationships that aren't already covered.

#### `relate tree <name> [depth]`

Walk the dependency tree via BFS. Default depth is 2.

##### Steps:

1. **Initialize BFS**: Start with `<name>` at depth 0. Maintain a visited set and a queue.

2. **For each node in the queue**:
   ```bash
   obsidian vault=$VAULT_NAME property:read file="<current>" name="depends-on"
   ```
   Fallback: Read the note and parse `depends-on` from frontmatter.

3. **Add unvisited dependencies** to the queue at `current_depth + 1`. Stop when `depth` limit is reached.

4. **Present** the tree as an indented list showing the dependency chain.

## Token Budget Rules

1. **CLI over reads**: Use `obsidian` CLI for property reads, backlinks, links, tags, and search — these return targeted data without full file reads
2. **Session start**: At most 2 operations (TODOs + project overview)
3. **During work**: Use `lookup` subcommands and `relate show` before reading full notes
4. **Frontmatter first**: When scanning, read ~10 lines before committing to full read
5. **List before read**: List directory contents before reading files
6. **Write concisely**: Bullet points, links, tags — no prose when bullets suffice

## Error Handling

- If the vault doesn't exist → suggest running `/obs init` to bootstrap it
- If the project doesn't exist in the vault → offer to run `/obs project` to scaffold it
- If a note already exists → show it instead of overwriting, offer to edit
- If no git repo is detected → use current directory name as project name
- If CLI command fails → fall back to file read for the same data

## Vault Structure Reference
```
$VAULT/
├── Home.md                           # Dashboard (read only if lost)
├── projects/{name}/
│   ├── {name}.md                     # Project overview — START HERE
│   ├── architecture/                 # ADRs (accepted design decisions)
│   ├── components/                   # Per-component notes
│   ├── specs/                        # Stable design docs — the WHAT
│   ├── plans/                        # Initiative-scoped impl plans — the HOW
│   └── patterns/                     # Project-specific patterns
├── domains/{tech}/                   # Cross-project knowledge
├── patterns/                         # Universal patterns
├── sessions/                         # Session logs (read only when needed)
├── todos/Active TODOs.md             # Pending work (read at session start)
├── templates/                        # Note templates
└── inbox/                            # Unsorted
```

## Specs vs Plans — Mental Model

Inspired by the bear-plan pi extension, plans are first-class branch-scoped artifacts:

| | Spec | Plan | ADR |
|---|---|---|---|
| **Answers** | What & why | How, right now | Which choice & why |
| **Lifetime** | Long-lived | Branch lifetime | Forever (immutable once accepted) |
| **Scope** | Feature/capability | `(project, initiative)` — usually a branch | One decision |
| **Mutability** | Evolves slowly | Refined every turn | Frozen post-acceptance |
| **Folder** | `specs/` | `plans/` | `architecture/` |
| **Trigger to write** | New capability proposed | New branch / new feature work begins | Significant tradeoff resolved |

A typical flow: a **spec** is drafted → a **plan** is created on a feature branch implementing it → the plan is refined turn by turn → ADRs spawn from notable decisions → on merge, the plan is marked completed and the spec moves to `status: implemented`.
