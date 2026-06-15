---
tags: [plans, project/{{short-name}}]
type: plan
project: "[[projects/{{project-name}}/{{project-name}}]]"
created: {{date}}
status: active
scope:               # branch name, initiative slug, or session id — whatever identifies this effort
spec:
related-components: []
---

# {{title}}

> _Plans are executable **implementation plans** — the **how**.
> **One plan per initiative — this file is updated in place, never copied.**
> Mutate `## Steps` as the work evolves; append dated notes to
> `## Refinement Log` for reasoning changes. Mark `status: completed`
> when the work ships, `abandoned` if dropped._

## Context

- **Scope:** `{{scope}}`  <!-- e.g. branch name, initiative slug -->
- **Spec:** [[...]]  <!-- link to the parent spec, if any -->
- **Goal:** one-sentence summary of what this plan delivers

## Steps

1. [ ] 
2. [ ] 
3. [ ] 

## Discoveries

Things learned while executing the plan that should feed back into specs,
component notes, or ADRs.

- 

## Decisions Made

Small in-flight design choices. Promote to an ADR if significant.

- 

## Refinement Log

<!-- Append a dated section every time the *reasoning* meaningfully changes.
     Step edits go in `## Steps` directly — don't duplicate them here.
     Never fork this file into a copy; always edit in place. -->

### {{date}} — initial

Initial plan captured.
