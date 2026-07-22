import { describe, expect, it } from "vitest";

import { createCatalogV2, S11tError } from "../src/index.js";
import { compileCatalogV2, type CanonicalContextDefinitionV2 } from "../src/compiler.js";

function definition(): CanonicalContextDefinitionV2 {
	return {
		key: "codingAgent.role-instructions",
		owner: "coding-agent",
		contentKind: "text",
		sourceLocale: "ja-JP",
		requiredLocales: ["ja-JP", "en-US"],
		variables: {},
		sections: [
			{
				id: "context.text",
				kind: "instruction",
				severity: "must",
				enforcement: "prompt",
				optimizable: false,
				locales: { "ja-JP": "日本語", "en-US": "English" },
			},
		],
	};
}

function artifact() {
	return compileCatalogV2([definition()], {
		releaseProfile: "production",
		aliases: { "codingAgent:roleInstructions": "codingAgent.role-instructions" },
		provenance: {
			configPath: "s11t.config.toml",
			sourceFiles: ["contexts/codingAgent/role-instructions.context.toml"],
		},
	});
}

function definitionWithValue(): CanonicalContextDefinitionV2 {
	const result = definition();
	result.variables = {
		value: {
			required: true,
			type: "string",
			trust: "trusted",
			placement: "inline",
			encoding: "raw",
		},
	};
	result.sections[0]!.locales = { "ja-JP": "値: [[value]]", "en-US": "Value: [[value]]" };
	return result;
}

function japaneseOnlyArtifact() {
	const japaneseOnly = definition();
	japaneseOnly.requiredLocales = ["ja-JP"];
	japaneseOnly.sections[0]!.locales = { "ja-JP": "日本語" };
	return compileCatalogV2([japaneseOnly], {
		releaseProfile: "development",
		provenance: { configPath: "s11t.config.toml", sourceFiles: ["contexts/a.context.toml"] },
	});
}

function errorCode(action: () => unknown): string {
	try {
		action();
	} catch (error) {
		if (error instanceof S11tError) return error.code;
		throw error;
	}
	throw new Error("Expected S11tError");
}

function errorDetails(action: () => unknown): { code: string; path: Array<string | number> } {
	try {
		action();
	} catch (error) {
		if (error instanceof S11tError) return { code: error.code, path: error.path };
		throw error;
	}
	throw new Error("Expected S11tError");
}

describe("catalog v2", () => {
	it("uses canonical dot keys while preserving a one-hop legacy alias", () => {
		const catalog = createCatalogV2(artifact());
		const invocation = catalog.bind({ instructionLocale: "ja-JP" })(
			"codingAgent:roleInstructions",
			{},
		);
		expect(invocation.content.text).toBe("日本語\n");
		expect(invocation.manifest).toEqual(
			expect.objectContaining({
				requestedKey: "codingAgent:roleInstructions",
				resolvedKey: "codingAgent.role-instructions",
				aliasUsed: true,
			}),
		);
		expect(catalog.listAliases()).toEqual({
			"codingAgent:roleInstructions": "codingAgent.role-instructions",
		});
	});

	it("keeps language switching at the top-level binding and snapshots language variables", () => {
		const catalog = createCatalogV2(artifact());
		let topLevelLanguage: "ja" | "en" = "ja";
		const instructionLocale = () => (topLevelLanguage === "en" ? "en-US" : "ja-JP");
		const ja = catalog.bind({ instructionLocale: instructionLocale() });

		topLevelLanguage = "en";
		const en = catalog.bind({ instructionLocale: instructionLocale() });

		expect(ja("codingAgent.role-instructions", {}).content.text).toBe("日本語\n");
		expect(en("codingAgent.role-instructions", {}).content.text).toBe("English\n");
		expect(ja("codingAgent.role-instructions", {}).manifest.requestedLocale).toBe("ja-JP");
		expect(en("codingAgent.role-instructions", {}).manifest.requestedLocale).toBe("en-US");
	});

	it("uses ordered explicit fallbacks and rejects invalid binding state", () => {
		const catalog = createCatalogV2(japaneseOnlyArtifact());
		const invocation = catalog.bind({
			instructionLocale: "en-US",
			fallbackLocales: ["ja-JP"],
		})("codingAgent.role-instructions", {});
		expect(invocation.manifest).toEqual(
			expect.objectContaining({
				requestedLocale: "en-US",
				fallbackLocales: ["ja-JP"],
				resolvedLocale: "ja-JP",
				fallbackUsed: true,
			}),
		);
		expect(
			errorCode(() =>
				catalog.bind({ instructionLocale: "ja-JP", fallbackLocales: ["ja-JP"] }),
			),
		).toBe("S11T_VALUE_INVALID");
	});

	it("rejects artifact and alias tampering", () => {
		const input = artifact();
		input.aliases["codingAgent:roleInstructions"] = "missing.key";
		expect(errorCode(() => createCatalogV2(input))).toBe("S11T_ARTIFACT_INVALID");
	});

	it("returns equivalent immutable text renderers for canonical keys and aliases", () => {
		const catalog = createCatalogV2(artifact());
		const invocation = catalog.bind({ instructionLocale: "ja-JP" });
		const bound = catalog.bindText({ instructionLocale: "ja-JP" });

		expect(bound.p("codingAgent.role-instructions", {})).toBe(
			invocation("codingAgent.role-instructions", {}).content.text,
		);
		expect(bound.byKey["codingAgent.role-instructions"]({})).toBe(
			bound.p("codingAgent.role-instructions", {}),
		);
		expect(bound.byKey["codingAgent:roleInstructions"]({})).toBe("日本語\n");
		expect(Object.isFrozen(bound)).toBe(true);
		expect(Object.isFrozen(bound.p)).toBe(true);
		expect(Object.isFrozen(bound.byKey)).toBe(true);
		expect(Object.isFrozen(bound.byKey["codingAgent.role-instructions"])).toBe(true);
		expect(Object.getPrototypeOf(bound.byKey)).toBeNull();
		expect(Object.hasOwn(bound.byKey, "toString")).toBe(false);
		expect(
			Reflect.set(bound.byKey as unknown as Record<string, unknown>, "unexpected", () => ""),
		).toBe(false);
	});

	it("clones fixed bindings and keeps a request snapshot stable", () => {
		const catalog = createCatalogV2(japaneseOnlyArtifact());
		const fallbackLocales = ["ja-JP"];
		const bound = catalog.bindText({ instructionLocale: "en-US", fallbackLocales });
		fallbackLocales.length = 0;

		expect(bound.p("codingAgent.role-instructions", {})).toBe("日本語\n");
	});

	it("evaluates a live binding resolver exactly once per call and reflects language changes", () => {
		const catalog = createCatalogV2(artifact());
		let language: "ja" | "en" = "ja";
		let resolverCalls = 0;
		const p = catalog.createTextRenderer(() => {
			resolverCalls += 1;
			return { instructionLocale: language === "ja" ? "ja-JP" : "en-US" };
		});
		const fixed = catalog.bindText({ instructionLocale: "ja-JP" });

		expect(resolverCalls).toBe(0);
		expect(p("codingAgent.role-instructions", {})).toBe("日本語\n");
		expect(resolverCalls).toBe(1);
		language = "en";
		expect(p("codingAgent.role-instructions", {})).toBe("English\n");
		expect(resolverCalls).toBe(2);
		expect(fixed.p("codingAgent.role-instructions", {})).toBe("日本語\n");

		const failure = new Error("settings unavailable");
		const failing = catalog.createTextRenderer(() => {
			throw failure;
		});
		expect(() => failing("codingAgent.role-instructions", {})).toThrow(failure);
	});

	it("uses only explicit fallbacks for text renderers", () => {
		const catalog = createCatalogV2(japaneseOnlyArtifact());
		expect(
			catalog.bindText({ instructionLocale: "en-US", fallbackLocales: ["ja-JP"] }).p(
				"codingAgent.role-instructions",
				{},
			),
		).toBe("日本語\n");
		expect(
			errorCode(() =>
				catalog
					.bindText({ instructionLocale: "en-US" })
					.p("codingAgent.role-instructions", {}),
			),
		).toBe("S11T_LOCALE_NOT_FOUND");
	});

	it("preserves bind error codes and paths in text-only adapters", () => {
		const valuesCatalog = createCatalogV2(
			compileCatalogV2([definitionWithValue()], {
				releaseProfile: "production",
				provenance: { configPath: "s11t.config.toml", sourceFiles: ["contexts/a.context.toml"] },
			}),
		);
		const invocation = valuesCatalog.bind({ instructionLocale: "ja-JP" }) as (
			key: string,
			values: Record<string, unknown>,
		) => unknown;
		const text = valuesCatalog.bindText({ instructionLocale: "ja-JP" }).p as (
			key: string,
			values: Record<string, unknown>,
		) => string;
		for (const [key, values] of [
			["codingAgent.role-instructions", {}],
			["codingAgent.role-instructions", { value: "ok", extra: true }],
			["unknown.context", { value: "ok" }],
		] as const) {
			expect(errorDetails(() => text(key, values))).toEqual(
				errorDetails(() => invocation(key, values)),
			);
		}
		expect(
			errorDetails(() => valuesCatalog.bindText({ instructionLocale: "invalid locale" })),
		).toEqual(errorDetails(() => valuesCatalog.bind({ instructionLocale: "invalid locale" })));
	});
});
