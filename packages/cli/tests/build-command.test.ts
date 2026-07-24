import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCatalog } from "s11tnext";
import { afterEach, describe, expect, it } from "vitest";

import { buildProject } from "../src/build-command.js";
import { S11tnextDiagnosticError } from "../src/diagnostics.js";
import { inspectContext } from "../src/inspect-command.js";

const temporaryDirectories: string[] = [];

function temporaryFixture(name = "valid/content-first"): string {
	const directory = mkdtempSync(join(tmpdir(), "s11tnext-build-"));
	temporaryDirectories.push(directory);
	cpSync(new URL(`../../../fixtures/${name}`, import.meta.url), directory, { recursive: true });
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("build command", () => {
	it("emits deterministic artifact and type bytes and passes --check", () => {
		const directory = temporaryFixture();
		const first = buildProject({ cwd: directory, releaseProfile: "production" });
		const firstJson = readFileSync(first.catalogPath, "utf8");
		const firstTypes = readFileSync(first.typesPath, "utf8");
		const second = buildProject({ cwd: directory, releaseProfile: "production" });
		expect(readFileSync(second.catalogPath, "utf8")).toBe(firstJson);
		expect(readFileSync(second.typesPath, "utf8")).toBe(firstTypes);
		expect(buildProject({ cwd: directory, releaseProfile: "production", check: true }).checked).toBe(true);
		expect(() => createCatalog(JSON.parse(firstJson))).not.toThrow();
		expect(firstJson).not.toContain(directory);
		expect(firstTypes).toContain("export type SystemContextKey =");
		expect(firstTypes).toContain('"outputRequirements": string;');
	});

	it("applies configured TypeScript indentation through the build command", () => {
		const directory = temporaryFixture();
		const configPath = join(directory, "s11tnext.config.toml");
		writeFileSync(
			configPath,
			`${readFileSync(configPath, "utf8")}\n[generation]\ntypescript_indent = 2\n`,
		);

		const result = buildProject({ cwd: directory, releaseProfile: "production" });
		const generated = readFileSync(result.typesPath, "utf8");
		expect(generated).toContain('\n    "outputRequirements": string;');
		expect(generated).toContain("\n  PromptKey,");
		expect(generated).not.toContain("\t");
		expect(
			buildProject({
				cwd: directory,
				releaseProfile: "production",
				check: true,
			}).checked,
		).toBe(true);
	});

	it("detects stale output without rewriting it", () => {
		const directory = temporaryFixture();
		const result = buildProject({ cwd: directory, releaseProfile: "production" });
		const before = readFileSync(result.catalogPath, "utf8");
		const sourcePath = join(directory, "contexts/structuredGeneration/repair.context.toml");
		writeFileSync(sourcePath, readFileSync(sourcePath, "utf8").replace("Repair", "Fix"));
		expect(() => buildProject({ cwd: directory, releaseProfile: "production", check: true })).toThrowError(
			expect.objectContaining<S11tnextDiagnosticError>({
				diagnostics: [expect.objectContaining({ code: "S11TNEXT_BUILD_STALE" })],
			}),
		);
		expect(readFileSync(result.catalogPath, "utf8")).toBe(before);
	});

	it("builds the current artifact contract", () => {
		const directory = temporaryFixture("valid/content-first");
		const result = buildProject({
			cwd: directory,
			releaseProfile: "production",
		});
		const artifact = JSON.parse(readFileSync(result.catalogPath, "utf8")) as {
			format: string;
		};
		expect(artifact).toMatchObject({
			format: "s11tnext.catalog",
		});
		expect(readFileSync(result.typesPath, "utf8")).toContain(
			'import { createCatalog } from "s11tnext";',
		);
		expect(() => createCatalog(artifact)).not.toThrow();
		expect(
			inspectContext("structuredGeneration.repair", {
				cwd: directory,
				releaseProfile: "production",
				locale: "en-US",
			}),
		).toEqual(
			expect.objectContaining({
				key: "structuredGeneration.repair",
				locale: "en-US",
			}),
		);
	});

	it("preserves previous successful outputs when validation fails", () => {
		const directory = temporaryFixture();
		const result = buildProject({ cwd: directory, releaseProfile: "production" });
		const beforeJson = readFileSync(result.catalogPath, "utf8");
		const beforeTypes = readFileSync(result.typesPath, "utf8");
		writeFileSync(join(directory, "contexts/broken.context.toml"), "text = [");
		expect(() => buildProject({ cwd: directory, releaseProfile: "production" })).toThrow(S11tnextDiagnosticError);
		expect(readFileSync(result.catalogPath, "utf8")).toBe(beforeJson);
		expect(readFileSync(result.typesPath, "utf8")).toBe(beforeTypes);
	});

	it.skipIf(process.platform === "win32")("rejects out_dir symlinks outside the project", () => {
		const directory = temporaryFixture("valid/content-first");
		const outside = mkdtempSync(join(tmpdir(), "s11tnext-build-outside-"));
		temporaryDirectories.push(outside);
		symlinkSync(outside, join(directory, "linked-output"), "dir");
		const configPath = join(directory, "s11tnext.config.toml");
		writeFileSync(
			configPath,
			readFileSync(configPath, "utf8").replace('out_dir = ".s11tnext"', 'out_dir = "linked-output"'),
		);
		expect(() => buildProject({ cwd: directory, releaseProfile: "production" })).toThrowError(
			expect.objectContaining<S11tnextDiagnosticError>({
				diagnostics: [expect.objectContaining({ code: "S11TNEXT_CONFIG_INVALID" })],
			}),
		);
		expect(() => readFileSync(join(outside, "catalog.json"), "utf8")).toThrow();
	});
});
