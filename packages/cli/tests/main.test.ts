import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CommandIo } from "../src/main.js";

const runtimePackage = JSON.parse(
	readFileSync(new URL("../../runtime/package.json", import.meta.url), "utf8"),
) as { version?: unknown };
if (typeof runtimePackage.version !== "string") {
	throw new TypeError("Runtime package version is missing");
}
const expectedVersionOutput = `${runtimePackage.version}\n`;
const temporaryDirectories: string[] = [];

function temporaryFixture(name: string): string {
	const directory = mkdtempSync(join(tmpdir(), "s11tnext-cli-"));
	temporaryDirectories.push(directory);
	cpSync(new URL(`../../../fixtures/${name}`, import.meta.url), directory, { recursive: true });
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function execute(arguments_: string[], cwd: string) {
	let stdout = "";
	let stderr = "";
	const io: CommandIo = {
		cwd,
		stdout: (value) => {
			stdout += value;
		},
		stderr: (value) => {
			stderr += value;
		},
	};
	return { code: runCli(arguments_, io), stdout, stderr };
}

describe("CLI", () => {
	it("prints version, command help, and shell completion", () => {
		const directory = temporaryFixture("valid/content-first");
		expect(execute(["--version"], directory)).toEqual({
			code: 0,
			stdout: expectedVersionOutput,
			stderr: "",
		});
		expect(execute(["version"], directory)).toEqual({
			code: 0,
			stdout: expectedVersionOutput,
			stderr: "",
		});
		expect(execute(["-V"], directory).stdout).toBe(expectedVersionOutput);
		expect(execute(["version", "extra"], directory).code).toBe(2);
		expect(execute(["help"], directory).stdout).toContain(
			"LLM prompt-message authoring",
		);
		expect(execute(["help", "unknown"], directory).code).toBe(2);
		expect(execute(["help", "build", "extra"], directory).code).toBe(2);
		expect(execute(["unknown", "--help"], directory).code).toBe(2);
		const buildHelp = execute(["build", "--help"], directory);
		expect(buildHelp).toMatchObject({ code: 0, stderr: "" });
		expect(buildHelp.stdout).toContain("Usage: s11tnext build");
		expect(buildHelp.stdout).toContain("--check");
		expect(execute(["help", "inspect"], directory).stdout).toContain(
			"s11tnext inspect --coverage",
		);
		for (const shell of ["bash", "zsh", "fish"]) {
			const completion = execute(["completion", shell], directory);
			expect(completion).toMatchObject({ code: 0, stderr: "" });
			expect(completion.stdout).toContain("s11tnext");
		}
		expect(execute(["completion", "powershell"], directory).code).toBe(2);
	});

	it("lints valid sources and emits machine-readable invalid diagnostics", () => {
		const validDirectory = temporaryFixture("valid/content-first");
		const valid = execute(["lint", "--release-profile", "production"], validDirectory);
		expect(valid).toEqual(expect.objectContaining({ code: 0, stderr: "" }));
		const sourcePath = join(
			validDirectory,
			"contexts/structuredGeneration/repair.context.toml",
		);
		writeFileSync(
			sourcePath,
			readFileSync(sourcePath, "utf8")
				.replace("profile = \"trusted.block\"", "type = \"string\"\ntrust = \"untrusted\"\nplacement = \"inline\"\nencoding = \"raw\""),
		);
		const invalid = execute(
			["lint", "--release-profile", "production", "--format", "json"],
			validDirectory,
		);
		expect(invalid.code).toBe(1);
		expect(JSON.parse(invalid.stderr)[0]).toEqual(
			expect.objectContaining({ code: "S11TNEXT_UNSAFE_UNTRUSTED_RAW" }),
		);
	});

	it("builds, checks and inspects compiled segments", () => {
		const directory = temporaryFixture("valid/content-first");
		expect(execute(["build", "--release-profile", "production"], directory).code).toBe(0);
		expect(execute(["build", "--release-profile", "production", "--check"], directory).code).toBe(0);
		const inspected = execute(
			[
				"inspect",
				"structuredGeneration.repair",
				"--locale",
				"en-US",
				"--release-profile",
				"production",
				"--format",
				"json",
			],
			directory,
		);
		expect(inspected.code).toBe(0);
		expect(JSON.parse(inspected.stdout)).toEqual(
			expect.objectContaining({
				key: "structuredGeneration.repair",
				locale: "en-US",
				sections: expect.arrayContaining([
					expect.objectContaining({ id: "context.text", segments: expect.any(Array) }),
				]),
			}),
		);
	});

	it("formats resolved inspection for humans and JSON consumers", () => {
		const directory = temporaryFixture("valid/content-first");
		const base = [
			"inspect",
			"structuredGeneration.repair",
			"--resolved",
			"--release-profile",
			"production",
		];
		const human = execute(base, directory);
		expect(human).toMatchObject({ code: 0, stderr: "" });
		expect(human.stdout).toContain("key: structuredGeneration.repair\n");
		expect(human.stdout).toContain("origins:\n");
		expect(human.stdout).toContain(
			"\trequiredLocales: release_profiles.production.required_locales\n",
		);

		const json = execute([...base, "--format", "json"], directory);
		expect(json).toMatchObject({ code: 0, stderr: "" });
		expect(JSON.parse(json.stdout)).toEqual(
			expect.objectContaining({
				key: "structuredGeneration.repair",
				releaseProfile: "production",
				origins: expect.objectContaining({
					requiredLocales: "release_profiles.production.required_locales",
				}),
			}),
		);
	});

	it("emits machine-readable catalog locale coverage", () => {
		const directory = temporaryFixture("valid/locale-rollout");
		const result = execute(
			[
				"inspect",
				"--coverage",
				"--locale",
				"en-US",
				"--fallback-locale",
				"fr-FR",
				"--release-profile",
				"development",
				"--format",
				"json",
			],
			directory,
		);
		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(JSON.parse(result.stdout)).toEqual(
			expect.objectContaining({
				requiredCoverageSatisfied: true,
				totals: { contexts: 3, direct: 1, fallback: 1, missing: 1 },
			}),
		);
	});

	it("uses documented misuse and internal exit codes", () => {
		const directory = temporaryFixture("valid/content-first");
		expect(execute(["unknown"], directory).code).toBe(2);
		expect(execute(["inspect"], directory).code).toBe(2);
		expect(
			execute(
				[
					"inspect",
					"structuredGeneration.repair",
					"--fallback-locale",
					"en-US",
					"--release-profile",
					"development",
				],
				directory,
			).code,
		).toBe(2);
		expect(execute(["lint", "--release-profile", "development"], directory).code).toBe(0);
		const missingProfile = execute(["lint"], directory);
		expect(missingProfile.code).toBe(2);
		expect(missingProfile.stderr).toContain("--release-profile is required");
	});
});
