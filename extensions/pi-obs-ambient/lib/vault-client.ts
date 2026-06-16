/**
 * Thin wrapper around the `obsidian` CLI used by both the pre-turn hook
 * and (eventually) the obs_note custom tool.
 *
 * Keeps subprocess invocation, JSON parsing, timeouts, and error handling
 * in one place so hook code stays declarative.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface SearchHit {
	path: string; // vault-relative path e.g. "projects/elasticsearch/patterns/Task Avoidance API.md"
	title: string; // basename without .md
	type?: string; // frontmatter `type` if cheap to read
	summary?: string; // frontmatter `summary` if present
}

export class VaultClient {
	constructor(
		private readonly vaultName: string,
		private readonly timeoutMs = 3000,
	) {}

	/** Resolve the absolute on-disk path of the vault root, or undefined if the CLI can't reach it. Doubles as a health check. */
	async vaultPath(): Promise<string | undefined> {
		try {
			const { stdout } = await this.run([
				"vault=" + this.vaultName,
				"vault",
				"info=path",
			]);
			const p = stdout.trim();
			return p.length > 0 ? p : undefined;
		} catch {
			return undefined;
		}
	}

	/** Approximate note count — used for the session_start status line. */
	async noteCount(): Promise<number | undefined> {
		try {
			const { stdout } = await this.run([
				"vault=" + this.vaultName,
				"vault",
				"info=files",
			]);
			const n = parseInt(stdout.trim(), 10);
			return Number.isFinite(n) ? n : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Search vault for `query`; returns up to `limit` hits as path strings.
	 * Uses JSON output so we get a stable array of vault-relative paths.
	 */
	async search(query: string, limit = 5): Promise<string[]> {
		if (!query.trim()) return [];
		try {
			const { stdout } = await this.run([
				"vault=" + this.vaultName,
				"search",
				`query=${query}`,
				"format=json",
				`limit=${limit}`,
			]);
			const parsed = JSON.parse(stdout.trim() || "[]");
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	/** Read a single frontmatter property; returns `undefined` if missing. */
	async readProperty(
		path: string,
		name: string,
	): Promise<string | undefined> {
		try {
			const { stdout } = await this.run([
				"vault=" + this.vaultName,
				"property:read",
				`name=${name}`,
				`path=${path}`,
			]);
			const v = stdout.trim();
			return v.length > 0 ? v : undefined;
		} catch {
			return undefined;
		}
	}

	/** Enrich a list of hit paths with title/type/summary. */
	async hydrate(paths: string[]): Promise<SearchHit[]> {
		return Promise.all(
			paths.map(async (p) => {
				const title = basename(p);
				const [type, summary] = await Promise.all([
					this.readProperty(p, "type"),
					this.readProperty(p, "summary"),
				]);
				return { path: p, title, type, summary };
			}),
		);
	}

	private async run(args: string[]) {
		return exec("obsidian", args, {
			timeout: this.timeoutMs,
			maxBuffer: 1024 * 1024,
		});
	}
}

function basename(p: string): string {
	const last = p.split("/").pop() ?? p;
	return last.replace(/\.md$/, "");
}
