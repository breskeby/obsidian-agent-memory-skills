#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


SESSION_LOG_NAME = "Session Log.md"
DATAVIEW_BLOCK = """```dataview
TABLE WITHOUT ID
  created AS Date,
  choice(projects, projects[0]) AS Project,
  branch AS Branch,
  link(file.path, default(summary, file.name)) AS Summary
FROM \"sessions\"
WHERE type = \"session\" AND file.name != \"Session Log\"
SORT created DESC, file.name DESC
```"""


@dataclass
class SessionNote:
    path: Path
    created: str
    project: str
    branch: str
    summary: str
    title: str


FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?", re.S)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    raw = m.group(1)
    body = text[m.end():]
    data: dict[str, str] = {}
    current_key: Optional[str] = None
    current_list: list[str] = []

    def flush_list() -> None:
        nonlocal current_key, current_list
        if current_key is not None:
            data[current_key] = "\n".join(current_list)
        current_key = None
        current_list = []

    for line in raw.splitlines():
        if re.match(r"^[A-Za-z0-9_-]+:\s*$", line):
            flush_list()
            current_key = line[:-1]
        elif current_key is not None and re.match(r"^\s*-\s*", line):
            current_list.append(re.sub(r"^\s*-\s*", "", line).strip())
        elif ":" in line and not line.startswith(" "):
            flush_list()
            key, value = line.split(":", 1)
            data[key.strip()] = value.strip()
        elif current_key is not None:
            current_list.append(line.strip())
    flush_list()
    return data, body


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'")):
        return value[1:-1]
    return value


def first_heading(body: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def derive_summary(frontmatter: dict[str, str], body: str, stem: str) -> str:
    summary = unquote(frontmatter.get("summary", "")).strip()
    if summary:
        return summary
    heading = first_heading(body)
    if heading:
        return heading
    return stem


def first_project(frontmatter: dict[str, str]) -> str:
    raw = frontmatter.get("projects", "").strip()
    if raw:
        first = raw.splitlines()[0].strip()
        return unquote(first)
    return unquote(frontmatter.get("project", "")).strip()


def escape_cell(text: str) -> str:
    return text.replace("|", r"\|")


def sort_key(note: SessionNote):
    return (note.created, note.path.stem)


def backfill_summary(path: Path, text: str, frontmatter: dict[str, str], body: str, summary: str) -> None:
    """Persist a derived summary back into the session note's frontmatter.

    No-op if `summary:` already has a non-empty value. This is what keeps the
    Dataview block useful in Obsidian: the LLM often forgets to fill `summary`
    when writing the recap, so we infer it from the first heading and write it
    back so future runs (and the user) see a stable label.
    """
    existing = unquote(frontmatter.get("summary", "")).strip()
    if existing or not summary:
        return
    fm_match = FRONTMATTER_RE.match(text)
    if not fm_match:
        return
    fm_raw = fm_match.group(1)
    # Replace empty `summary:` line if present; otherwise inject before closing `---`.
    safe = summary.replace('"', '\\"')
    new_line = f'summary: "{safe}"'
    if re.search(r"^summary:\s*$", fm_raw, re.M):
        new_fm = re.sub(r"^summary:\s*$", new_line, fm_raw, count=1, flags=re.M)
    elif re.search(r"^summary:", fm_raw, re.M):
        # Has a value already (e.g. summary: "") — leave alone to avoid clobbering
        return
    else:
        new_fm = fm_raw.rstrip() + "\n" + new_line
    new_text = f"---\n{new_fm}\n---\n" + body
    path.write_text(new_text, encoding="utf-8")


def scan_sessions(vault: Path, backfill: bool = True) -> list[SessionNote]:
    sessions_dir = vault / "sessions"
    notes: list[SessionNote] = []
    for path in sorted(sessions_dir.glob("*.md")):
        if path.name == SESSION_LOG_NAME:
            continue
        text = path.read_text(encoding="utf-8")
        frontmatter, body = parse_frontmatter(text)
        summary = derive_summary(frontmatter, body, path.stem)
        if backfill:
            backfill_summary(path, text, frontmatter, body, summary)
        notes.append(
            SessionNote(
                path=path,
                created=unquote(frontmatter.get("created", "")).strip(),
                project=first_project(frontmatter),
                branch=unquote(frontmatter.get("branch", "")).strip(),
                summary=summary,
                title=path.stem,
            )
        )
    notes.sort(key=sort_key, reverse=True)
    return notes


def render_session_log(notes: list[SessionNote]) -> str:
    today = dt.date.today().isoformat()
    lines = [
        "---",
        "tags: [meta/index, sessions]",
        f"created: {today}",
        "generated: true",
        "source: sessions/*.md",
        "---",
        "",
        "# Session Log",
        "",
        "Generated from session notes in `sessions/`. Source of truth is the individual `type: session` notes, not this index.",
        "",
        "## Live View (Dataview)",
        "",
        "> Requires the Obsidian Dataview plugin. If unavailable, use the static table below or run `/obs sync sessions` to rebuild it.",
        "",
        DATAVIEW_BLOCK,
        "",
        "## Static Fallback",
        "",
        "| Date | Project | Branch | Summary |",
        "|---|---|---|---|",
    ]
    for note in notes:
        project = escape_cell(note.project)
        branch = escape_cell(note.branch)
        summary = escape_cell(note.summary)
        link = f"[[sessions/{note.title}|{summary}]]"
        lines.append(f"| {note.created} | {project} | `{branch}` | {link} |")
    lines.append("")
    return "\n".join(lines)


def sync_sessions(vault: Path, backfill: bool = True) -> Path:
    sessions_dir = vault / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    notes = scan_sessions(vault, backfill=backfill)
    output = render_session_log(notes)
    target = sessions_dir / SESSION_LOG_NAME
    target.write_text(output, encoding="utf-8")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild Obsidian session indexes from session note files.")
    parser.add_argument("vault", help="Path to the Obsidian vault")
    parser.add_argument("target", nargs="?", default="sessions", choices=["sessions"], help="Derived index to rebuild")
    args = parser.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    if not vault.exists():
        parser.error(f"Vault does not exist: {vault}")
    if not (vault / "Home.md").exists():
        parser.error(f"Not an Obsidian agent-memory vault (missing Home.md): {vault}")

    target = sync_sessions(vault, backfill=True)
    print(f"Rebuilt {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
