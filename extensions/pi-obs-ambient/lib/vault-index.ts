/**
 * In-memory indices over the vault, built once per session_start.
 *
 * Two indices, two lookup tiers:
 *
 *   1. Trigger index (Tier 1) — notes declare `triggers: [phrase, …]` in
 *      frontmatter. We invert that into `Map<phrase → notePaths[]>`. At
 *      lookup time we match the user prompt against the phrase set with a
 *      simple case-insensitive substring test — high precision, ~free.
 *
 *   2. Project index (Tier 3 fallback) — every note with `type: project`
 *      and a `path:` property contributes a `Map<repoPath → projectNotePath>`
 *      entry. When entity extraction + triggers find nothing, we fall back
 *      to injecting the project overview for the current cwd. Guarantees
 *      that "general question about the active project" never produces an
 *      empty injection.
 *
 * Both indices are built by scanning frontmatter only (~10 lines per file),
 * not full bodies. With a 122-note vault this takes <20ms on cold disk.
 *
 * Pure file IO — no obsidian CLI dependency — so this works during
 * session_start before any other lookup logic runs.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface VaultIndex {
	/** Map of lowercased trigger phrase → vault-relative note paths. */
	triggers: Map<string, string[]>;
	/** Map of absolute repo path → vault-relative project note path. */
	projects: Map<string, string>;
	/** Total notes scanned (for status-line reporting). */
	noteCount: number;
}

export function buildVaultIndex(vaultRoot: string): VaultIndex {
	const triggers = new Map<string, string[]>();
	const projects = new Map<string, string>();
	let noteCount = 0;

	for (const file of walkMarkdown(vaultRoot)) {
		noteCount++;
		const rel = file.slice(vaultRoot.length + 1);
		const fm = readFrontmatter(file);
		if (!fm) continue;

		// Trigger index
		for (const phrase of fm.triggers ?? []) {
			const key = phrase.toLowerCase().trim();
			if (!key) continue;
			const bucket = triggers.get(key);
			if (bucket) bucket.push(rel);
			else triggers.set(key, [rel]);
		}

		// Project index
		if (fm.type === "project" && fm.path) {
			projects.set(fm.path, rel);
		}
	}

	return { triggers, projects, noteCount };
}

/**
 * Match prompt against trigger phrases. Returns vault-relative paths of
 * notes whose phrase appears in the (lowercased) prompt as a substring
 * surrounded by word boundaries.
 *
 * Substring + word boundary keeps things deterministic and avoids tokenisation
 * dependencies. A phrase "gradle build" matches "the gradle build is great"
 * but not "gradle builds".
 */
export function matchTriggers(
	prompt: string,
	index: VaultIndex,
): string[] {
	const haystack = " " + prompt.toLowerCase().replace(/[^\w\s-]/g, " ") + " ";
	const seen = new Set<string>();
	const out: string[] = [];
	for (const [phrase, paths] of index.triggers) {
		const needle = " " + phrase + " ";
		if (haystack.includes(needle)) {
			for (const p of paths) {
				if (!seen.has(p)) {
					seen.add(p);
					out.push(p);
				}
			}
		}
	}
	return out;
}

/**
 * Resolve cwd to its project note, if any. Walks up the directory tree
 * because `cwd` may be a subdirectory of the project (e.g. inside
 * `elasticsearch/server/src/main`).
 */
export function resolveProjectForCwd(
	cwd: string,
	index: VaultIndex,
): string | undefined {
	let p = cwd;
	while (p && p !== "/" && p.length > 1) {
		const hit = index.projects.get(p);
		if (hit) return hit;
		const next = p.slice(0, p.lastIndexOf("/"));
		if (next === p) break;
		p = next;
	}
	return undefined;
}

// ─── internals ────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([".obsidian", ".git", "node_modules", "attachments"]);

function* walkMarkdown(dir: string): Generator<string> {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		if (e.name.startsWith(".") && e.name !== ".obsidian") {
			// allow hidden files generally but skip dotfiles we don't care about
		}
		if (IGNORE_DIRS.has(e.name)) continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) {
			yield* walkMarkdown(full);
		} else if (e.isFile() && e.name.endsWith(".md")) {
			yield full;
		}
	}
}

interface Frontmatter {
	type?: string;
	path?: string;
	triggers?: string[];
}

/**
 * Read just the YAML frontmatter from a markdown file. Minimal parser —
 * only handles the fields we care about (`type:`, `path:`, `triggers:`).
 * Tolerates list-style and inline-array-style YAML.
 */
function readFrontmatter(file: string): Frontmatter | undefined {
	let head: string;
	try {
		const fd = readFileSync(file, "utf-8");
		// Read at most the first 80 lines — frontmatter is always at the top
		const nl = nthIndexOf(fd, "\n", 80);
		head = nl === -1 ? fd : fd.slice(0, nl);
	} catch {
		return undefined;
	}

	if (!head.startsWith("---")) return undefined;
	const end = head.indexOf("\n---", 3);
	if (end === -1) return undefined;
	const yaml = head.slice(3, end);

	const out: Frontmatter = {};
	const lines = yaml.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		const typeMatch = line.match(/^type:\s*(.+?)\s*$/);
		if (typeMatch) out.type = stripQuotes(typeMatch[1]);

		const pathMatch = line.match(/^path:\s*(.+?)\s*$/);
		if (pathMatch) out.path = stripQuotes(pathMatch[1]);

		// triggers: [a, b, c]  OR  triggers:\n  - a\n  - b
		const trigInline = line.match(/^triggers:\s*\[(.+)\]\s*$/);
		if (trigInline) {
			out.triggers = trigInline[1]
				.split(",")
				.map((s) => stripQuotes(s.trim()))
				.filter(Boolean);
			continue;
		}
		if (/^triggers:\s*$/.test(line)) {
			const items: string[] = [];
			for (let j = i + 1; j < lines.length; j++) {
				const m = lines[j].match(/^\s*-\s*(.+?)\s*$/);
				if (!m) break;
				items.push(stripQuotes(m[1]));
			}
			out.triggers = items;
		}
	}
	return out;
}

function stripQuotes(s: string): string {
	if (
		(s.startsWith('"') && s.endsWith('"')) ||
		(s.startsWith("'") && s.endsWith("'"))
	) {
		return s.slice(1, -1);
	}
	return s;
}

function nthIndexOf(s: string, needle: string, n: number): number {
	let idx = -1;
	for (let i = 0; i < n; i++) {
		idx = s.indexOf(needle, idx + 1);
		if (idx === -1) return -1;
	}
	return idx;
}
