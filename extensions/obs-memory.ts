/**
 * obs-memory Pi Extension
 *
 * Provides proactive skill support for Pi — equivalent to what Claude Code
 * achieves via plugin.json always loading the skill into the system prompt —
 * plus deterministic post-recap hygiene so the session log and TODO archive
 * never drift from the source-of-truth notes.
 *
 * Lifecycle:
 *   - before_agent_start (new session): inject full SKILL.md so the agent
 *     follows the Session Start — Orientation procedure.
 *   - input: detect intent to recap (explicit `/obs recap`, plus heuristic
 *     "wrap up" / "write a session summary" phrasings).
 *   - agent_end: if recap was signalled OR a new session note file was created
 *     during the turn, run the deterministic Python helpers to (1) backfill
 *     summaries + rebuild `sessions/Session Log.md`, (2) archive completed
 *     `[x]` TODOs to `Completed TODOs Archive.md`.
 *
 * Why detect new session notes (not just `/obs recap`)?
 *   - Users say "wrap up" instead of `/obs recap`.
 *   - Other extensions / prompt templates may write the session note.
 *   - Agent forgets to call the sync helper (the original failure mode).
 *
 * Both helpers are idempotent — running them when nothing changed is safe.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const RECAP_PHRASES = [
	/\/obs\s+recap\b/i,
	/\bwrite\s+(?:a\s+)?(?:session\s+)?(?:summary|recap)\b/i,
	/\b(?:session\s+)?recap\b/i,
	/\bwrap(?:ping)?\s+up\b/i,
	/\bsession\s+summary\b/i,
];

function isNewSession(ctx: any): boolean {
	return !ctx.sessionManager
		.getBranch()
		.some(
			(e: any) => e.type === "message" && e.message?.role === "assistant",
		);
}

function expandHome(path: string): string {
	if (path.startsWith("~/")) {
		return resolve(process.env.HOME || "~", path.slice(2));
	}
	return path;
}

function extractVaultPathFromText(text: string): string | null {
	const sectionMatch = text.match(
		/^#{1,6}\s+Obsidian Knowledge Vault\s*$([\s\S]*?)(?=^#{1,6}\s+|\Z)/im,
	);
	if (!sectionMatch) return null;
	const section = sectionMatch[1];

	const backticked = section.match(/`((?:~|\/)[^`\n]+)`/);
	if (backticked?.[1]) return expandHome(backticked[1]);

	const plain = section.match(/(?:^|\s)((?:~|\/)[^\s)]+)(?:\s|$)/m);
	if (plain?.[1]) return expandHome(plain[1]);

	return null;
}

function resolveVaultPath(contextFiles?: Array<{ path?: string; content?: string }>): string {
	if (process.env.OBSIDIAN_VAULT_PATH) {
		return process.env.OBSIDIAN_VAULT_PATH;
	}

	for (const file of contextFiles || []) {
		const parsed = file.content ? extractVaultPathFromText(file.content) : null;
		if (parsed) return parsed;
	}

	return resolve(process.env.HOME || "~", "Documents", "AgentMemory");
}

function resolveSkillRoot(skillPath?: string): string | null {
	if (!skillPath) return null;
	return dirname(dirname(dirname(skillPath)));
}

interface SessionSnapshot {
	files: Map<string, number>; // filename -> mtime
}

function snapshotSessions(vault: string): SessionSnapshot {
	const dir = join(vault, "sessions");
	const files = new Map<string, number>();
	try {
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".md")) continue;
			if (name === "Session Log.md") continue;
			try {
				files.set(name, statSync(join(dir, name)).mtimeMs);
			} catch {
				// ignore individual stat errors
			}
		}
	} catch {
		// sessions dir may not exist yet
	}
	return { files };
}

function snapshotChanged(before: SessionSnapshot, after: SessionSnapshot): boolean {
	if (after.files.size !== before.files.size) return true;
	for (const [name, mtime] of after.files) {
		const prev = before.files.get(name);
		if (prev === undefined || prev !== mtime) return true;
	}
	return false;
}

async function runHelper(skillRoot: string, vault: string, target: "sessions" | "todos") {
	const scriptName = target === "sessions" ? "sync_sessions.py" : "sync_todos.py";
	const script = resolve(skillRoot, "scripts", scriptName);
	if (!existsSync(script)) {
		throw new Error(`${scriptName} not found at ${script}`);
	}
	const { stdout } = await execFileAsync("python3", [script, vault, target]);
	return stdout.trim();
}

export default function (pi: ExtensionAPI) {
	let orientationDone = false;
	let recapSignalled = false;
	let preRunSnapshot: SessionSnapshot | undefined;
	let obsSkillPath: string | undefined;
	let resolvedVaultPath: string | undefined;

	pi.on("session_start", () => {
		orientationDone = false;
		recapSignalled = false;
		preRunSnapshot = undefined;
	});

	function ensureVault(ctx: any): string {
		return (
			resolvedVaultPath ||
			resolveVaultPath(ctx?.getSystemPromptOptions?.().contextFiles)
		);
	}

	async function runRecapFinalize(ctx: any, reason: string) {
		const skillRoot = resolveSkillRoot(obsSkillPath);
		const vault = ensureVault(ctx);
		if (!skillRoot) {
			ctx.ui?.notify?.(
				"obs-memory: recap finished but skill root unknown; cannot run sync helpers",
				"error",
			);
			return;
		}

		const results: string[] = [];
		const errors: string[] = [];
		for (const target of ["sessions", "todos"] as const) {
			try {
				const out = await runHelper(skillRoot, vault, target);
				results.push(`${target}: ${out || "ok"}`);
			} catch (error: any) {
				errors.push(`${target}: ${error?.message || error}`);
			}
		}

		if (errors.length === 0) {
			ctx.ui?.notify?.(
				`obs-memory finalized recap (${reason}): ${results.join(" · ")}`,
				"info",
			);
		} else {
			ctx.ui?.notify?.(
				`obs-memory recap partial failure (${reason}): ${[...results, ...errors].join(" · ")}`,
				"error",
			);
		}
	}

	pi.registerCommand("obs-sync-sessions", {
		description: "Rebuild sessions/Session Log.md from session notes",
		handler: async (_args, ctx) => {
			const skillRoot = resolveSkillRoot(obsSkillPath);
			const vault = ensureVault(ctx);
			if (!skillRoot) {
				ctx.ui.notify("obs-memory skill path not available; cannot locate sync helper", "error");
				return;
			}
			try {
				const out = await runHelper(skillRoot, vault, "sessions");
				ctx.ui.notify(`Session log synced (${out || "ok"})`, "info");
			} catch (error: any) {
				ctx.ui.notify(`Session log sync failed: ${error?.message || error}`, "error");
			}
		},
	});

	pi.registerCommand("obs-finalize-recap", {
		description:
			"Run all post-recap hygiene (session log + completed TODO archival) explicitly",
		handler: async (_args, ctx) => {
			await runRecapFinalize(ctx, "manual");
		},
	});

	pi.on("input", async (event) => {
		const text = event.text.trim();
		if (RECAP_PHRASES.some((re) => re.test(text))) {
			recapSignalled = true;
		}
		return { action: "continue" as const };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const obsSkill = event.systemPromptOptions?.skills?.find(
			(s) => s.name === "obs-memory",
		);
		obsSkillPath = obsSkill?.filePath;
		resolvedVaultPath = resolveVaultPath(event.systemPromptOptions?.contextFiles);

		// Capture pre-run state so agent_end can detect newly-written session notes,
		// even if the recap was triggered without an explicit `/obs recap`.
		preRunSnapshot = snapshotSessions(resolvedVaultPath);

		if (orientationDone) return;
		orientationDone = true;

		if (!isNewSession(ctx)) return;
		if (!obsSkill?.filePath) return;

		let skillContent: string;
		try {
			skillContent = readFileSync(obsSkill.filePath, "utf-8");
		} catch {
			return;
		}

		return {
			systemPrompt: event.systemPrompt + "\n\n" + skillContent,
		};
	});

	pi.on("agent_end", async (_event, ctx) => {
		const vault = ensureVault(ctx);
		const after = snapshotSessions(vault);
		const sessionsChanged =
			preRunSnapshot !== undefined && snapshotChanged(preRunSnapshot, after);
		preRunSnapshot = after;

		if (!recapSignalled && !sessionsChanged) return;

		const reason = recapSignalled
			? sessionsChanged
				? "phrase + new note"
				: "phrase"
			: "new session note detected";
		recapSignalled = false;

		await runRecapFinalize(ctx, reason);
	});
}
