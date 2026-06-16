---
tags: [meta/index, sessions]
created: 2026-06-16
generated: true
source: sessions/*.md
---

# Session Log

Generated from session notes in `sessions/`. Source of truth is the individual `type: session` notes, not this index.

## Live View (Dataview)

> Requires the Obsidian Dataview plugin. If unavailable, use the static table below or run `/obs sync sessions` to rebuild it.

```dataview
TABLE WITHOUT ID
  created AS Date,
  choice(projects, projects[0]) AS Project,
  branch AS Branch,
  link(file.path, default(summary, file.name)) AS Summary
FROM "sessions"
WHERE type = "session" AND file.name != "Session Log"
SORT created DESC, file.name DESC
```

## Static Fallback

| Date | Project | Branch | Summary |
|---|---|---|---|
