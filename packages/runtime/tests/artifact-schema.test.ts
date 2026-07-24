import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { compileCatalog, type CanonicalContextDefinition } from "../src/compiler.js";
import {
	assertCatalogArtifact,
	isCatalogArtifact,
} from "../src/artifact-schema.js";
import { S11tnextError } from "../src/diagnostics.js";

function artifact() {
	const definition: CanonicalContextDefinition = {
		key: "example.greeting",
		owner: "examples",
		contentKind: "text",
		messageRole: "system",
		sourceLocale: "en-US",
		requiredLocales: ["en-US"],
		variables: {},
		sections: [
			{
				id: "context.text",
				kind: "instruction",
				severity: "must",
				optimizable: false,
				omitIfEmpty: false,
				locales: { "en-US": "Hello" },
			},
		],
	};
	return compileCatalog([definition], {
		releaseProfile: "development",
		provenance: { configPath: "s11tnext.config.toml", sourceFiles: ["contexts/example.context.toml"] },
	});
}

const schema = JSON.parse(
	readFileSync(new URL("../../../schemas/s11tnext-artifact.schema.json", import.meta.url), "utf8"),
) as object;
const validateJsonSchema = new Ajv2020({ strict: true }).compile(schema);

describe("artifact schema", () => {
	it("keeps runtime structural validation and JSON Schema aligned", () => {
		const input = artifact();
		expect(input.artifactVersion).toBe(2);
		expect(isCatalogArtifact(input)).toBe(true);
		expect(validateJsonSchema(input)).toBe(true);
		const invalid = structuredClone(input) as unknown as Record<string, unknown>;
		invalid.extra = true;
		expect(isCatalogArtifact(invalid)).toBe(false);
		expect(validateJsonSchema(invalid)).toBe(false);
	});

	it.each([
		{ name: "missing", version: undefined },
		{ name: "legacy", version: 1 },
		{ name: "future", version: 3 },
	])("rejects $name artifact versions with a migration diagnostic", ({ version }) => {
		const input = artifact() as unknown as Record<string, unknown>;
		if (version === undefined) delete input.artifactVersion;
		else input.artifactVersion = version;

		expect(() => assertCatalogArtifact(input)).toThrowError(
			expect.objectContaining<S11tnextError>({
				code: "S11TNEXT_ARTIFACT_VERSION_UNSUPPORTED",
				path: ["artifactVersion"],
			}),
		);
		expect(validateJsonSchema(input)).toBe(false);
	});

	it.each([
		{ schemaVersion: 1 },
		{ renderingContract: "delimited-context" },
		{ aliases: {} },
	])("rejects removed artifact fields in both validators", (removedField) => {
		const input = { ...artifact(), ...removedField };
		expect(isCatalogArtifact(input)).toBe(false);
		expect(validateJsonSchema(input)).toBe(false);
	});

	it.each([
		{
			name: "invalid source locale",
			mutate: (input: ReturnType<typeof artifact>) => {
				input.contexts["example.greeting"]!.sourceLocale = "not a locale";
			},
		},
		{
			name: "invalid compiled locale key",
			mutate: (input: ReturnType<typeof artifact>) => {
				const context = input.contexts["example.greeting"]!;
				context.locales["not a locale"] = context.locales["en-US"]!;
				delete context.locales["en-US"];
			},
		},
		{
			name: "invalid variable name",
			mutate: (input: ReturnType<typeof artifact>) => {
				input.contexts["example.greeting"]!.variables["bad-name"] = {
					required: true,
					type: "string",
					trust: "trusted",
					placement: "inline",
					encoding: "raw",
				};
			},
		},
	])("rejects $name in both validators", ({ mutate }) => {
		const input = artifact();
		mutate(input);
		expect(isCatalogArtifact(input)).toBe(false);
		expect(validateJsonSchema(input)).toBe(false);
	});

	it("rejects untrusted variables without delimited placement", () => {
		const input = artifact();
		input.contexts["example.greeting"]!.variables.value = {
			required: true,
			type: "string",
			trust: "untrusted",
			placement: "inline",
			encoding: "json-string",
		};
		expect(isCatalogArtifact(input)).toBe(false);
		expect(validateJsonSchema(input)).toBe(false);
	});

	it("rejects removed enforcement claims in compiled sections", () => {
		const input = artifact();
		const section = input.contexts["example.greeting"]!.locales["en-US"]!
			.sections[0] as unknown as Record<string, unknown>;
		section.enforcement = "host";
		expect(isCatalogArtifact(input)).toBe(false);
		expect(validateJsonSchema(input)).toBe(false);
	});

	it("rejects unsupported message roles in both validators", () => {
		const input = artifact();
		input.contexts["example.greeting"]!.messageRole = "assistant" as never;
		expect(isCatalogArtifact(input)).toBe(false);
		expect(validateJsonSchema(input)).toBe(false);
	});
});
