#!/usr/bin/env node
/**
 * replay-session.mjs <session-json-or-html>
 *
 * Re-runs the pi-obs-ambient pipeline against an exported pi session and
 * reports what would have been injected and how each tier contributed.
 *
 * Pure analysis: does not touch the vault, does not modify the session,
 * does not call out to obsidian CLI (except a single search-per-entity for
 * the Tier 2 path, which is read-only). Use it to:
 *
 *   - Verify a fix changes injection on a previously-failing session.
 *   - Build regression fixtures from real sessions.
 *   - Tune token-budget and entity heuristics without dogfooding.
 *
 * Usage:
 *   node tools/replay-session.mjs ~/path/to/pi-session-*.html
 *   node tools/replay-session.mjs ~/path/to/pi-session-*.json
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = resolve(__dirname, "..");

// Dynamic imports keep this script runnable with `node` (no build step)
const { buildVaultIndex, matchTriggers, resolveProjectForCwd } = await import(
	join(EXT_ROOT, "lib/vault-index.ts")
);
const { extractEntities } = await import(join(EXT_ROOT, "lib/entity-extract.ts"));
const { renderContext } = await import(join(EXT_ROOT, "lib/budget.ts"));

// ─── load session ────────────────────────────────────────────────────────

function loadSession(file) {
	const raw = readFileSync(file, "utf-8");
	if (file.endsWith(".json")) return JSON.parse(raw);

	// HTML export: find the base64 JSON script blob
	const matches = raw.matchAll(/<script[^>]*>([^<]+)<\/script>/g);
	for (const m of matches) {
		const body = m[1].trim();
		if (body.length < 5000) continue;
		if (!/^[A-Za-z0-9+/=]+$/.test(body.slice(0, 200))) continue;
		try {
			const decoded = Buffer.from(body, "base64").toString("utf-8");
			const parsed = JSON.parse(decoded);
			if (parsed.entries && parsed.systemPrompt !== undefined) return parsed;
		} catch {
			continue;
		}
	}
	throw new Error("could not locate session JSON in HTML export");
}

function firstUserPrompt(session) {
	for (const e of session.entries) {
		if (e.type === "message" && e.message?.role === "user") {
			const c = e.message.content;
			if (typeof c === "string") return c;
			if (Array.isArray(c)) {
				for (const blk of c) if (blk?.type === "text") return blk.text;
			}
		}
	}
	return "";
}

function injectedContextInSession(systemPrompt) {
	const m = systemPrompt.match(/<vault-context\b[\s\S]*?<\/vault-context>/);
	return m ? m[0] : undefined;
}

// ─── obsidian search shim (Tier 2) ───────────────────────────────────────

function obsidianSearch(vaultName, query, limit) {
	try {
		const stdout = execFileSync(
			"obsidian",
			[`vault=${vaultName}`, "search", `query=${query}`, "format=json", `limit=${limit}`],
			{ encoding: "utf-8", timeout: 5000 },
		);
		const arr = JSON.parse(stdout.trim() || "[]");
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
}

function obsidianVaultPath(vaultName) {
	try {
		return execFileSync(
			"obsidian",
			[`vault=${vaultName}`, "vault", "info=path"],
			{ encoding: "utf-8", timeout: 5000 },
		).trim();
	} catch {
		return undefined;
	}
}

function obsidianReadProp(vaultName, path, name) {
	try {
		return execFileSync(
			"obsidian",
			[`vault=${vaultName}`, "property:read", `name=${name}`, `path=${path}`],
			{ encoding: "utf-8", timeout: 5000 },
		).trim();
	} catch {
		return undefined;
	}
}

// ─── main ────────────────────────────────────────────────────────────────

const file = process.argv[2];
if (!file) {
	console.error("usage: replay-session.mjs <session.html|.json>");
	process.exit(2);
}

const cfg = {
	vaultName: "agent-memory",
	tokenBudget: 500,
	minTokenLength: 4,
	maxEntities: 12,
	hitsPerEntity: 3,
	projectRoots: [join(process.env.HOME, "dev")],
};

const session = loadSession(file);
const prompt = firstUserPrompt(session);
const cwd = session.header?.cwd ?? "(unknown)";
const wasInjected = injectedContextInSession(session.systemPrompt ?? "");

const vaultRoot = obsidianVaultPath(cfg.vaultName);
if (!vaultRoot) {
	console.error("ERROR: vault not reachable via obsidian CLI");
	process.exit(1);
}
const index = buildVaultIndex(vaultRoot);

// Tier 1 — triggers
const t1 = matchTriggers(prompt, index);

// Tier 2 — entities
const entities = extractEntities(prompt, {
	projectRoots: cfg.projectRoots,
	minTokenLength: cfg.minTokenLength,
	maxEntities: cfg.maxEntities,
});
const t2set = new Set();
for (const e of entities) {
	for (const p of obsidianSearch(cfg.vaultName, e, cfg.hitsPerEntity)) t2set.add(p);
}
const t2 = [...t2set].filter((p) => !t1.includes(p));

// Tier 3 — project fallback
let t3 = [];
if (t1.length === 0 && t2.length === 0) {
	const proj = resolveProjectForCwd(cwd, index);
	if (proj) t3 = [proj];
}

const orderedPaths = [...t1, ...t2, ...t3];
const hits = orderedPaths.map((path) => ({
	path,
	title: path.split("/").pop().replace(/\.md$/, ""),
	type: obsidianReadProp(cfg.vaultName, path, "type") || undefined,
	summary: obsidianReadProp(cfg.vaultName, path, "summary") || undefined,
}));
const rendered = renderContext(hits, cfg.tokenBudget);

// ─── report ──────────────────────────────────────────────────────────────

console.log("=".repeat(72));
console.log("Session:", file);
console.log("cwd:    ", cwd);
console.log("prompt: ", prompt);
console.log("=".repeat(72));
console.log();
console.log("Vault stats:");
console.log(`  ${index.noteCount} notes, ${index.triggers.size} triggers, ${index.projects.size} projects`);
console.log();
console.log("Original session injection:");
console.log(`  ${wasInjected ? "<vault-context> present (" + wasInjected.length + " chars)" : "NONE — agent had no vault context"}`);
console.log();
console.log(`Tier 1 (triggers): ${t1.length} hit(s)`);
for (const p of t1) console.log("  -", p);
console.log();
console.log(`Tier 2 (entities → search): ${entities.length} entit(y/ies), ${t2.length} new hit(s)`);
console.log("  entities extracted:", entities.length ? entities.join(", ") : "(none)");
for (const p of t2) console.log("  -", p);
console.log();
console.log(`Tier 3 (project fallback): ${t3.length} hit(s)`);
for (const p of t3) console.log("  -", p);
console.log();
console.log("Replay outcome:");
if (!rendered) {
	console.log("  no injection would have been produced");
} else {
	console.log(`  ${rendered.hitsIncluded} note(s) included, ~${rendered.estimatedTokens} tok, +${rendered.hitsOverflow} omitted`);
	console.log();
	console.log("─── Injected block ───");
	console.log(rendered.text);
}
