/**
 * pi-obs-ambient — Milestone B (lookup-first, three-tier)
 *
 * Before every assistant turn, three tiers of lookup run in order and the
 * union (deduped, budgeted) is injected as a single <vault-context> block:
 *
 *   Tier 1 — Trigger phrases: notes self-declare `triggers: [phrase, …]` in
 *            frontmatter; an in-memory inverted index built at session_start
 *            matches the prompt against the phrase set. Highest precision.
 *
 *   Tier 2 — Entity extraction: PascalCase / kebab-case / file paths, then
 *            obsidian search for each. Catches technical-token prompts that
 *            trigger phrases don't cover.
 *
 *   Tier 3 — Project fallback: if Tiers 1+2 found nothing AND `cwd` resolves
 *            to a known project note (via the project index), inject the
 *            project overview. Guarantees non-empty injection for general
 *            questions about the active project.
 *
 * The status-line distinguishes which tiers contributed.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { renderContext } from "./lib/budget.js";
import { extractEntities } from "./lib/entity-extract.js";
import {
	buildVaultIndex,
	matchTriggers,
	resolveProjectForCwd,
	type VaultIndex,
} from "./lib/vault-index.js";
import { VaultClient } from "./lib/vault-client.js";

interface Config {
	vaultName: string;
	tokenBudget: number;
	minTokenLength: number;
	maxEntities: number;
	hitsPerEntity: number;
	projectRoots: string[];
}

const DEFAULTS: Config = {
	vaultName: "agent-memory",
	tokenBudget: 500,
	minTokenLength: 4,
	maxEntities: 12,
	hitsPerEntity: 3,
	projectRoots: [join(homedir(), "dev")],
};

function loadConfig(): Config {
	const path = join(
		homedir(),
		".pi",
		"agent",
		"extensions",
		"pi-obs-ambient",
		"config.json",
	);
	try {
		const raw = readFileSync(path, "utf-8");
		return { ...DEFAULTS, ...JSON.parse(raw) };
	} catch {
		return DEFAULTS;
	}
}

export default function (pi: ExtensionAPI) {
	const cfg = loadConfig();
	const vault = new VaultClient(cfg.vaultName);

	// Built once per session_start; reused for every before_agent_start.
	let index: VaultIndex | undefined;
	let vaultRoot: string | undefined;

	let lookupsThisTurn = 0;
	let writesThisTurn = 0;

	// ---- session_start: resolve vault path, build indices --------------
	pi.on("session_start", async (_event, ctx) => {
		const theme = ctx.ui.theme;
		vaultRoot = await vault.vaultPath();
		if (!vaultRoot) {
			ctx.ui.setStatus(
				"obs-memory",
				theme.fg("error", "⬢ vault unavailable"),
			);
			return;
		}
		try {
			index = buildVaultIndex(vaultRoot);
		} catch {
			index = undefined;
		}
		const noteCount = index?.noteCount ?? (await vault.noteCount());
		const triggerCount = index?.triggers.size ?? 0;
		const projectCount = index?.projects.size ?? 0;
		ctx.ui.setStatus(
			"obs-memory",
			theme.fg(
				"dim",
				`⬢ vault: ${cfg.vaultName} (${noteCount ?? "?"} notes, ` +
					`${triggerCount} triggers, ${projectCount} projects)`,
			),
		);
	});

	// ---- before_agent_start: three-tier lookup -------------------------
	pi.on("before_agent_start", async (event, ctx) => {
		const theme = ctx.ui.theme;
		const prompt = event.prompt ?? "";
		if (!prompt.trim()) return;

		ctx.ui.setStatus("obs-memory", theme.fg("accent", "⬢ looking up…"));

		const seen = new Set<string>();
		const orderedPaths: string[] = [];
		const tierCounts = { trigger: 0, entity: 0, project: 0 };

		const add = (paths: string[], tier: keyof typeof tierCounts) => {
			for (const p of paths) {
				if (!seen.has(p)) {
					seen.add(p);
					orderedPaths.push(p);
					tierCounts[tier]++;
				}
			}
		};

		// --- Tier 1: trigger phrases ---
		if (index) add(matchTriggers(prompt, index), "trigger");

		// --- Tier 2: entity extraction ---
		const entities = extractEntities(prompt, {
			projectRoots: cfg.projectRoots,
			minTokenLength: cfg.minTokenLength,
			maxEntities: cfg.maxEntities,
		});
		lookupsThisTurn += entities.length;
		for (const e of entities) {
			const hits = await vault.search(e, cfg.hitsPerEntity);
			add(hits, "entity");
		}

		// --- Tier 3: project fallback ---
		if (orderedPaths.length === 0 && index) {
			const proj = resolveProjectForCwd(ctx.cwd, index);
			if (proj) add([proj], "project");
		}

		if (orderedPaths.length === 0) {
			ctx.ui.setStatus(
				"obs-memory",
				theme.fg(
					"dim",
					entities.length > 0
						? `⬢ no vault matches (${entities.length} entities)`
						: "⬢ no vault matches",
				),
			);
			return;
		}

		const hits = await vault.hydrate(orderedPaths);
		const rendered = renderContext(hits, cfg.tokenBudget);
		if (!rendered) {
			ctx.ui.setStatus("obs-memory", theme.fg("dim", "⬢ no vault matches"));
			return;
		}

		// Status: show tier composition so it's obvious which fired
		const parts: string[] = [];
		if (tierCounts.trigger) parts.push(`triggers:${tierCounts.trigger}`);
		if (tierCounts.entity) parts.push(`entities:${tierCounts.entity}`);
		if (tierCounts.project) parts.push(`project:${tierCounts.project}`);
		ctx.ui.setStatus(
			"obs-memory",
			theme.fg(
				"success",
				`⬢ injected ${rendered.hitsIncluded} (${parts.join(" + ")}, ~${rendered.estimatedTokens} tok)` +
					(rendered.hitsOverflow > 0 ? `, +${rendered.hitsOverflow} omitted` : ""),
			),
		);

		return {
			systemPrompt: event.systemPrompt + "\n\n" + rendered.text,
		};
	});

	pi.on("turn_end", async (_event, ctx) => {
		const theme = ctx.ui.theme;
		if (lookupsThisTurn === 0 && writesThisTurn === 0) {
			ctx.ui.setStatus("obs-memory", theme.fg("dim", "⬢ idle"));
		}
		lookupsThisTurn = 0;
		writesThisTurn = 0;
	});
}
