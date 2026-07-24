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
import { S11tnextDiagnosticError } from "../src/diagnostics.js";

const temporaryDirectories: string[] = [];

function temporaryFixture(name: string): string {
	const directory = mkdtempSync(join(tmpdir(), "s11tnext-discover-"));
	temporaryDirectories.push(directory);
	cpSync(new URL(`../../../fixtures/${name}`, import.meta.url), directory, { recursive: true });
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("source discovery", () => {
	it("discovers nested files in stable POSIX order", () => {
		const directory = temporaryFixture("valid/content-first");
		const source = readFileSync(
			join(directory, "contexts/structuredGeneration/repair.context.toml"),
			"utf8",
		);
		mkdirSync(join(directory, "contexts/structuredGeneration/a"));
		writeFileSync(
			join(directory, "contexts/structuredGeneration/a/second.context.toml"),
			source,
		);
		const project = loadProject(undefined, directory, "production");
		expect(project.sourceFiles).toEqual([
			"contexts/structuredGeneration/a/second.context.toml",
			"contexts/structuredGeneration/repair.context.toml",
		]);
	});

	it("adds TOML line and column to syntax diagnostics", () => {
		const directory = temporaryFixture("valid/content-first");
		writeFileSync(
			join(directory, "contexts/structuredGeneration/repair.context.toml"),
			"text = [",
		);
		try {
			loadProject(undefined, directory, "production");
		} catch (error) {
			expect(error).toBeInstanceOf(S11tnextDiagnosticError);
			const diagnostic = (error as S11tnextDiagnosticError).diagnostics[0];
			expect(diagnostic).toEqual(
				expect.objectContaining({ code: "S11TNEXT_TOML_SYNTAX", line: 1, column: 9 }),
			);
			return;
		}
		throw new Error("Expected syntax diagnostic");
	});

	it("rejects a source_dir that is a file", () => {
		const directory = temporaryFixture("valid/content-first");
		writeFileSync(join(directory, "not-a-directory"), "text");
		const configPath = join(directory, "s11tnext.config.toml");
		writeFileSync(
			configPath,
			readFileSync(configPath, "utf8").replace('source_dir = "contexts"', 'source_dir = "not-a-directory"'),
		);
		expect(() => loadProject(undefined, directory, "production")).toThrowError(
			expect.objectContaining<S11tnextDiagnosticError>({
				diagnostics: [expect.objectContaining({ code: "S11TNEXT_CONFIG_INVALID" })],
			}),
		);
	});

	it.skipIf(process.platform === "win32")("rejects source_dir symlinks outside the project", () => {
		const directory = temporaryFixture("valid/content-first");
		const outside = temporaryFixture("valid/content-first");
		symlinkSync(join(outside, "contexts"), join(directory, "linked-contexts"), "dir");
		const configPath = join(directory, "s11tnext.config.toml");
		writeFileSync(
			configPath,
			readFileSync(configPath, "utf8").replace('source_dir = "contexts"', 'source_dir = "linked-contexts"'),
		);
		expect(() => loadProject(undefined, directory, "production")).toThrowError(
			expect.objectContaining<S11tnextDiagnosticError>({
				diagnostics: [expect.objectContaining({ code: "S11TNEXT_CONFIG_INVALID" })],
			}),
		);
	});
});
