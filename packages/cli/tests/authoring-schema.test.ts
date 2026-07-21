import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

import {
	parseAuthoringDocument,
	validateAuthoringDocuments,
} from "../src/authoring-schema.js";
import { parseProjectConfig } from "../src/config.js";
import { S11tDiagnosticError } from "../src/diagnostics.js";

const fixturesRoot = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

function loadDocuments(kind: "valid" | "invalid", name: string) {
	const directory = `${fixturesRoot}${kind}/${name}/contexts`;
	return readdirSync(directory)
		.filter((file) => file.endsWith(".context.toml"))
		.sort()
		.map((file) => {
			const relativeFile = `fixtures/${kind}/${name}/contexts/${file}`;
			return parseAuthoringDocument(parse(readFileSync(`${directory}/${file}`, "utf8")), relativeFile);
		});
}

function diagnosticCode(action: () => unknown): string {
	try {
		action();
	} catch (error) {
		if (error instanceof S11tDiagnosticError) {
			return error.diagnostics[0]?.code ?? "";
		}
		throw error;
	}
	throw new Error("Expected a diagnostic");
}

describe("authoring schema", () => {
	it.each(["simple", "sectioned", "multilingual"])(
		"canonicalizes the valid %s fixture",
		(name) => {
			const documents = loadDocuments("valid", name);
			expect(() => validateAuthoringDocuments(documents)).not.toThrow();
			expect(documents).toHaveLength(1);
			expect(documents[0]?.definition.output).toBe("text");
		},
	);

	it("normalizes simple context and CRLF text", () => {
		const document = parseAuthoringDocument(
			{
				schema_version: 1,
				context: {
					id: "test:newlines",
					version: "1.0.0",
					owner: "test",
					source_locale: "en-US",
					required_locales: ["en-US"],
					output: "text",
				},
				locales: { "en-US": { text: "first\r\nsecond\rthird" } },
			},
			"newlines.context.toml",
		);

		expect(document.definition.sections).toEqual([
			{
				id: "context.text",
				kind: "instruction",
				severity: "must",
				enforcement: "prompt",
				optimizable: false,
				locales: { "en-US": "first\nsecond\nthird" },
			},
		]);
	});

	it("parses the project config contract", () => {
		const path = `${fixturesRoot}valid/simple/s11t.config.toml`;
		expect(parseProjectConfig(parse(readFileSync(path, "utf8")))).toEqual({
			schemaVersion: 1,
			sourceDir: "contexts",
			outDir: ".s11t",
			requiredLocales: ["ja-JP", "en-US"],
			defaultLocale: "ja-JP",
		});
	});

	it("rejects reserved optional variables instead of ignoring them", () => {
		const code = diagnosticCode(() =>
			parseAuthoringDocument(
				{
					schema_version: 1,
					context: {
						id: "test:optional",
						version: "1.0.0",
						owner: "test",
						source_locale: "en-US",
						required_locales: ["en-US"],
						output: "text",
					},
					variables: {
						value: {
							required: false,
							type: "string",
							trust: "trusted",
							placement: "inline",
							encoding: "raw",
						},
					},
					locales: { "en-US": { text: "[[value]]" } },
				},
				"optional.context.toml",
			),
		);
		expect(code).toBe("S11T_UNSUPPORTED_OPTIONAL_VARIABLE");
	});

	it("rejects reserved profile fields instead of ignoring them", () => {
		const code = diagnosticCode(() =>
			parseAuthoringDocument(
				{
					schema_version: 1,
					context: {
						id: "test:profile",
						version: "1.0.0",
						owner: "test",
						source_locale: "en-US",
						required_locales: ["en-US"],
						output: "text",
					},
					locales: { "en-US": { text: "Text" } },
					profiles: { fast: { text: "Override" } },
				},
				"profile.context.toml",
			),
		);
		expect(code).toBe("S11T_SOURCE_INVALID");
	});

	it("rejects malformed placeholder syntax", () => {
		const code = diagnosticCode(() =>
			parseAuthoringDocument(
				{
					schema_version: 1,
					context: {
						id: "test:placeholder",
						version: "1.0.0",
						owner: "test",
						source_locale: "en-US",
						required_locales: ["en-US"],
						output: "text",
					},
					locales: { "en-US": { text: "[[nested.value]]" } },
				},
				"placeholder.context.toml",
			),
		);
		expect(code).toBe("S11T_PLACEHOLDER_INVALID");
	});

	it("rejects SemVer prerelease numeric identifiers with leading zeroes", () => {
		const code = diagnosticCode(() =>
			parseAuthoringDocument(
				{
					schema_version: 1,
					context: {
						id: "test:version",
						version: "1.0.0-01",
						owner: "test",
						source_locale: "en-US",
						required_locales: ["en-US"],
						output: "text",
					},
					locales: { "en-US": { text: "Text" } },
				},
				"version.context.toml",
			),
		);
		expect(code).toBe("S11T_SOURCE_INVALID");
	});

	it("rejects non-plain objects passed to the public parser", () => {
		expect(diagnosticCode(() => parseAuthoringDocument(new Date(0), "date.context.toml"))).toBe(
			"S11T_SOURCE_INVALID",
		);
		expect(diagnosticCode(() => parseProjectConfig(new Date(0)))).toBe("S11T_CONFIG_INVALID");
	});

	it("rejects accessors and sparse arrays passed to the public parser", () => {
		const accessor = Object.defineProperty({}, "schema_version", {
			enumerable: true,
			get: () => 1,
		});
		expect(diagnosticCode(() => parseAuthoringDocument(accessor, "accessor.context.toml"))).toBe(
			"S11T_SOURCE_INVALID",
		);

		const config = {
			schema_version: 1,
			source_dir: "contexts",
			out_dir: ".s11t",
			required_locales: new Array(1),
			default_locale: "en-US",
		};
		expect(diagnosticCode(() => parseProjectConfig(config))).toBe("S11T_CONFIG_INVALID");
	});
});

describe("invalid fixtures", () => {
	it.each([
		["duplicate-id", "S11T_DUPLICATE_ID"],
		["missing-locale", "S11T_LOCALE_MISSING"],
		["undeclared-variable", "S11T_VARIABLE_UNDECLARED"],
		["unsafe-untrusted-raw", "S11T_UNSAFE_UNTRUSTED_RAW"],
		["unsupported-output", "S11T_UNSUPPORTED_OUTPUT"],
	])("rejects %s with %s", (name, expectedCode) => {
		const code = diagnosticCode(() => {
			const documents = loadDocuments("invalid", name);
			validateAuthoringDocuments(documents);
		});
		expect(code).toBe(expectedCode);
	});
});
