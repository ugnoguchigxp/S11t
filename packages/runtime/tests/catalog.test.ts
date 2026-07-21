import { describe, expect, it } from "vitest";

import { createCatalog } from "../src/catalog.js";
import { compileCatalog, type CanonicalContextDefinition } from "../src/compiler.js";
import { S11tError } from "../src/diagnostics.js";

function definition(): CanonicalContextDefinition {
	return {
		id: "codingAgent:identity",
		version: "1.0.0",
		owner: "coding-agent",
		output: "text",
		sourceLocale: "ja-JP",
		requiredLocales: ["ja-JP", "en-US"],
		variables: {
			taskGoal: {
				required: true,
				type: "string",
				trust: "untrusted",
				placement: "delimited-context",
				encoding: "json-string",
			},
		},
		sections: [
			{
				id: "role.identity",
				kind: "instruction",
				severity: "must",
				enforcement: "prompt",
				optimizable: false,
				locales: { "ja-JP": "役割", "en-US": "Role" },
			},
			{
				id: "task.goal",
				kind: "runtime-fact",
				severity: "should",
				enforcement: "prompt",
				optimizable: false,
				locales: { "ja-JP": "目標: [[taskGoal]]", "en-US": "Goal: [[taskGoal]]" },
			},
		],
	};
}

function artifact() {
	return compileCatalog([definition()], {
		defaultLocale: "ja-JP",
		provenance: {
			configPath: "s11t.config.toml",
			sourceFiles: ["contexts/identity.context.toml"],
		},
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

describe("createCatalog", () => {
	it("validates digests and exposes immutable descriptions", () => {
		const input = artifact();
		const catalog = createCatalog(input, { expectedCatalogDigest: input.catalogDigest });
		expect(catalog.list()).toEqual([
			expect.objectContaining({ id: "codingAgent:identity", variableNames: ["taskGoal"] }),
		]);
		expect(Object.isFrozen(catalog.list())).toBe(true);
		expect(Object.isFrozen(catalog.list()[0])).toBe(true);
	});

	it("rejects expected digest mismatch and artifact tampering", () => {
		const input = artifact();
		expect(errorCode(() => createCatalog(input, { expectedCatalogDigest: `sha256:${"0".repeat(64)}` }))).toBe(
			"S11T_ARTIFACT_DIGEST_MISMATCH",
		);
		input.contexts["codingAgent:identity"]!.locales["en-US"]!.sections[0]!.segments = [
			{ type: "literal", value: "Tampered" },
		];
		expect(errorCode(() => createCatalog(input))).toBe("S11T_ARTIFACT_DIGEST_MISMATCH");
	});

	it("is unaffected by caller mutation after creation", () => {
		const input = artifact();
		const catalog = createCatalog(input);
		const p = catalog.bind({ instructionLocale: "en-US" });
		const before = p("codingAgent:identity", { taskGoal: "Ship" });
		input.contexts["codingAgent:identity"]!.locales["en-US"]!.sections[0]!.segments = [];
		const after = p("codingAgent:identity", { taskGoal: "Ship" });
		expect(after).toEqual(before);
		expect(Object.isFrozen(after)).toBe(true);
		expect(Object.isFrozen(after.manifest.sectionIds)).toBe(true);
	});
});

describe("bind and p", () => {
	it("keeps locale binding request-scoped", async () => {
		const catalog = createCatalog(artifact());
		const ja = catalog.bind({ instructionLocale: "ja-JP" });
		const en = catalog.bind({ instructionLocale: "en-US" });
		const [jaInvocation, enInvocation] = await Promise.all([
			Promise.resolve(ja("codingAgent:identity", { taskGoal: "公開" })),
			Promise.resolve(en("codingAgent:identity", { taskGoal: "Ship" })),
		]);
		expect(jaInvocation.content.text).toBe('役割\n目標: "公開"\n');
		expect(enInvocation.content.text).toBe('Role\nGoal: "Ship"\n');
	});

	it("records explicit fallback in the manifest", () => {
		const invocation = createCatalog(artifact())
			.bind({ instructionLocale: "fr-FR", fallbackLocale: "en-US" })("codingAgent:identity", {
				taskGoal: "Ship",
			});
		expect(invocation.manifest).toEqual(
			expect.objectContaining({
				requestedLocale: "fr-FR",
				resolvedLocale: "en-US",
				fallbackUsed: true,
				sectionIds: ["role.identity", "task.goal"],
			}),
		);
	});

	it("snapshots locale bindings instead of retaining caller-owned state", () => {
		const binding: { instructionLocale: string; fallbackLocale?: string } = {
			instructionLocale: "ja-JP",
		};
		const p = createCatalog(artifact()).bind(binding);
		binding.instructionLocale = "en-US";
		binding.fallbackLocale = "en-US";
		expect(p("codingAgent:identity", { taskGoal: "公開" }).manifest).toEqual(
			expect.objectContaining({ requestedLocale: "ja-JP", resolvedLocale: "ja-JP" }),
		);
	});

	it("rejects missing locale, missing value, extra value and unknown key", () => {
		const catalog = createCatalog(artifact());
		expect(
			errorCode(() => catalog.bind({ instructionLocale: "fr-FR" })("codingAgent:identity", { taskGoal: "x" })),
		).toBe("S11T_LOCALE_NOT_FOUND");
		const p = catalog.bind({ instructionLocale: "en-US" });
		expect(errorCode(() => p("codingAgent:identity", {}))).toBe("S11T_VALUE_MISSING");
		expect(errorCode(() => p("codingAgent:identity", { taskGoal: "x", extra: true }))).toBe(
			"S11T_VALUE_EXTRA",
		);
		expect(errorCode(() => p("missing:key", {}))).toBe("S11T_CONTEXT_NOT_FOUND");
	});

	it("treats prototype property names as missing keys and locales", () => {
		const catalog = createCatalog(artifact());
		expect(errorCode(() => catalog.bind({ instructionLocale: "en-US" })("constructor", {}))).toBe(
			"S11T_CONTEXT_NOT_FOUND",
		);
		expect(
			errorCode(() =>
				catalog.bind({ instructionLocale: "constructor" })("codingAgent:identity", {
					taskGoal: "x",
				}),
			),
		).toBe("S11T_LOCALE_NOT_FOUND");
	});
});
