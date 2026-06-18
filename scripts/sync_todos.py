#!/usr/bin/env python3
"""Archive completed `[x]` TODO items from Active TODOs to Completed TODOs Archive.

Deterministic, idempotent counterpart to the LLM-driven recap step. Safe to run
repeatedly. Designed so the pi extension can invoke it on every recap without
the agent having to manage the move by hand.

Rules:
    * Scans `todos/Active TODOs.md` for lines matching `[xX]` checklist items.
    * Groups them by the nearest preceding H2 heading (treated as project name).
      If no H2 precedes, group is `Uncategorized`.
    * Removes them from Active TODOs.
    * Appends them to `todos/Completed TODOs Archive.md` under a per-project,
      per-day H2 heading (`## {project} ({YYYY-MM-DD})`). Creates the archive
      file with a sane frontmatter stub if missing.
    * Empty lines and removed items collapse cleanly — no trailing whitespace runs.
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path
from typing import Iterable

ACTIVE_NAME = "Active TODOs.md"
ARCHIVE_NAME = "Completed TODOs Archive.md"

CHECKED_RE = re.compile(r"^\s*-\s*\[[xX]\]\s+(.*)$")
H2_RE = re.compile(r"^##\s+(.*?)\s*$")

ARCHIVE_STUB = """---
tags: [meta/archive, todo]
created: {date}
description: Archived completed TODOs — pruned from Active TODOs to keep context window lean
---

# Completed TODOs Archive
"""


def split_completed(active_text: str) -> tuple[str, dict[str, list[str]]]:
    """Return (cleaned active text, {project: [item, item, ...]})."""
    lines = active_text.splitlines()
    out_lines: list[str] = []
    completed: dict[str, list[str]] = {}
    current_group = "Uncategorized"

    for line in lines:
        h2 = H2_RE.match(line)
        if h2:
            current_group = h2.group(1).strip() or "Uncategorized"
            out_lines.append(line)
            continue
        checked = CHECKED_RE.match(line)
        if checked:
            completed.setdefault(current_group, []).append(checked.group(1).rstrip())
            continue
        out_lines.append(line)

    # Collapse runs of >2 blank lines that the removal may have created.
    cleaned: list[str] = []
    blanks = 0
    for line in out_lines:
        if line.strip() == "":
            blanks += 1
            if blanks <= 2:
                cleaned.append(line)
        else:
            blanks = 0
            cleaned.append(line)
    # Strip trailing blank lines, then add exactly one.
    while cleaned and cleaned[-1].strip() == "":
        cleaned.pop()
    cleaned.append("")
    return "\n".join(cleaned), completed


def render_archive_addition(completed: dict[str, list[str]], today: str) -> str:
    """Render an appendable block grouping completed items by project."""
    if not completed:
        return ""
    parts: list[str] = []
    for project in sorted(completed):
        items = completed[project]
        if not items:
            continue
        parts.append("")
        parts.append(f"## {project} ({today})")
        parts.append("")
        parts.extend(f"- [x] {item}" for item in items)
    parts.append("")
    return "\n".join(parts)


def ensure_archive(archive_path: Path, today: str) -> None:
    if archive_path.exists():
        return
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_text(ARCHIVE_STUB.format(date=today), encoding="utf-8")


def sync_todos(vault: Path, today: str | None = None) -> dict[str, int]:
    today = today or dt.date.today().isoformat()
    todos_dir = vault / "todos"
    active = todos_dir / ACTIVE_NAME
    archive = todos_dir / ARCHIVE_NAME

    if not active.exists():
        return {"archived": 0, "groups": 0}

    text = active.read_text(encoding="utf-8")
    new_active, completed = split_completed(text)

    archived_count = sum(len(v) for v in completed.values())
    if archived_count == 0:
        return {"archived": 0, "groups": 0}

    ensure_archive(archive, today)
    addition = render_archive_addition(completed, today)
    with archive.open("a", encoding="utf-8") as f:
        f.write(addition)

    active.write_text(new_active, encoding="utf-8")
    return {"archived": archived_count, "groups": len([g for g in completed.values() if g])}


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Archive [x] TODOs from Active TODOs to Completed TODOs Archive."
    )
    parser.add_argument("vault", help="Path to the Obsidian vault")
    parser.add_argument("target", nargs="?", default="todos", choices=["todos"])
    parser.add_argument("--date", help="Override today's date (YYYY-MM-DD); used for testing")
    args = parser.parse_args(list(argv) if argv is not None else None)

    vault = Path(args.vault).expanduser().resolve()
    if not vault.exists():
        parser.error(f"Vault does not exist: {vault}")
    if not (vault / "Home.md").exists():
        parser.error(f"Not an Obsidian agent-memory vault (missing Home.md): {vault}")

    result = sync_todos(vault, today=args.date)
    if result["archived"] == 0:
        print("No completed TODOs to archive.")
    else:
        print(
            f"Archived {result['archived']} completed TODO(s) across "
            f"{result['groups']} project group(s)."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
