/**
 * Extract candidate entities from a user prompt for vault lookup.
 *
 * Heuristics (intentionally conservative — false-positive lookups are cheap,
 * but false-negative is what we're optimizing for, and over-extracting
 * blows the token budget):
 *
 *   - **File paths**: absolute paths under known project roots, or relative
 *     paths with a recognisable extension (.java, .gradle, .kts, .ts, .md, …).
 *   - **PascalCase identifiers**: ≥2 capital letters, length ≥ minTokenLength.
 *     Common English ("This", "The") filtered out.
 *   - **kebab-case build component names**: dash-separated lowercase with at
 *     least one dash, length ≥ minTokenLength. Catches `build-tools-internal`,
 *     `test-clusters`, etc., which our seed notes use as aliases.
 *
 * The output is deduped and capped.
 */

export interface ExtractOptions {
	projectRoots: string[];
	minTokenLength: number;
	maxEntities: number;
}

const COMMON_WORDS = new Set([
	"This",
	"That",
	"The",
	"There",
	"These",
	"Those",
	"When",
	"Where",
	"What",
	"Which",
	"How",
	"Why",
	"You",
	"Your",
	"They",
	"Then",
	"With",
	"From",
	"Into",
]);

export function extractEntities(
	prompt: string,
	opts: ExtractOptions,
): string[] {
	const out = new Set<string>();

	// 1) File paths — absolute under any project root, or relative with extension
	const pathRe =
		/(?:\/[\w./-]+|[\w./-]+\.(?:java|gradle|kts|groovy|ts|tsx|js|py|md|yml|yaml|asciidoc|properties|toml|xml))/g;
	for (const m of prompt.matchAll(pathRe)) {
		const p = m[0];
		if (p.startsWith("/")) {
			if (opts.projectRoots.some((r) => p.startsWith(r))) out.add(p);
		} else {
			out.add(p);
		}
	}

	// 2) PascalCase identifiers — emit both the literal form AND a space-split
	//    form, because Obsidian search is literal and most note titles are
	//    spaced ("Task Avoidance API" not "TaskAvoidanceAPI").
	const pascalRe = /\b[A-Z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]*)+\b/g;
	for (const m of prompt.matchAll(pascalRe)) {
		const t = m[0];
		if (t.length < opts.minTokenLength) continue;
		if (COMMON_WORDS.has(t)) continue;
		out.add(t);
		const spaced = t
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
		if (spaced !== t) out.add(spaced);
	}

	// 3) kebab-case build component names
	const kebabRe = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+){1,}\b/g;
	for (const m of prompt.matchAll(kebabRe)) {
		const t = m[0];
		if (t.length < opts.minTokenLength) continue;
		out.add(t);
	}

	return [...out].slice(0, opts.maxEntities);
}
