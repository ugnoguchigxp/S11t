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
			["inspect", "codingAgent:identity", "--locale", "en-US"],
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

	it("uses documented misuse and internal exit codes", () => {
		const directory = temporaryFixture("valid/simple");
		expect(execute(["unknown"], directory).code).toBe(2);
		expect(execute(["inspect"], directory).code).toBe(2);
	});
});
