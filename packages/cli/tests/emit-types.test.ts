import {
	compileCatalog,
	compileCatalogV2,
	type CanonicalContextDefinition,
	type CanonicalContextDefinitionV2,
} from "@s11t/runtime/compiler";
import { describe, expect, it } from "vitest";

import { emitTypes } from "../src/emit-types.js";

describe("generated type contract", () => {
	it("maps every runtime variable type deterministically", () => {
		const definition: CanonicalContextDefinition = {
			id: "types:all",
			version: "1.0.0",
			owner: "test",
			output: "text",
			sourceLocale: "en-US",
			requiredLocales: ["en-US"],
			variables: {
				text: { required: true, type: "string", trust: "trusted", placement: "inline", encoding: "raw" },
				count: { required: true, type: "number", trust: "trusted", placement: "inline", encoding: "json-value" },
				enabled: { required: true, type: "boolean", trust: "trusted", placement: "inline", encoding: "json-value" },
				payload: { required: true, type: "json", trust: "trusted", placement: "inline", encoding: "json-value" },
			},
			sections: [
				{
					id: "context.text",
					kind: "instruction",
					severity: "must",
					enforcement: "prompt",
					optimizable: false,
					locales: { "en-US": "[[text]] [[count]] [[enabled]] [[payload]]" },
				},
			],
		};
		const artifact = compileCatalog([definition], {
			defaultLocale: "en-US",
			provenance: { configPath: "s11t.config.toml", sourceFiles: ["contexts/types.context.toml"] },
		});
		const first = emitTypes(artifact);
		expect(emitTypes(artifact)).toBe(first);
		expect(first).toContain('"text": string;');
		expect(first).toContain('"count": number;');
		expect(first).toContain('"enabled": boolean;');
		expect(first).toContain('"payload": JsonValue;');
		expect(first).not.toMatch(/\/Users\//);
	});

	it("emits exact empty values for variable-free v2 contexts and aliases", () => {
		const definition: CanonicalContextDefinitionV2 = {
			key: "example.empty",
			owner: "test",
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
					locales: { "en-US": "Ready" },
				},
			],
		};
		const artifact = compileCatalogV2([definition], {
			releaseProfile: "development",
			aliases: { "example:empty": "example.empty" },
			provenance: { configPath: "s11t.config.toml", sourceFiles: ["contexts/empty.context.toml"] },
		});

		const generated = emitTypes(artifact);
		expect(generated).toContain('"example.empty": Record<string, never>;');
		expect(generated).toContain('"example:empty": Record<string, never>;');
		expect(generated).not.toContain('"example.empty": {};');
		expect(generated).not.toContain("JsonValue");
	});
});
