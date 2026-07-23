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

function expectDiagnostic(action: () => unknown, code: string): void {
	expect(action).toThrowError(
		expect.objectContaining({
			diagnostics: [expect.objectContaining({ code })],
		}),
	);
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

	it("inspects direct v1 and v2 keys and reports missing contexts and locales", () => {
		expect(
			inspectContext("structuredGeneration.repair", {
				cwd: fixtureRoot,
				releaseProfile: "production",
				locale: "en-US",
			}),
		).toEqual(
			expect.objectContaining({
				key: "structuredGeneration.repair",
				requestedKey: "structuredGeneration.repair",
				locale: "en-US",
			}),
		);
		expectDiagnostic(
			() =>
				inspectContext("missing.context", {
					cwd: fixtureRoot,
					releaseProfile: "production",
				}),
			"S11T_CONTEXT_NOT_FOUND",
		);
		expectDiagnostic(
			() =>
				inspectContext("structuredGeneration.repair", {
					cwd: fixtureRoot,
					releaseProfile: "production",
					locale: "fr-FR",
				}),
			"S11T_LOCALE_NOT_FOUND",
		);

		const v1Root = fileURLToPath(new URL("../../../fixtures/valid/simple/", import.meta.url));
		expect(inspectContext("structuredOutput:repair", { cwd: v1Root, locale: "en-US" })).toEqual(
			expect.objectContaining({ id: "structuredOutput:repair", locale: "en-US" }),
		);
		expectDiagnostic(
			() => inspectContext("missing:context", { cwd: v1Root }),
			"S11T_CONTEXT_NOT_FOUND",
		);
		expectDiagnostic(
			() => inspectContext("structuredOutput:repair", { cwd: v1Root, locale: "fr-FR" }),
			"S11T_LOCALE_NOT_FOUND",
		);
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
		expectDiagnostic(action, code);
	});

	it.each([
		{
			name: "non-object source",
			input: null,
			sourcePath: "example/greeting.context.toml",
			code: "S11T_SOURCE_INVALID",
		},
		{
			name: "unsupported root field",
			input: { text: "正本", unsupported: true },
			sourcePath: "example/greeting.context.toml",
			code: "S11T_SOURCE_INVALID",
		},
		{
			name: "invalid source suffix",
			input: { text: "正本" },
			sourcePath: "example/greeting.toml",
			code: "S11T_KEY_INVALID",
		},
		{
			name: "invalid source segment",
			input: { text: "正本" },
			sourcePath: "example/bad segment.context.toml",
			code: "S11T_KEY_INVALID",
		},
		{
			name: "invalid explicit key",
			input: { key: "example:greeting", text: "正本" },
			sourcePath: "example/greeting.context.toml",
			code: "S11T_KEY_INVALID",
		},
		{
			name: "unsupported content kind",
			input: { content_kind: "json", text: "正本" },
			sourcePath: "example/greeting.context.toml",
			code: "S11T_SOURCE_INVALID",
		},
		{
			name: "missing content",
			input: {},
			sourcePath: "example/greeting.context.toml",
			code: "S11T_SOURCE_SHAPE_CONFLICT",
		},
		{
			name: "text and sections conflict",
			input: { text: "正本", sections: [] },
			sourcePath: "example/greeting.context.toml",
			code: "S11T_SOURCE_SHAPE_CONFLICT",
		},
		{
			name: "root translation with sections",
			input: {
				sections: [
					{
						id: "context.text",
						kind: "instruction",
						severity: "must",
						enforcement: "prompt",
						optimizable: false,
						text: "正本",
					},
				],
				translations: { "en-US": { text: "Source" } },
			},
			sourcePath: "example/greeting.context.toml",
			code: "S11T_SOURCE_SHAPE_CONFLICT",
		},
		{
			name: "invalid locale",
			input: { text: "正本", translations: { invalid_locale: { text: "Source" } } },
			sourcePath: "example/greeting.context.toml",
			code: "S11T_SOURCE_INVALID",
		},
		{
			name: "invalid variable name",
			input: {
				text: "[[valid]]",
				variables: {
					"not-valid": {
						type: "string",
						trust: "trusted",
						placement: "inline",
						encoding: "raw",
					},
				},
			},
			sourcePath: "example/greeting.context.toml",
			code: "S11T_SOURCE_INVALID",
		},
		{
			name: "unsafe untrusted raw variable",
			input: {
				text: "[[value]]",
				variables: {
					value: {
						type: "string",
						trust: "untrusted",
						placement: "inline",
						encoding: "raw",
					},
				},
			},
			sourcePath: "example/greeting.context.toml",
			code: "S11T_UNSAFE_UNTRUSTED_RAW",
		},
		{
			name: "raw non-string variable",
			input: {
				text: "[[value]]",
				variables: {
					value: {
						type: "number",
						trust: "trusted",
						placement: "inline",
						encoding: "raw",
					},
				},
			},
			sourcePath: "example/greeting.context.toml",
			code: "S11T_ENCODING_TYPE_MISMATCH",
		},
		{
			name: "json string with json variable",
			input: {
				text: "[[value]]",
				variables: {
					value: {
						type: "json",
						trust: "trusted",
						placement: "inline",
						encoding: "json-string",
					},
				},
			},
			sourcePath: "example/greeting.context.toml",
			code: "S11T_ENCODING_TYPE_MISMATCH",
		},
		{
			name: "invalid placeholder syntax",
			input: { text: "[[broken]" },
			sourcePath: "example/greeting.context.toml",
			code: "S11T_PLACEHOLDER_INVALID",
		},
		{
			name: "undeclared placeholder",
			input: { text: "[[missing]]" },
			sourcePath: "example/greeting.context.toml",
			code: "S11T_VARIABLE_UNDECLARED",
		},
		{
			name: "unused variable",
			input: {
				text: "正本",
				variables: {
					value: {
						type: "string",
						trust: "trusted",
						placement: "inline",
						encoding: "raw",
					},
				},
			},
			sourcePath: "example/greeting.context.toml",
			code: "S11T_VARIABLE_UNUSED",
		},
		{
			name: "empty sections",
			input: { sections: [] },
			sourcePath: "example/greeting.context.toml",
			code: "S11T_SOURCE_INVALID",
		},
	])("rejects $name", ({ input, sourcePath, code }) => {
		expectDiagnostic(
			() =>
				parseAndResolveAuthoringV2(
					input,
					"contexts/example/greeting.context.toml",
					sourcePath,
					testConfig(),
					"development",
				),
			code,
		);
	});

	it("supports unowned content when governance allows it and rejects document collisions", () => {
		const config = testConfig();
		config.governance.requireOwner = false;
		const document = parseAndResolveAuthoringV2(
			{ text: "正本" },
			"contexts/other/greeting.context.toml",
			"other/greeting.context.toml",
			config,
			"development",
		);
		expect(document.definition.owner).toBe("unowned");
		expectDiagnostic(
			() => validateResolvedDocumentsV2([document, { ...document, file: "duplicate.toml" }], config),
			"S11T_KEY_COLLISION",
		);
	});
});
