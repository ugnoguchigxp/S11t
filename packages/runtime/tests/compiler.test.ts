import { describe, expect, it } from "vitest";

import { compileCatalog, tokenizeTemplate, type CanonicalContextDefinition } from "../src/compiler.js";
import { S11tnextError } from "../src/diagnostics.js";

function definition(): CanonicalContextDefinition {
	return {
		key: "example.greeting",
		owner: "examples",
		contentKind: "text",
		sourceLocale: "ja-JP",
		requiredLocales: ["ja-JP", "en-US"],
		variables: {
			name: {
				required: true,
				type: "string",
				trust: "trusted",
				placement: "inline",
				encoding: "raw",
			},
		},
		sections: [
			{
				id: "context.text",
				kind: "instruction",
				severity: "must",
				enforcement: "prompt",
				optimizable: false,
				locales: {
					"ja-JP": "こんにちは、[[name]]。\r\n",
					"en-US": "Hello, [[name]].\n",
				},
			},
		],
	};
}

describe("pure compiler", () => {
	it("tokenizes placeholders without reparsing at runtime", () => {
		expect(tokenizeTemplate("before [[name]] after [[name]]")).toEqual([
			{ type: "literal", value: "before " },
			{ type: "variable", name: "name" },
			{ type: "literal", value: " after " },
			{ type: "variable", name: "name" },
		]);
	});

	it("returns byte-identical artifacts for the same semantic input", () => {
		const first = compileCatalog([definition()], {
			releaseProfile: "production",
			provenance: {
				configPath: "s11tnext.config.toml",
				sourceFiles: ["contexts/greeting.context.toml"],
			},
		});
		const second = compileCatalog([definition()], {
			releaseProfile: "production",
			provenance: {
				configPath: "s11tnext.config.toml",
				sourceFiles: ["contexts/greeting.context.toml"],
			},
		});
		expect(`${JSON.stringify(first, null, 2)}\n`).toBe(`${JSON.stringify(second, null, 2)}\n`);
	});

	it("keeps provenance outside the catalog digest", () => {
		const first = compileCatalog([definition()], {
			releaseProfile: "production",
			provenance: { configPath: "a.toml", sourceFiles: ["contexts/a.context.toml"] },
		});
		const second = compileCatalog([definition()], {
			releaseProfile: "production",
			provenance: { configPath: "b.toml", sourceFiles: ["contexts/b.context.toml"] },
		});
		expect(first.catalogDigest).toBe(second.catalogDigest);
	});

	it("does not retain mutable variable definitions from compiler input", () => {
		const input = definition();
		const artifact = compileCatalog([input], {
			releaseProfile: "production",
			provenance: {
				configPath: "s11tnext.config.toml",
				sourceFiles: ["contexts/greeting.context.toml"],
			},
		});
		input.variables.name!.encoding = "json-string";
		expect(artifact.contexts["example.greeting"]!.variables.name!.encoding).toBe("raw");
	});

	it("compiles available translations beyond the required locale set", () => {
		const input = definition();
		input.requiredLocales = ["en-US"];
		input.sourceLocale = "en-US";
		input.sections[0]!.locales["fr-FR"] = "Bonjour, [[name]].";
		const artifact = compileCatalog([input], {
			releaseProfile: "production",
			provenance: { configPath: "s11tnext.config.toml", sourceFiles: ["contexts/greeting.context.toml"] },
		});
		expect(Object.keys(artifact.contexts["example.greeting"]!.locales)).toEqual([
			"en-US",
			"fr-FR",
			"ja-JP",
		]);
	});

	it("never emits an artifact that omits a required locale", () => {
		const input = definition();
		delete input.sections[0]!.locales["en-US"];
		expect(() =>
			compileCatalog([input], {
				releaseProfile: "production",
				provenance: {
					configPath: "s11tnext.config.toml",
					sourceFiles: ["contexts/greeting.context.toml"],
				},
			}),
		).toThrowError(expect.objectContaining<S11tnextError>({ code: "S11TNEXT_ARTIFACT_INVALID" }));
	});

	it("never emits an artifact with undeclared template variables", () => {
		const input = definition();
		input.sections[0]!.locales["en-US"] = "Hello, [[missing]].";
		expect(() =>
			compileCatalog([input], {
				releaseProfile: "production",
				provenance: {
					configPath: "s11tnext.config.toml",
					sourceFiles: ["contexts/greeting.context.toml"],
				},
			}),
		).toThrowError(expect.objectContaining<S11tnextError>({ code: "S11TNEXT_ARTIFACT_INVALID" }));
	});
});
