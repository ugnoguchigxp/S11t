import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	parseAndResolveAuthoring,
	validateResolvedDocuments,
} from "../src/authoring.js";
import { compileProject } from "../src/compile-source.js";
import { parseProjectConfig } from "../src/config.js";
import { inspectContext, inspectCoverage } from "../src/inspect-command.js";

const fixtureRoot = fileURLToPath(
	new URL("../../../fixtures/valid/content-first/", import.meta.url),
);
const coverageFixtureRoot = fileURLToPath(
	new URL("../../../fixtures/valid/locale-rollout/", import.meta.url),
);

function testConfig() {
	return parseProjectConfig({
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

describe("content-first authoring", () => {
	it("derives a dot key and expands project-level locale and variable policy", () => {
		const project = compileProject(undefined, fixtureRoot, "production");
		expect(Object.keys(project.artifact.contexts)).toEqual(["structuredGeneration.repair"]);
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

	it("enforces the delimited placement contract for untrusted variables", () => {
		const document = parseAndResolveAuthoring(
			{
				text: "[[value]]",
				variables: {
					value: {
						type: "string",
						trust: "untrusted",
						placement: "delimited-context",
						encoding: "json-string",
					},
				},
			},
			"contexts/example/greeting.context.toml",
			"example/greeting.context.toml",
			testConfig(),
			"development",
		);
		expect(document.definition.variables.value).toMatchObject({
			trust: "untrusted",
			placement: "delimited-context",
		});
	});

	it("reports resolved values and their top-level origins", () => {
		const result = inspectContext("structuredGeneration.repair", {
			cwd: fixtureRoot,
			releaseProfile: "production",
			resolved: true,
		}) as Record<string, unknown>;
		expect(result).toMatchObject({
			key: "structuredGeneration.repair",
			sourceLocale: "ja-JP",
			releaseProfile: "production",
			origins: {
				sourceLocale: "authoring.source_locale",
				requiredLocales: "release_profiles.production",
			},
		});
	});

	it("inspects keys and reports missing contexts and locales", () => {
		expect(
			inspectContext("structuredGeneration.repair", {
				cwd: fixtureRoot,
				releaseProfile: "production",
				locale: "en-US",
			}),
		).toEqual(
			expect.objectContaining({
				key: "structuredGeneration.repair",
				locale: "en-US",
			}),
		);
		expectDiagnostic(
			() =>
				inspectContext("missing.context", {
					cwd: fixtureRoot,
					releaseProfile: "production",
				}),
			"S11TNEXT_CONTEXT_NOT_FOUND",
		);
		expectDiagnostic(
			() =>
				inspectContext("structuredGeneration.repair", {
					cwd: fixtureRoot,
					releaseProfile: "production",
					locale: "fr-FR",
				}),
			"S11TNEXT_LOCALE_NOT_FOUND",
		);

	});

	it("reports direct, ordered fallback, missing, and required-profile coverage", () => {
		expect(
			inspectCoverage({
				cwd: coverageFixtureRoot,
				releaseProfile: "development",
				locale: "en-US",
				fallbackLocales: ["fr-FR"],
			}),
		).toEqual({
			releaseProfile: "development",
			sourceLocale: "ja-JP",
			requestedLocale: "en-US",
			fallbackLocales: ["fr-FR"],
			requiredLocales: ["ja-JP"],
			requiredCoverageSatisfied: true,
			totals: { contexts: 3, direct: 1, fallback: 1, missing: 1 },
			direct: { keys: ["rollout.direct"] },
			fallback: {
				keys: ["rollout.fallback"],
				resolvedByLocale: { "fr-FR": ["rollout.fallback"] },
			},
			missing: { keys: ["rollout.missing"] },
		});

		expect(
			inspectCoverage({
				cwd: coverageFixtureRoot,
				releaseProfile: "production",
				locale: "en-US",
				fallbackLocales: ["ja-JP"],
			}).requiredCoverageSatisfied,
		).toBe(false);
	});

	it("validates coverage locale bindings like the runtime", () => {
		expectDiagnostic(
			() =>
				inspectCoverage({
					cwd: coverageFixtureRoot,
					releaseProfile: "development",
					locale: "invalid locale",
				}),
			"S11TNEXT_LOCALE_INVALID",
		);
		expectDiagnostic(
			() =>
				inspectCoverage({
					cwd: coverageFixtureRoot,
					releaseProfile: "development",
					locale: "en-US",
					fallbackLocales: ["ja-JP", "ja-JP"],
				}),
			"S11TNEXT_LOCALE_INVALID",
		);
	});

	it("rejects release locales that collide after resolving $source", () => {
		expectDiagnostic(
			() =>
				parseProjectConfig({
					source_dir: "contexts",
					out_dir: "generated",
					authoring: { source_locale: "ja-JP" },
					governance: { require_owner: true },
					keyspaces: { example: { owner: "examples" } },
					release_profiles: {
						development: { required_locales: ["$source", "ja-JP"] },
					},
				}),
			"S11TNEXT_CONFIG_INVALID",
		);
	});

	it("rejects the removed key_aliases configuration field", () => {
		expectDiagnostic(
			() =>
				parseProjectConfig({
					source_dir: "contexts",
					out_dir: "generated",
					authoring: { source_locale: "ja-JP" },
					governance: { require_owner: true },
					keyspaces: { example: { owner: "examples" } },
					release_profiles: {
						development: { required_locales: ["$source"] },
					},
					key_aliases: { "example.old": "example.current" },
				}),
			"S11TNEXT_CONFIG_INVALID",
		);
	});

	it("rejects a translation that attempts to override the source locale", () => {
		expect(() =>
			parseAndResolveAuthoring(
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
					expect.objectContaining({ code: "S11TNEXT_SOURCE_LOCALE_OVERRIDE" }),
				],
			}),
		);
	});

	it.each([
		{
			name: "missing placeholder in root translation",
			input: {
				text: "こんにちは [[name]]",
				translations: { "en-US": { text: "Hello" } },
				variables: {
					name: {
						type: "string",
						trust: "trusted",
						placement: "inline",
						encoding: "raw",
					},
				},
			},
		},
		{
			name: "extra placeholder in section translation",
			input: {
				variables: {
					name: {
						type: "string",
						trust: "trusted",
						placement: "inline",
						encoding: "raw",
					},
					detail: {
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
						text: "こんにちは [[name]]",
						translations: { "en-US": { text: "Hello [[name]] [[detail]]" } },
					},
				],
			},
		},
	])("rejects $name", ({ input }) => {
		expectDiagnostic(
			() =>
				parseAndResolveAuthoring(
					input,
					"contexts/example/greeting.context.toml",
					"example/greeting.context.toml",
					testConfig(),
					"development",
				),
			"S11TNEXT_TRANSLATION_PLACEHOLDER_MISMATCH",
		);
	});

	it.each([
		{
			name: "release profile",
			action: () =>
				parseAndResolveAuthoring(
					{ text: "正本" },
					"contexts/example/greeting.context.toml",
					"example/greeting.context.toml",
					testConfig(),
					"constructor",
				),
			code: "S11TNEXT_RELEASE_PROFILE_NOT_FOUND",
		},
		{
			name: "variable profile",
			action: () =>
				parseAndResolveAuthoring(
					{
						text: "[[value]]",
						variables: { value: { profile: "constructor" } },
					},
					"contexts/example/greeting.context.toml",
					"example/greeting.context.toml",
					testConfig(),
					"development",
				),
			code: "S11TNEXT_VARIABLE_PROFILE_NOT_FOUND",
		},
	])("does not resolve inherited object properties as a $name", ({ action, code }) => {
		expectDiagnostic(action, code);
	});

	it.each([
		{
			name: "non-object source",
			input: null,
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_SOURCE_INVALID",
		},
		{
			name: "unsupported root field",
			input: { text: "正本", unsupported: true },
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_SOURCE_INVALID",
		},
		{
			name: "invalid source suffix",
			input: { text: "正本" },
			sourcePath: "example/greeting.toml",
			code: "S11TNEXT_KEY_INVALID",
		},
		{
			name: "invalid source segment",
			input: { text: "正本" },
			sourcePath: "example/bad segment.context.toml",
			code: "S11TNEXT_KEY_INVALID",
		},
		{
			name: "explicit key",
			input: { key: "example:greeting", text: "正本" },
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_SOURCE_INVALID",
		},
		{
			name: "unsupported content kind",
			input: { content_kind: "json", text: "正本" },
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_SOURCE_INVALID",
		},
		{
			name: "missing content",
			input: {},
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_SOURCE_SHAPE_CONFLICT",
		},
		{
			name: "text and sections conflict",
			input: { text: "正本", sections: [] },
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_SOURCE_SHAPE_CONFLICT",
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
			code: "S11TNEXT_SOURCE_SHAPE_CONFLICT",
		},
		{
			name: "invalid locale",
			input: { text: "正本", translations: { invalid_locale: { text: "Source" } } },
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_SOURCE_INVALID",
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
			code: "S11TNEXT_SOURCE_INVALID",
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
			code: "S11TNEXT_UNSAFE_UNTRUSTED_RAW",
		},
		{
			name: "unsafe untrusted inline variable",
			input: {
				text: "[[value]]",
				variables: {
					value: {
						type: "string",
						trust: "untrusted",
						placement: "inline",
						encoding: "json-string",
					},
				},
			},
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_UNSAFE_UNTRUSTED_PLACEMENT",
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
			code: "S11TNEXT_ENCODING_TYPE_MISMATCH",
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
			code: "S11TNEXT_ENCODING_TYPE_MISMATCH",
		},
		{
			name: "invalid placeholder syntax",
			input: { text: "[[broken]" },
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_PLACEHOLDER_INVALID",
		},
		{
			name: "undeclared placeholder",
			input: { text: "[[missing]]" },
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_VARIABLE_UNDECLARED",
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
			code: "S11TNEXT_VARIABLE_UNUSED",
		},
		{
			name: "empty sections",
			input: { sections: [] },
			sourcePath: "example/greeting.context.toml",
			code: "S11TNEXT_SOURCE_INVALID",
		},
	])("rejects $name", ({ input, sourcePath, code }) => {
		expectDiagnostic(
			() =>
				parseAndResolveAuthoring(
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
		const document = parseAndResolveAuthoring(
			{ text: "正本" },
			"contexts/other/greeting.context.toml",
			"other/greeting.context.toml",
			config,
			"development",
		);
		expect(document.definition.owner).toBe("unowned");
		expectDiagnostic(
			() => validateResolvedDocuments([document, { ...document, file: "duplicate.toml" }]),
			"S11TNEXT_KEY_COLLISION",
		);
	});
});
