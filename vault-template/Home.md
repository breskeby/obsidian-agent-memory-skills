---
aliases: [MOC, Index, Dashboard]
tags: [meta/index]
created: {{date}}
---

# Agent Memory

Persistent knowledge graph for coding agent sessions.

## Navigation

### Active Work
- [[todos/Active TODOs]] — Current work items and blockers
- [[sessions/Session Log]] — Chronological session notes

### Projects
- [[projects/Projects]] — All projects by status

### Domains
- [[domains/Domains]] — Cross-cutting technical knowledge

### Patterns
- [[patterns/Universal Patterns]] — Language/framework-agnostic patterns

## Structure

```
projects/{name}/
  architecture/           → ADRs (accepted design decisions)
  components/             → Per-component notes
  specs/                  → Stable design docs — the WHAT (outlive branches)
  plans/                  → Initiative-scoped implementation plans — the HOW
  patterns/               → Project-specific patterns
domains/{tech}/           → Cross-project domain knowledge
patterns/                 → Universal patterns (SOLID, testing strategies, etc.)
sessions/                 → Chronological session logs (tagged by project)
todos/                    → Active work items (tagged by project)
```

### Specs vs Plans vs ADRs

- **Spec** — *What* and *why*. Stable, long-lived, branch-independent. One per feature/capability.
- **Plan** — *How*, right now, for this initiative (usually a branch). One per `(project, scope)`. Accumulates refinements; archived when shipped or abandoned.
- **ADR** — A single accepted decision with context, alternatives, and consequences. Immutable once accepted.

## Conventions

- **Project-scoped knowledge** lives under `projects/{name}/`
- **Domain knowledge** lives under `domains/{tech}/`
- **Universal patterns** live under `patterns/`
- **Wikilinks** for all cross-references: `[[note name]]`
- **Tags** include project scope: `#project/{short-name}`, `#domain/{tech}`
- **Frontmatter** on every note: `created`, `tags`, `project`
