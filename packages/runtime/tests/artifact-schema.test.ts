import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { compileCatalog, type CanonicalContextDefinition } from "../src/compiler.js";
import { isCatalogArtifact } from "../src/artifact-schema.js";
import { createCatalog, S11tError } from "../src/index.js";

function artifact() {
	const definition: CanonicalContextDefinition = {
		key: "example.greeting",
		owner: "examples",
		contentKind: "text",
		sourceLocale: "en-US",
		requiredLocales: ["en-US"],
		variables: {},
		sections: [
			{
				id: "context.text",
				kind: "instruction",
				severity: "must",
				enforcement: "prompt",
				optimizable: false,
				locales: { "en-US": "Hello" },
			},
		],
	};
	return compileCatalog([definition], {
		releaseProfile: "development",
		aliases: { "example.greetingAlias": "example.greeting" },
		provenance: { configPath: "s11t.config.toml", sourceFiles: ["contexts/example.context.toml"] },
	});
}

const schema = JSON.parse(
	readFileSync(new URL("../../../schemas/s11t-artifact.schema.json", import.meta.url), "utf8"),
) as object;
const validateJsonSchema = new Ajv2020({ strict: true }).compile(schema);

describe("artifact schema", () => {
	it("keeps runtime structural validation and JSON Schema aligned", () => {
		const input = artifact();
		expect(isCatalogArtifact(input)).toBe(true);
		expect(validateJsonSchema(input)).toBe(true);
		const invalid = structuredClone(input) as unknown as Record<string, unknown>;
		invalid.extra = true;
		expect(isCatalogArtifact(invalid)).toBe(false);
		expect(validateJsonSchema(invalid)).toBe(false);
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

	it("leaves cross-field alias integrity to the runtime validator", () => {
		const input = artifact();
		input.aliases["example.greetingAlias"] = "missing.context";
		expect(isCatalogArtifact(input)).toBe(true);
		expect(validateJsonSchema(input)).toBe(true);
		expect(() => createCatalog(input)).toThrowError(
			expect.objectContaining<Partial<S11tError>>({ code: "S11T_ARTIFACT_INVALID" }),
		);
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
});
