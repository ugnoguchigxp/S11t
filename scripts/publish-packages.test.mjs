import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repositoryRoot, "scripts/publish-packages.mjs");
const packageVersion = JSON.parse(
	readFileSync(resolve(repositoryRoot, "packages/runtime/package.json"), "utf8"),
).version;

function execute(arguments_) {
	return spawnSync(process.execPath, [scriptPath, ...arguments_], {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
}

describe("package publishing", () => {
	it("prints a package.json-backed plan without contacting npm", () => {
		const result = execute(["--plan"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain(`version: ${packageVersion} (from package.json)`);
		expect(result.stdout).toContain(`1. s11tnext@${packageVersion}`);
		expect(result.stdout).toContain(`2. s11tnext-cli@${packageVersion}`);
		expect(result.stdout).toContain("npm publish --dry-run");
	});

	it("requires a terminal or explicit confirmation before preflight", () => {
		const result = execute([]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Interactive confirmation requires a terminal");
	});

	it("rejects ambiguous execution modes", () => {
		const result = execute(["--plan", "--yes"]);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("[--plan | --yes]");
	});
});
