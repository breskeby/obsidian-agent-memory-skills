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
 * procedure exactly as Claude Code does. Subsequent turns use progressive
 * disclosure normally (no extra token cost).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";

export default function (pi: ExtensionAPI) {
	// Tracks whether we've already injected the skill for the current session.
	// Reset on every session_start so /new, /resume, and /fork all get a fresh
	// orientation on their first turn.
	let orientationDone = false;

	pi.on("session_start", () => {
		orientationDone = false;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		// Already oriented this session — leave the system prompt alone.
		if (orientationDone) return;
		orientationDone = true;

		// Skip if this is a resumed or continued session (assistant has already
		// responded before). Only true new-session first turns need orientation.
		const isNewSession = !ctx.sessionManager
			.getBranch()
			.some(
				(e: any) =>
					e.type === "message" && e.message?.role === "assistant",
			);

		if (!isNewSession) return;

		// Find the obs-memory skill from those already loaded into this session.
		// Using the skill registry avoids hardcoding install paths and works
		// whether the package was installed via `pi install`, symlinked locally,
		// or discovered from ~/.pi/agent/skills/.
		const obsSkill = event.systemPromptOptions?.skills?.find(
			(s) => s.name === "obs-memory",
		);

		if (!obsSkill?.filePath) {
			// Skill not loaded (user disabled it, vault not set up yet, etc.)
			// Degrade gracefully — don't block the turn.
			return;
		}

		let skillContent: string;
		try {
			skillContent = readFileSync(obsSkill.filePath, "utf-8");
		} catch {
			// File unreadable — degrade gracefully.
			return;
		}

		// Inject the full skill into the system prompt for this first turn.
		// The skill's own "Session Start — Orientation" section then fires
		// automatically, exactly as it does under Claude Code's plugin system.
		return {
			systemPrompt: event.systemPrompt + "\n\n" + skillContent,
		};
	});
}
