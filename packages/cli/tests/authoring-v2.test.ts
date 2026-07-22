import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	parseAndResolveAuthoringV2,
	validateResolvedDocumentsV2,
	type ResolvedAuthoringDocumentV2,
} from "../src/authoring-v2.js";
import { compileProject, isCompiledProjectV2 } from "../src/compile-source.js";
import { parseProjectConfigV2 } from "../src/config-v2.js";
import { inspectContext } from "../src/inspect-command.js";

const fixtureRoot = fileURLToPath(
	new URL("../../../fixtures/valid/content-first/", import.meta.url),
);

function testConfig() {
	return parseProjectConfigV2({
		schema_version: 2,
		authoring_version: 2,
		artifact_version: 2,
		source_dir: "contexts",
		out_dir: "generated",
		authoring: { source_locale: "ja-JP" },
		governance: { require_owner: true },
		keyspaces: { example: { owner: "examples" } },
		release_profiles: { development: { required_locales: ["$source"] } },
	});
}

describe("content-first authoring v2", () => {
	it("derives a dot key and expands project-level locale and variable policy", () => {
		const project = compileProject(undefined, fixtureRoot, "production");
		expect(isCompiledProjectV2(project)).toBe(true);
		if (!isCompiledProjectV2(project)) throw new Error("Expected v2 project");
		expect(Object.keys(project.artifact.contexts)).toEqual(["structuredGeneration.repair"]);
		expect(project.artifact.aliases).toEqual({
			"structuredGeneration:repair": "structuredGeneration.repair",
		});
		expect(project.artifact.contexts["structuredGeneration.repair"]).toMatchObject({
			key: "structuredGeneration.repair",
			owner: "structured-generation",
			sourceLocale: "ja-JP",
			requiredLocales: ["ja-JP", "en-US"],
			variables: {
				outputRequirements: {
					required: true,
					trust: "trusted",
					placement: "delimited-context",
					encoding: "raw",
				},
			},
		});
	});

	it("reports resolved values and their top-level origins", () => {
		const result = inspectContext("structuredGeneration:repair", {
			cwd: fixtureRoot,
			releaseProfile: "production",
			resolved: true,
		}) as Record<string, unknown>;
		expect(result).toMatchObject({
			key: "structuredGeneration.repair",
			requestedKey: "structuredGeneration:repair",
			aliasUsed: true,
			sourceLocale: "ja-JP",
			releaseProfile: "production",
			origins: {
				sourceLocale: "authoring.source_locale",
				requiredLocales: "release_profiles.production",
			},
		});
	});

	it("rejects a translation that attempts to override the source locale", () => {
		expect(() =>
			parseAndResolveAuthoringV2(
				{
					text: "正本",
					translations: { "ja-JP": { text: "上書き" } },
				},
				"contexts/example/greeting.context.toml",
				"example/greeting.context.toml",
				testConfig(),
				"development",
			),
		).toThrowError(
			expect.objectContaining({
				diagnostics: [
					expect.objectContaining({ code: "S11T_SOURCE_LOCALE_OVERRIDE" }),
				],
			}),
		);
	});

	it("rejects a legacy alias that conflicts with project alias policy", () => {
		const config = testConfig();
		config.keyAliases["example:greeting"] = "example.other";
		const document = {
			file: "contexts/example/greeting.context.toml",
			sourcePath: "example/greeting.context.toml",
			definition: {
				key: "example.greeting",
				owner: "examples",
				contentKind: "text",
				sourceLocale: "ja-JP",
				requiredLocales: ["ja-JP"],
				variables: {},
				sections: [],
			},
			origins: {
				key: "path",
				owner: "keyspace",
				contentKind: "built-in",
				sourceLocale: "authoring",
				requiredLocales: "profile",
				variables: {},
			},
			legacyAlias: "example:greeting",
		} satisfies ResolvedAuthoringDocumentV2;
		expect(() => validateResolvedDocumentsV2([document], config)).toThrowError(
			expect.objectContaining({
				diagnostics: [expect.objectContaining({ code: "S11T_KEY_ALIAS_INVALID" })],
			}),
		);
	});

	it.each([
		{
			name: "release profile",
			action: () =>
				parseAndResolveAuthoringV2(
					{ text: "正本" },
					"contexts/example/greeting.context.toml",
					"example/greeting.context.toml",
					testConfig(),
					"constructor",
				),
			code: "S11T_RELEASE_PROFILE_NOT_FOUND",
		},
		{
			name: "variable profile",
			action: () =>
				parseAndResolveAuthoringV2(
					{
						text: "[[value]]",
						variables: { value: { profile: "constructor" } },
					},
					"contexts/example/greeting.context.toml",
					"example/greeting.context.toml",
					testConfig(),
					"development",
				),
			code: "S11T_VARIABLE_PROFILE_NOT_FOUND",
		},
	])("does not resolve inherited object properties as a $name", ({ action, code }) => {
		expect(action).toThrowError(
			expect.objectContaining({
				diagnostics: [expect.objectContaining({ code })],
			}),
		);
	});
});
