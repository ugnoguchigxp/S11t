import {
	cpSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadProject } from "../src/discover.js";
import { S11tDiagnosticError } from "../src/diagnostics.js";

const temporaryDirectories: string[] = [];

function temporaryFixture(name: string): string {
	const directory = mkdtempSync(join(tmpdir(), "s11t-discover-"));
	temporaryDirectories.push(directory);
	cpSync(new URL(`../../../fixtures/${name}`, import.meta.url), directory, { recursive: true });
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("source discovery", () => {
	it("discovers nested files in stable POSIX order", () => {
		const directory = temporaryFixture("valid/multilingual");
		const source = readFileSync(join(directory, "contexts/greeting.context.toml"), "utf8");
		mkdirSync(join(directory, "contexts/a"));
		writeFileSync(
			join(directory, "contexts/a/second.context.toml"),
			source.replace('id = "example:greeting"', 'id = "example:second"'),
		);
		const project = loadProject(undefined, directory);
		expect(project.sourceFiles).toEqual([
			"contexts/a/second.context.toml",
			"contexts/greeting.context.toml",
		]);
	});

	it("adds TOML line and column to syntax diagnostics", () => {
		const directory = temporaryFixture("valid/simple");
		writeFileSync(join(directory, "contexts/repair.context.toml"), "schema_version = [");
		try {
			loadProject(undefined, directory);
		} catch (error) {
			expect(error).toBeInstanceOf(S11tDiagnosticError);
			const diagnostic = (error as S11tDiagnosticError).diagnostics[0];
			expect(diagnostic).toEqual(
				expect.objectContaining({ code: "S11T_TOML_SYNTAX", line: 1, column: 19 }),
			);
			return;
		}
		throw new Error("Expected syntax diagnostic");
	});

	it("rejects a source_dir that is a file", () => {
		const directory = temporaryFixture("valid/simple");
		writeFileSync(join(directory, "not-a-directory"), "text");
		const configPath = join(directory, "s11t.config.toml");
		writeFileSync(
			configPath,
			readFileSync(configPath, "utf8").replace('source_dir = "contexts"', 'source_dir = "not-a-directory"'),
		);
		expect(() => loadProject(undefined, directory)).toThrowError(
			expect.objectContaining<S11tDiagnosticError>({
				diagnostics: [expect.objectContaining({ code: "S11T_CONFIG_INVALID" })],
			}),
		);
	});

	it.skipIf(process.platform === "win32")("rejects source_dir symlinks outside the project", () => {
		const directory = temporaryFixture("valid/simple");
		const outside = temporaryFixture("valid/simple");
		symlinkSync(join(outside, "contexts"), join(directory, "linked-contexts"), "dir");
		const configPath = join(directory, "s11t.config.toml");
		writeFileSync(
			configPath,
			readFileSync(configPath, "utf8").replace('source_dir = "contexts"', 'source_dir = "linked-contexts"'),
		);
		expect(() => loadProject(undefined, directory)).toThrowError(
			expect.objectContaining<S11tDiagnosticError>({
				diagnostics: [expect.objectContaining({ code: "S11T_CONFIG_INVALID" })],
			}),
		);
	});
});
