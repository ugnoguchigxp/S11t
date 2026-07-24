import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repositoryRoot, "scripts/dispatch-release.mjs");
const packageVersion = JSON.parse(
	readFileSync(resolve(repositoryRoot, "packages/runtime/package.json"), "utf8"),
).version;

function execute(arguments_) {
	return spawnSync(process.execPath, [scriptPath, ...arguments_], {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
}

describe("release dispatch", () => {
	it("builds a package.json-backed stable workflow plan without dispatching", () => {
		const result = execute(["stable", "--dry-run"]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual(
			expect.objectContaining({
				channel: "stable",
				version: packageVersion,
				packages: ["s11tnext", "s11tnext-cli"],
				repository: "ugnoguchigxp/s11tnext",
				confirmation: "publish-stable",
				command: expect.arrayContaining([
					"gh",
					"workflow",
					"run",
					"release.yml",
					"channel=stable",
				]),
			}),
		);
	});

	it("rejects unknown channels before dispatching", () => {
		const result = execute(["preview", "--dry-run"]);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("bootstrap|canary|stable");
	});
});
