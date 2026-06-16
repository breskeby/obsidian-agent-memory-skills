/**
 * obs-memory Pi Extension
 *
 * Provides proactive skill support for Pi — equivalent to what Claude Code
 * achieves via plugin.json always loading the skill into the system prompt.
 *
 * In Claude Code, the obs-memory skill is always present in the system prompt,
 * so the agent automatically follows the "Session Start — Orientation" procedure
 * on every new session without being asked. Pi's skill system uses progressive
 * disclosure instead (description always present, full content on-demand), so
 * the session-start orientation never fires automatically.
 *
 * This extension bridges that gap: on the first turn of each new session it
 * injects the full SKILL.md into the system prompt, triggering the orientation
 * procedure exactly as Claude Code does. It also provides concrete runtime
 * automation for session-log syncing after `/obs recap`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

async function runSessionSync(skillRoot: string, vault: string) {
	const script = resolve(skillRoot, "scripts", "sync_sessions.py");
	if (!existsSync(script)) {
		throw new Error(`sync helper not found: ${script}`);
	}
	await execFileAsync("python3", [script, vault, "sessions"]);
}

export default function (pi: ExtensionAPI) {
	let orientationDone = false;
	let pendingRecapSync = false;
	let obsSkillPath: string | undefined;
	let resolvedVaultPath: string | undefined;

	pi.on("session_start", () => {
		orientationDone = false;
		pendingRecapSync = false;
	});

	pi.registerCommand("obs-sync-sessions", {
		description: "Rebuild sessions/Session Log.md from session notes",
		handler: async (_args, ctx) => {
			const skillRoot = resolveSkillRoot(obsSkillPath);
			const vault = resolvedVaultPath ||
				resolveVaultPath(ctx.getSystemPromptOptions?.().contextFiles);
			if (!skillRoot) {
				ctx.ui.notify("obs-memory skill path not available; cannot locate sync helper", "error");
				return;
			}
			try {
				await runSessionSync(skillRoot, vault);
				ctx.ui.notify(`Session log synced: ${vault}/sessions/Session Log.md`, "info");
			} catch (error: any) {
				ctx.ui.notify(`Session log sync failed: ${error?.message || error}`, "error");
			}
		},
	});

	pi.on("input", async (event) => {
		const text = event.text.trim();
		if (text === "/obs recap" || text.startsWith("/obs recap ")) {
			pendingRecapSync = true;
		}
		return { action: "continue" as const };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const obsSkill = event.systemPromptOptions?.skills?.find(
			(s) => s.name === "obs-memory",
		);
		obsSkillPath = obsSkill?.filePath;
		resolvedVaultPath = resolveVaultPath(event.systemPromptOptions?.contextFiles);

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
		if (!pendingRecapSync) return;
		pendingRecapSync = false;

		const skillRoot = resolveSkillRoot(obsSkillPath);
		const vault = resolvedVaultPath || resolveVaultPath();
		if (!skillRoot) {
			ctx.ui.notify("obs-memory recap finished, but sync helper could not be located", "error");
			return;
		}

		try {
			await runSessionSync(skillRoot, vault);
			ctx.ui.notify(`Auto-synced session log after /obs recap`, "info");
		} catch (error: any) {
			ctx.ui.notify(`Auto-sync after /obs recap failed: ${error?.message || error}`, "error");
		}
	});
}
