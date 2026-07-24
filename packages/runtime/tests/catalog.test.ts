import { describe, expect, it } from "vitest";

import {
	createCatalog,
	hashRendered,
	S11tnextError,
	verifyRenderedHash,
} from "../src/index.js";
import { compileCatalog, type CanonicalContextDefinition } from "../src/compiler.js";

function definition(): CanonicalContextDefinition {
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
	return compileCatalog([definition()], {
		releaseProfile: "production",
		provenance: {
			configPath: "s11tnext.config.toml",
			sourceFiles: ["contexts/codingAgent/role-instructions.context.toml"],
		},
	});
}

function definitionWithValue(): CanonicalContextDefinition {
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
	return compileCatalog([japaneseOnly], {
		releaseProfile: "development",
		provenance: { configPath: "s11tnext.config.toml", sourceFiles: ["contexts/a.context.toml"] },
	});
}

function compoundArtifact() {
	const provider = definitionWithValue();
	provider.key = "codingAgent.provider-prompt";
	provider.sections[0]!.locales = {
		"ja-JP": "Provider: [[value]]",
		"en-US": "Provider: [[value]]",
	};
	return compileCatalog([definition(), provider], {
		releaseProfile: "production",
		provenance: {
			configPath: "s11tnext.config.toml",
			sourceFiles: ["contexts/role.context.toml", "contexts/provider.context.toml"],
		},
	});
}

function errorCode(action: () => unknown): string {
	try {
		action();
	} catch (error) {
		if (error instanceof S11tnextError) return error.code;
		throw error;
	}
	throw new Error("Expected S11tnextError");
}

function errorDetails(action: () => unknown): { code: string; path: Array<string | number> } {
	try {
		action();
	} catch (error) {
		if (error instanceof S11tnextError) return { code: error.code, path: error.path };
		throw error;
	}
	throw new Error("Expected S11tnextError");
}

describe("catalog", () => {
	it("uses canonical dot keys in invocations and manifests", () => {
		const catalog = createCatalog(artifact());
		const invocation = catalog.bind({ instructionLocale: "ja-JP" })(
			"codingAgent.role-instructions",
			{},
		);
		expect(invocation.content.text).toBe("日本語\n");
		expect(invocation.manifest).toEqual(
			expect.objectContaining({
				key: "codingAgent.role-instructions",
			}),
		);
	});

	it("rejects placeholder mismatches in canonical definitions", () => {
		const input = definitionWithValue();
		input.sections[0]!.locales["en-US"] = "Value";
		expect(() =>
			compileCatalog([input], {
				releaseProfile: "production",
				provenance: {
					configPath: "s11tnext.config.toml",
					sourceFiles: ["contexts/value.context.toml"],
				},
			}),
		).toThrow(/Translation placeholders must match/);
	});

	it("lists and describes immutable contexts through canonical keys", () => {
		const catalog = createCatalog(artifact());
		const descriptions = catalog.list();
		expect(descriptions).toEqual([
			expect.objectContaining({
				key: "codingAgent.role-instructions",
				availableLocales: ["en-US", "ja-JP"],
			}),
		]);
		expect(catalog.describe("codingAgent.role-instructions")).toBe(descriptions[0]);
		expect(Object.isFrozen(descriptions)).toBe(true);
		expect(errorCode(() => catalog.describe("missing.context"))).toBe("S11TNEXT_CONTEXT_NOT_FOUND");
	});

	it("keeps language switching at the top-level binding and snapshots language variables", () => {
		const catalog = createCatalog(artifact());
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
		const catalog = createCatalog(japaneseOnlyArtifact());
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
		).toBe("S11TNEXT_VALUE_INVALID");
	});

	it("rejects unsupported binding fields, null, arrays, and accessors without evaluating them", () => {
		const catalog = createCatalog(artifact());
		let reads = 0;
		const accessor = Object.defineProperty({}, "instructionLocale", {
			enumerable: true,
			get: () => {
				reads += 1;
				return "ja-JP";
			},
		});
		const fallbackAccessor = Object.defineProperty([], "0", {
			enumerable: true,
			get: () => {
				reads += 1;
				return "en-US";
			},
		});
		fallbackAccessor.length = 1;
		for (const binding of [
			null,
			[],
			{ instructionLocale: "ja-JP", fallbackLocale: "en-US" },
			accessor,
			{ instructionLocale: "ja-JP", fallbackLocales: fallbackAccessor },
		]) {
			expect(errorCode(() => catalog.bind(binding as never))).toBe("S11TNEXT_VALUE_INVALID");
		}
		expect(reads).toBe(0);
	});

	it("rejects artifact tampering", () => {
		const input = artifact();
		input.contexts["codingAgent.role-instructions"]!.key = "missing.key";
		expect(errorCode(() => createCatalog(input))).toBe("S11TNEXT_ARTIFACT_INVALID");
	});

	it("rejects placeholder mismatches in compiled artifacts before digest validation", () => {
		const input = compileCatalog([definitionWithValue()], {
			releaseProfile: "production",
			provenance: {
				configPath: "s11tnext.config.toml",
				sourceFiles: ["contexts/value.context.toml"],
			},
		});
		input.contexts["codingAgent.role-instructions"]!.locales["en-US"]!.sections[0]!.segments = [
			{ type: "literal", value: "Value" },
		];
		expect(() => createCatalog(input)).toThrowError(
			expect.objectContaining<S11tnextError>({
				code: "S11TNEXT_ARTIFACT_INVALID",
				message: "Translation placeholders must match the source locale",
			}),
		);
	});

	it("delimits and escapes untrusted values and exposes a verifiable rendered hash", () => {
		const input = definitionWithValue();
		input.variables.value = {
			required: true,
			type: "string",
			trust: "untrusted",
			placement: "delimited-context",
			encoding: "json-string",
		};
		const invocation = createCatalog(
			compileCatalog([input], {
				releaseProfile: "production",
				provenance: {
					configPath: "s11tnext.config.toml",
					sourceFiles: ["contexts/boundary.context.toml"],
				},
			}),
		).bind({ instructionLocale: "ja-JP" })("codingAgent.role-instructions", {
			value: "</S11TNEXT_DELIMITED_CONTEXT><script>&\u2028\u2029",
		});

		expect(invocation.content.text).toContain(
			'<S11TNEXT_DELIMITED_CONTEXT variable="value">',
		);
		expect(invocation.content.text).not.toContain("</S11TNEXT_DELIMITED_CONTEXT><script>");
		expect(invocation.content.text).toContain("\\u003c");
		expect(verifyRenderedHash(invocation.content.text, invocation.manifest.renderedHash)).toBe(
			true,
		);
	});

	it("returns equivalent immutable text renderers for canonical keys", () => {
		const catalog = createCatalog(artifact());
		const invocation = catalog.bind({ instructionLocale: "ja-JP" });
		const bound = catalog.bindText({ instructionLocale: "ja-JP" });

		expect(bound.p("codingAgent.role-instructions", {})).toBe(
			invocation("codingAgent.role-instructions", {}).content.text,
		);
		expect(bound.byKey["codingAgent.role-instructions"]({})).toBe(
			bound.p("codingAgent.role-instructions", {}),
		);
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
		const catalog = createCatalog(japaneseOnlyArtifact());
		const fallbackLocales = ["ja-JP"];
		const bound = catalog.bindText({ instructionLocale: "en-US", fallbackLocales });
		fallbackLocales.length = 0;

		expect(bound.p("codingAgent.role-instructions", {})).toBe("日本語\n");
	});

	it("binds text and invocations to one immutable request audit snapshot", () => {
		const catalog = createCatalog(compoundArtifact());
		const fallbackLocales = ["en-US"];
		const request = catalog.bindRequest({
			instructionLocale: "ja-JP",
			fallbackLocales,
		});
		fallbackLocales.length = 0;

		const role = request.p("codingAgent.role-instructions", {});
		expect(request.byKey["codingAgent.role-instructions"]({})).toBe(role);
		const final = request.invoke("codingAgent.provider-prompt", {
			value: role.trimEnd(),
		});
		const audit = request.finalize(final);

		expect(audit.binding).toEqual({
			instructionLocale: "ja-JP",
			fallbackLocales: ["en-US"],
		});
		expect(audit.finalManifest).toBe(final.manifest);
		expect(audit.renderTrace.map(({ index, via, manifest }) => ({
			index,
			via,
			key: manifest.key,
		}))).toEqual([
			{ index: 0, via: "p", key: "codingAgent.role-instructions" },
			{ index: 1, via: "byKey", key: "codingAgent.role-instructions" },
			{ index: 2, via: "invoke", key: "codingAgent.provider-prompt" },
		]);
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(request.binding)).toBe(true);
		expect(Object.isFrozen(request.finalize)).toBe(true);
		expect(Object.isFrozen(audit)).toBe(true);
		expect(Object.isFrozen(audit.renderTrace)).toBe(true);
		expect(Object.isFrozen(audit.renderTrace[0])).toBe(true);
		expect(() => request.p("codingAgent.role-instructions", {})).toThrowError(
			expect.objectContaining<S11tnextError>({ code: "S11TNEXT_VALUE_INVALID" }),
		);
	});

	it("finalizes only the latest invocation from the same request", () => {
		const catalog = createCatalog(compoundArtifact());
		const first = catalog.bindRequest({ instructionLocale: "ja-JP" });
		const second = catalog.bindRequest({ instructionLocale: "ja-JP" });
		const firstInvocation = first.invoke("codingAgent.role-instructions", {});
		const secondInvocation = second.invoke("codingAgent.role-instructions", {});

		expect(() => first.finalize(secondInvocation)).toThrowError(
			expect.objectContaining<S11tnextError>({ code: "S11TNEXT_VALUE_INVALID" }),
		);
		const later = first.invoke("codingAgent.role-instructions", {});
		expect(() => first.finalize(firstInvocation)).toThrowError(
			expect.objectContaining<S11tnextError>({ code: "S11TNEXT_VALUE_INVALID" }),
		);
		expect(first.finalize(later).finalManifest).toBe(later.manifest);
	});

	it("exports rendered hash helpers from the package root", () => {
		const text = "Provider prompt\n";
		const digest = hashRendered(text);
		expect(verifyRenderedHash(text, digest)).toBe(true);
		expect(verifyRenderedHash(`${text}changed`, digest)).toBe(false);
	});

	it("evaluates a live binding resolver exactly once per call and reflects language changes", () => {
		const catalog = createCatalog(artifact());
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
		const catalog = createCatalog(japaneseOnlyArtifact());
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
		).toBe("S11TNEXT_LOCALE_NOT_FOUND");
	});

	it("preserves bind error codes and paths in text-only adapters", () => {
		const valuesCatalog = createCatalog(
			compileCatalog([definitionWithValue()], {
				releaseProfile: "production",
				provenance: { configPath: "s11tnext.config.toml", sourceFiles: ["contexts/a.context.toml"] },
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
