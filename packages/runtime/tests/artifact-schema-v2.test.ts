import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { compileCatalogV2, type CanonicalContextDefinitionV2 } from "../src/compiler.js";
import { isCatalogArtifactV2 } from "../src/artifact-schema.js";
import { createCatalogV2, S11tError } from "../src/index.js";

function artifact() {
	const definition: CanonicalContextDefinitionV2 = {
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
	return compileCatalogV2([definition], {
		releaseProfile: "development",
		aliases: { "example:greeting": "example.greeting" },
		provenance: { configPath: "s11t.config.toml", sourceFiles: ["contexts/example.context.toml"] },
	});
}

const schema = JSON.parse(
	readFileSync(new URL("../../../schemas/s11t-artifact-v2.schema.json", import.meta.url), "utf8"),
) as object;
const validateJsonSchema = new Ajv2020({ strict: true }).compile(schema);

describe("artifact schema v2", () => {
	it("keeps runtime structural validation and JSON Schema aligned", () => {
		const input = artifact();
		expect(isCatalogArtifactV2(input)).toBe(true);
		expect(validateJsonSchema(input)).toBe(true);
		const invalid = structuredClone(input) as unknown as Record<string, unknown>;
		invalid.extra = true;
		expect(isCatalogArtifactV2(invalid)).toBe(false);
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
		expect(isCatalogArtifactV2(input)).toBe(false);
		expect(validateJsonSchema(input)).toBe(false);
	});

	it("leaves cross-field alias integrity to the runtime validator", () => {
		const input = artifact();
		input.aliases["example:greeting"] = "missing.context";
		expect(isCatalogArtifactV2(input)).toBe(true);
		expect(validateJsonSchema(input)).toBe(true);
		expect(() => createCatalogV2(input)).toThrowError(
			expect.objectContaining<Partial<S11tError>>({ code: "S11T_ARTIFACT_INVALID" }),
		);
	});
});
