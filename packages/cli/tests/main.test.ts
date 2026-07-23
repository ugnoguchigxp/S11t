import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CommandIo } from "../src/main.js";

const temporaryDirectories: string[] = [];

function temporaryFixture(name: string): string {
	const directory = mkdtempSync(join(tmpdir(), "s11t-cli-"));
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
	it("lints valid sources and emits machine-readable invalid diagnostics", () => {
		const valid = execute(["lint"], temporaryFixture("valid/simple"));
		expect(valid).toEqual(expect.objectContaining({ code: 0, stderr: "" }));
		const invalid = execute(
			["lint", "--format", "json"],
			temporaryFixture("invalid/unsafe-untrusted-raw"),
		);
		expect(invalid.code).toBe(1);
		expect(JSON.parse(invalid.stderr)[0]).toEqual(
			expect.objectContaining({ code: "S11T_UNSAFE_UNTRUSTED_RAW" }),
		);
	});

	it("builds, checks and inspects compiled segments", () => {
		const directory = temporaryFixture("valid/sectioned");
		expect(execute(["build"], directory).code).toBe(0);
		expect(execute(["build", "--check"], directory).code).toBe(0);
		const inspected = execute(
			["inspect", "codingAgent:identity", "--locale", "en-US", "--format", "json"],
			directory,
		);
		expect(inspected.code).toBe(0);
		expect(JSON.parse(inspected.stdout)).toEqual(
			expect.objectContaining({
				id: "codingAgent:identity",
				locale: "en-US",
				sections: expect.arrayContaining([
					expect.objectContaining({ id: "task.goal-context", segments: expect.any(Array) }),
				]),
			}),
		);
	});

	it("formats resolved v2 inspection for humans and JSON consumers", () => {
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
		expect(human.stdout).toContain("\trequiredLocales: release_profiles.production\n");

		const json = execute([...base, "--format", "json"], directory);
		expect(json).toMatchObject({ code: 0, stderr: "" });
		expect(JSON.parse(json.stdout)).toEqual(
			expect.objectContaining({
				key: "structuredGeneration.repair",
				releaseProfile: "production",
				origins: expect.objectContaining({
					requiredLocales: "release_profiles.production",
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

	it("returns and restores a durable migration operation through the CLI", () => {
		const directory = temporaryFixture("valid/simple");
		const written = execute(
			["migrate", "authoring-v2", "--write", "--format", "json"],
			directory,
		);
		expect(written).toMatchObject({ code: 0, stderr: "" });
		const operationId = JSON.parse(written.stdout).operationId as string;
		expect(operationId).toMatch(/^authoring-v2-[0-9a-f]{24}$/);

		const listed = execute(
			["migrate", "authoring-v2", "--list", "--format", "json"],
			directory,
		);
		expect(listed).toMatchObject({ code: 0, stderr: "" });
		expect(JSON.parse(listed.stdout).operations).toEqual([
			expect.objectContaining({ operationId, state: "committed" }),
		]);

		const restored = execute(
			["migrate", "authoring-v2", "--restore", operationId, "--format", "json"],
			directory,
		);
		expect(restored).toMatchObject({ code: 0, stderr: "" });
		expect(JSON.parse(restored.stdout)).toEqual(
			expect.objectContaining({ restored: true, operationId }),
		);

		const purged = execute(
			["migrate", "authoring-v2", "--purge", operationId, "--format", "json"],
			directory,
		);
		expect(purged).toMatchObject({ code: 0, stderr: "" });
		expect(JSON.parse(purged.stdout)).toEqual(
			expect.objectContaining({
				purged: true,
				operation: expect.objectContaining({ operationId, state: "rolled-back" }),
			}),
		);
	});

	it("uses documented misuse and internal exit codes", () => {
		const directory = temporaryFixture("valid/simple");
		expect(execute(["unknown"], directory).code).toBe(2);
		expect(execute(["inspect"], directory).code).toBe(2);
		expect(execute(["lint", "--release-profile", "development"], directory).code).toBe(2);
		expect(
			execute(
				[
					"migrate",
					"authoring-v2",
					"--write",
					"--restore",
					"authoring-v2-000000000000000000000000",
				],
				directory,
			).code,
		).toBe(2);

		const v2 = temporaryFixture("valid/content-first");
		const missingProfile = execute(["lint"], v2);
		expect(missingProfile.code).toBe(2);
		expect(missingProfile.stderr).toContain("config v2 requires --release-profile");
	});
});
