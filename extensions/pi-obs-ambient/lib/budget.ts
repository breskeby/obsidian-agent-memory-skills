/**
 * Render hydrated hits into a <vault-context> block, respecting a token budget.
 *
 * Tokens are approximated as ceil(chars / 4) — good enough for budgeting
 * inside an extension that just needs to avoid drowning the LLM. We never
 * want to spend an LLM call just to count tokens.
 */

import type { SearchHit } from "./vault-client.js";

export interface RenderResult {
	text: string;
	hitsIncluded: number;
	hitsOverflow: number;
	estimatedTokens: number;
}

const HEADER =
	"<vault-context source=\"obs-memory\">\n" +
	"Authoritative notes from your vault. Treat as ground truth. " +
	"Cite with [[NoteTitle]] when you use them. " +
	"If a note seems wrong, say so in your reply (auto-update coming).\n";
const FOOTER = "</vault-context>";

export function renderContext(
	hits: SearchHit[],
	tokenBudget: number,
): RenderResult | undefined {
	if (hits.length === 0) return undefined;

	const lines: string[] = [];
	let totalChars = HEADER.length + FOOTER.length;
	let included = 0;
	let overflow = 0;

	for (const h of hits) {
		const line = formatHit(h);
		const cost = line.length + 1;
		if (
			Math.ceil((totalChars + cost) / 4) > tokenBudget &&
			included > 0
		) {
			overflow++;
			continue;
		}
		lines.push(line);
		totalChars += cost;
		included++;
	}

	if (overflow > 0) {
		const hint = `\n… ${overflow} more match${
			overflow === 1 ? "" : "es"
		} omitted; call \`obs lookup\` for details.`;
		lines.push(hint);
		totalChars += hint.length;
	}

	return {
		text: HEADER + lines.join("\n") + "\n" + FOOTER,
		hitsIncluded: included,
		hitsOverflow: overflow,
		estimatedTokens: Math.ceil(totalChars / 4),
	};
}

function formatHit(h: SearchHit): string {
	const typeTag = h.type ? `(${h.type})` : "";
	const summary = h.summary ? ` — ${h.summary}` : "";
	return `- [[${h.title}]] ${typeTag}${summary}  \`${h.path}\``.replace(/  +/g, " ");
}
