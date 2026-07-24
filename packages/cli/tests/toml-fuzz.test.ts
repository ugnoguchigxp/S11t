import {
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { S11tnextDiagnosticError } from "../src/diagnostics.js";
import { loadToml } from "../src/toml-loader.js";

let directory: string;
let filePath: string;

beforeAll(() => {
	directory = mkdtempSync(join(tmpdir(), "s11tnext-toml-fuzz-"));
	filePath = join(directory, "input.toml");
});

afterAll(() => {
	rmSync(directory, { recursive: true, force: true });
});

const tomlText = fc
	.array(
		fc.constantFrom(
			"a",
			"Z",
			"0",
			" ",
			"\t",
			"\n",
			"\"",
			"\\",
			"日本語",
			"🙂",
			"\u2028",
			"\u2029",
		),
		{ maxLength: 80 },
	)
	.map((characters) => characters.join(""));

const malformedToml = fc.oneof(
	fc
		.array(fc.constantFrom("a", "Z", "0", " ", "_", "-"), { maxLength: 40 })
		.map((characters) => `value = "${characters.join("")}`),
	fc.constant("value = ["),
	fc.constant("[table\nvalue = 1"),
	fc.constant("value = { key = 1"),
);

describe("TOML fuzz properties", () => {
	it("round-trips arbitrary supported Unicode in basic strings", () => {
		fc.assert(
			fc.property(tomlText, (value) => {
				writeFileSync(filePath, `value = ${JSON.stringify(value)}\n`);
				expect(loadToml(filePath, "input.toml")).toEqual({ value });
			}),
			{ numRuns: 250 },
		);
	});

	it("normalizes malformed parser failures into stable diagnostics", () => {
		fc.assert(
			fc.property(malformedToml, (source) => {
				writeFileSync(filePath, source);
				expect(() => loadToml(filePath, "input.toml")).toThrowError(
					expect.objectContaining<S11tnextDiagnosticError>({
						diagnostics: [
							expect.objectContaining({
								code: "S11TNEXT_TOML_SYNTAX",
								file: "input.toml",
							}),
						],
					}),
				);
			}),
			{ numRuns: 250 },
		);
	});
});
