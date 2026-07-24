import {
	compileCatalog,
	type CanonicalContextDefinition,
} from "s11tnext/compiler";
import { describe, expect, it } from "vitest";

import { emitTypes } from "../src/emit-types.js";

function definition(): CanonicalContextDefinition {
	return {
		key: "types.all",
		owner: "test",
		contentKind: "text",
		messageRole: "system",
		sourceLocale: "en-US",
		requiredLocales: ["en-US"],
		variables: {
			text: { required: true, type: "string", trust: "trusted", placement: "inline", encoding: "raw" },
			count: { required: true, type: "number", trust: "trusted", placement: "inline", encoding: "json-value" },
			enabled: { required: true, type: "boolean", trust: "trusted", placement: "inline", encoding: "json-value" },
			payload: { required: true, type: "json", trust: "trusted", placement: "inline", encoding: "json-value" },
			optionalText: { required: false, type: "string", trust: "trusted", placement: "inline", encoding: "raw" },
		},
		sections: [
			{
				id: "context.text",
				kind: "instruction",
				severity: "must",
				optimizable: false,
				omitIfEmpty: false,
				locales: { "en-US": "[[text]] [[count]] [[enabled]] [[payload]] [[optionalText]]" },
			},
		],
	};
}

describe("generated type contract", () => {
	it("maps every runtime variable type deterministically", () => {
		const artifact = compileCatalog([definition()], {
			releaseProfile: "test",
			provenance: { configPath: "s11tnext.config.toml", sourceFiles: ["contexts/types.context.toml"] },
		});
		const first = emitTypes(artifact);
		expect(emitTypes(artifact)).toBe(first);
		expect(first).toContain('"text": string;');
		expect(first).toContain('"count": number;');
		expect(first).toContain('"enabled": boolean;');
		expect(first).toContain('"payload": JsonValue;');
		expect(first).toContain('"optionalText"?: string;');
		expect(first).toContain('"types.all": "system";');
		expect(first).toContain("export type PromptMessageRoleMap");
		expect(first).toContain("export type SystemContextKey = PromptKey;");
		expect(first).toContain('import { createCatalog } from "s11tnext";');
		expect(first).not.toMatch(/\/Users\//);
	});

	it("emits exact empty values for variable-free contexts", () => {
		const input = definition();
		input.key = "example.empty";
		input.variables = {};
		input.sections[0]!.locales = { "en-US": "Ready" };
		const artifact = compileCatalog([input], {
			releaseProfile: "development",
			provenance: { configPath: "s11tnext.config.toml", sourceFiles: ["contexts/empty.context.toml"] },
		});

		const generated = emitTypes(artifact);
		expect(generated).toContain('"example.empty": Record<string, never>;');
		expect(generated).not.toContain('"example.empty": {};');
		expect(generated).not.toContain("SystemContextAlias");
		expect(generated).not.toContain("CanonicalSystemContextKey");
		expect(generated).not.toContain("JsonValue");
	});

	it("uses the configured TypeScript indentation", () => {
		const artifact = compileCatalog([definition()], {
			releaseProfile: "test",
			provenance: {
				configPath: "s11tnext.config.toml",
				sourceFiles: ["contexts/types.context.toml"],
			},
		});

		const generated = emitTypes(artifact, { indent: "  " });
		expect(generated).toContain('\n    "text": string;');
		expect(generated).toContain("\n  PromptKey,");
		expect(generated).not.toContain("\t");
	});

	it("emits literal roles for mixed-role catalogs", () => {
		const system = definition();
		const user = definition();
		user.key = "types.input";
		user.messageRole = "user";
		const artifact = compileCatalog([system, user], {
			releaseProfile: "test",
			provenance: {
				configPath: "s11tnext.config.toml",
				sourceFiles: [
					"contexts/types.context.toml",
					"contexts/types/input.context.toml",
				],
			},
		});

		const generated = emitTypes(artifact);
		expect(generated).toContain('"types.all": "system";');
		expect(generated).toContain('"types.input": "user";');
		expect(generated).toContain("\tPromptMessageRoleMap\n>;");
	});
});
