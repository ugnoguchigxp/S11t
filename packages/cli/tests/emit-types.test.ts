import {
	compileCatalog,
	type CanonicalContextDefinition,
} from "@s11t/runtime/compiler";
import { describe, expect, it } from "vitest";

import { emitTypes } from "../src/emit-types.js";

function definition(): CanonicalContextDefinition {
	return {
		key: "types.all",
		owner: "test",
		contentKind: "text",
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
}

describe("generated type contract", () => {
	it("maps every runtime variable type deterministically", () => {
		const artifact = compileCatalog([definition()], {
			releaseProfile: "test",
			provenance: { configPath: "s11t.config.toml", sourceFiles: ["contexts/types.context.toml"] },
		});
		const first = emitTypes(artifact);
		expect(emitTypes(artifact)).toBe(first);
		expect(first).toContain('"text": string;');
		expect(first).toContain('"count": number;');
		expect(first).toContain('"enabled": boolean;');
		expect(first).toContain('"payload": JsonValue;');
		expect(first).toContain('import { createCatalog } from "@s11t/runtime";');
		expect(first).not.toMatch(/\/Users\//);
	});

	it("emits exact empty values for variable-free contexts", () => {
		const input = definition();
		input.key = "example.empty";
		input.variables = {};
		input.sections[0]!.locales = { "en-US": "Ready" };
		const artifact = compileCatalog([input], {
			releaseProfile: "development",
			provenance: { configPath: "s11t.config.toml", sourceFiles: ["contexts/empty.context.toml"] },
		});

		const generated = emitTypes(artifact);
		expect(generated).toContain('"example.empty": Record<string, never>;');
		expect(generated).not.toContain('"example.empty": {};');
		expect(generated).not.toContain("SystemContextAlias");
		expect(generated).not.toContain("CanonicalSystemContextKey");
		expect(generated).not.toContain("JsonValue");
	});
});
