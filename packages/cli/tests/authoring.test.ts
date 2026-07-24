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
const mixedSourceFixtureRoot = fileURLToPath(
	new URL("../../../fixtures/valid/mixed-source/", import.meta.url),
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
			messageRole: "system",
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

	it("defaults message role to system and preserves explicit user roles", () => {
		const system = parseAndResolveAuthoring(
			{ text: "System message" },
			"contexts/example/system.context.toml",
			"example/system.context.toml",
			testConfig(),
			"development",
		);
		const user = parseAndResolveAuthoring(
			{
				message_role: "user",
				sections: [
					{
						id: "message.input",
						kind: "runtime-fact",
						severity: "must",
						optimizable: false,
						text: "User message",
					},
				],
			},
			"contexts/example/input.context.toml",
			"example/input.context.toml",
			testConfig(),
			"development",
		);

		expect(system.definition.messageRole).toBe("system");
		expect(system.origins.messageRole).toBe("built-in:system");
		expect(user.definition.messageRole).toBe("user");
		expect(user.origins.messageRole).toContain("#message_role");
	});

	it.each(["assistant", 1, true, [], {}])(
		"rejects invalid message role %j",
		(message_role) => {
			expectDiagnostic(
				() =>
					parseAndResolveAuthoring(
						{ message_role, text: "Invalid role" },
						"contexts/example/invalid.context.toml",
						"example/invalid.context.toml",
						testConfig(),
						"development",
					),
				"S11TNEXT_MESSAGE_ROLE_INVALID",
			);
		},
	);

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

	it("resolves optional variables, section profiles, and keyspace locale policy", () => {
		const config = parseProjectConfig({
			source_dir: "contexts",
			out_dir: "generated",
			authoring: { source_locale: "ja-JP" },
			governance: { require_owner: true },
			keyspaces: { example: { owner: "examples" } },
			release_profiles: {
				development: {
					required_locales: ["$source"],
					required_locales_by_keyspace: { example: ["$source", "en-US"] },
				},
			},
			variable_profiles: {
				"trusted.text": {
					type: "string",
					trust: "trusted",
					placement: "inline",
					encoding: "raw",
				},
			},
			section_profiles: {
				optional: {
					kind: "runtime-fact",
					severity: "may",
					optimizable: true,
				},
			},
		});
		const document = parseAndResolveAuthoring(
			{
				variables: {
					detail: { profile: "trusted.text", required: false },
				},
				sections: [
					{
						id: "optional.detail",
						profile: "optional",
						omit_if_empty: true,
						text: "詳細: [[detail]]",
						translations: { "en-US": { text: "Detail: [[detail]]" } },
					},
				],
			},
			"contexts/example/greeting.context.toml",
			"example/greeting.context.toml",
			config,
			"development",
		);

		expect(document.definition.requiredLocales).toEqual(["ja-JP", "en-US"]);
		expect(document.definition.variables.detail?.required).toBe(false);
		expect(document.definition.sections[0]).toMatchObject({
			kind: "runtime-fact",
			severity: "may",
			optimizable: true,
			omitIfEmpty: true,
		});
		expect(document.origins.requiredLocales).toBe(
			"release_profiles.development.required_locales_by_keyspace.example",
		);
	});

	it("resolves source locale from document, keyspace, then project defaults", () => {
		const config = parseProjectConfig({
			source_dir: "contexts",
			out_dir: "generated",
			authoring: { source_locale: "ja-JP" },
			governance: { require_owner: true },
			keyspaces: {
				example: { owner: "examples", source_locale: "en-US" },
				"example.french": { owner: "examples", source_locale: "fr-FR" },
			},
			release_profiles: { development: { required_locales: ["$source"] } },
		});
		const fromKeyspace = parseAndResolveAuthoring(
			{ text: "Hello" },
			"contexts/example/greeting.context.toml",
			"example/greeting.context.toml",
			config,
			"development",
		);
		const fromLongestKeyspace = parseAndResolveAuthoring(
			{ text: "Bonjour" },
			"contexts/example/french/greeting.context.toml",
			"example/french/greeting.context.toml",
			config,
			"development",
		);
		const fromDocument = parseAndResolveAuthoring(
			{ source_locale: "de-DE", text: "Hallo" },
			"contexts/example/greeting.context.toml",
			"example/greeting.context.toml",
			config,
			"development",
		);

		expect(fromKeyspace.definition.sourceLocale).toBe("en-US");
		expect(fromKeyspace.definition.requiredLocales).toEqual(["en-US"]);
		expect(fromKeyspace.origins.sourceLocale).toBe("keyspaces.example.source_locale");
		expect(fromLongestKeyspace.definition.sourceLocale).toBe("fr-FR");
		expect(fromDocument.definition.sourceLocale).toBe("de-DE");
		expect(fromDocument.origins.sourceLocale).toContain("#source_locale");
	});

	it.each([
		{
			name: "non-boolean optional variable flag",
			input: {
				text: "[[value]]",
				variables: {
					value: {
						required: "no",
						type: "string",
						trust: "trusted",
						placement: "inline",
						encoding: "raw",
					},
				},
			},
			config: testConfig(),
			code: "S11TNEXT_SOURCE_INVALID",
		},
		{
			name: "omit_if_empty without a placeholder",
			input: {
				sections: [
					{
						id: "optional.detail",
						kind: "runtime-fact",
						severity: "may",
						optimizable: true,
						omit_if_empty: true,
						text: "No variables",
					},
				],
			},
			config: testConfig(),
			code: "S11TNEXT_SOURCE_INVALID",
		},
		{
			name: "section profile combined with inline metadata",
			input: {
				sections: [
					{
						id: "optional.detail",
						profile: "optional",
						kind: "runtime-fact",
						text: "Detail",
					},
				],
			},
			config: parseProjectConfig({
				source_dir: "contexts",
				out_dir: "generated",
				authoring: { source_locale: "ja-JP" },
				governance: { require_owner: true },
				keyspaces: { example: { owner: "examples" } },
				release_profiles: { development: { required_locales: ["$source"] } },
				section_profiles: {
					optional: {
						kind: "runtime-fact",
						severity: "may",
						optimizable: true,
					},
				},
			}),
			code: "S11TNEXT_SOURCE_INVALID",
		},
		{
			name: "unknown section profile",
			input: {
				sections: [
					{ id: "optional.detail", profile: "missing", text: "Detail" },
				],
			},
			config: testConfig(),
			code: "S11TNEXT_SECTION_PROFILE_NOT_FOUND",
		},
		{
			name: "incomplete inline section metadata",
			input: {
				sections: [
					{
						id: "optional.detail",
						kind: "runtime-fact",
						text: "Detail",
					},
				],
			},
			config: testConfig(),
			code: "S11TNEXT_SOURCE_INVALID",
		},
	])("rejects $name", ({ input, config, code }) => {
		expectDiagnostic(
			() =>
				parseAndResolveAuthoring(
					input,
					"contexts/example/greeting.context.toml",
					"example/greeting.context.toml",
					config,
					"development",
				),
			code,
		);
	});

	it("resolves optional multiline variables and named section profiles", () => {
		const config = parseProjectConfig({
			source_dir: "contexts",
			out_dir: "generated",
			authoring: { source_locale: "ja-JP" },
			governance: { require_owner: true },
			keyspaces: { example: { owner: "examples" } },
			release_profiles: {
				development: { required_locales: ["$source"] },
			},
			variable_profiles: {
				"untrusted.multiline": {
					type: "string",
					trust: "untrusted",
					placement: "delimited-context",
					encoding: "delimited-text",
				},
			},
			section_profiles: {
				"user.overlay": {
					kind: "overlay",
					severity: "may",
					optimizable: false,
				},
			},
		});
		const document = parseAndResolveAuthoring(
			{
				variables: {
					userContext: {
						profile: "untrusted.multiline",
						required: false,
					},
				},
				sections: [
					{
						id: "user.context",
						profile: "user.overlay",
						omit_if_empty: true,
						text: "<USER_SYSTEM_CONTEXT>\n[[userContext]]\n</USER_SYSTEM_CONTEXT>",
					},
				],
			},
			"contexts/example/overlay.context.toml",
			"example/overlay.context.toml",
			config,
			"development",
		);

		expect(document.definition.variables.userContext).toMatchObject({
			required: false,
			encoding: "delimited-text",
		});
		expect(document.definition.sections[0]).toMatchObject({
			kind: "overlay",
			severity: "may",
			optimizable: false,
			omitIfEmpty: true,
		});
	});

	it("applies locale requirements to the longest matching keyspace", () => {
		const config = parseProjectConfig({
			source_dir: "contexts",
			out_dir: "generated",
			authoring: { source_locale: "ja-JP" },
			governance: { require_owner: true },
			keyspaces: {
				chat: { owner: "chat" },
				review: { owner: "review" },
			},
			release_profiles: {
				production: {
					required_locales: ["$source"],
					required_locales_by_keyspace: {
						chat: ["$source", "en-US"],
						"chat.internal": ["$source"],
						review: ["$source"],
					},
				},
			},
		});

		expectDiagnostic(
			() =>
				parseAndResolveAuthoring(
					{ text: "チャット" },
					"contexts/chat/system.context.toml",
					"chat/system.context.toml",
					config,
					"production",
				),
			"S11TNEXT_TRANSLATION_MISSING",
		);
		const chat = parseAndResolveAuthoring(
			{
				text: "チャット",
				translations: { "en-US": { text: "Chat" } },
			},
			"contexts/chat/system.context.toml",
			"chat/system.context.toml",
			config,
			"production",
		);
		const review = parseAndResolveAuthoring(
			{ text: "レビュー" },
			"contexts/review/system.context.toml",
			"review/system.context.toml",
			config,
			"production",
		);
		const internalChat = parseAndResolveAuthoring(
			{ text: "内部チャット" },
			"contexts/chat/internal/system.context.toml",
			"chat/internal/system.context.toml",
			config,
			"production",
		);

		expect(chat.definition.requiredLocales).toEqual(["ja-JP", "en-US"]);
		expect(review.definition.requiredLocales).toEqual(["ja-JP"]);
		expect(internalChat.definition.requiredLocales).toEqual(["ja-JP"]);
		expect(chat.origins.requiredLocales).toBe(
			"release_profiles.production.required_locales_by_keyspace.chat",
		);
	});

	it("reports resolved values and their top-level origins", () => {
		const result = inspectContext("structuredGeneration.repair", {
			cwd: fixtureRoot,
			releaseProfile: "production",
			resolved: true,
		}) as Record<string, unknown>;
		expect(result).toMatchObject({
			key: "structuredGeneration.repair",
			messageRole: "system",
			sourceLocale: "ja-JP",
			releaseProfile: "production",
			origins: {
				messageRole: "built-in:system",
				sourceLocale: "authoring.source_locale",
				requiredLocales: "release_profiles.production.required_locales",
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
			sourceLocales: ["ja-JP"],
			sourceLocalesByContext: {
				"rollout.direct": "ja-JP",
				"rollout.fallback": "ja-JP",
				"rollout.missing": "ja-JP",
			},
			requestedLocale: "en-US",
			fallbackLocales: ["fr-FR"],
			requiredLocales: ["ja-JP"],
			requiredLocalesByContext: {
				"rollout.direct": ["ja-JP"],
				"rollout.fallback": ["ja-JP"],
				"rollout.missing": ["ja-JP"],
			},
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

	it("reports effective source locales for mixed-locale catalogs", () => {
		expect(
			inspectCoverage({
				cwd: mixedSourceFixtureRoot,
				releaseProfile: "development",
				locale: "en-US",
				fallbackLocales: ["fr-FR"],
			}),
		).toEqual({
			releaseProfile: "development",
			sourceLocale: "ja-JP",
			sourceLocales: ["en-US", "fr-FR"],
			sourceLocalesByContext: {
				"english.greeting": "en-US",
				"french.greeting": "fr-FR",
			},
			requestedLocale: "en-US",
			fallbackLocales: ["fr-FR"],
			requiredLocales: ["en-US", "fr-FR"],
			requiredLocalesByContext: {
				"english.greeting": ["en-US"],
				"french.greeting": ["fr-FR"],
			},
			requiredCoverageSatisfied: true,
			totals: { contexts: 2, direct: 1, fallback: 1, missing: 0 },
			direct: { keys: ["english.greeting"] },
			fallback: {
				keys: ["french.greeting"],
				resolvedByLocale: { "fr-FR": ["french.greeting"] },
			},
			missing: { keys: [] },
		});
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

	it("parses generated TypeScript indentation", () => {
		const spaces = parseProjectConfig({
			source_dir: "contexts",
			out_dir: "generated",
			authoring: { source_locale: "ja-JP" },
			governance: { require_owner: true },
			keyspaces: { example: { owner: "examples" } },
			release_profiles: { development: { required_locales: ["$source"] } },
			generation: { typescript_indent: 2 },
		});
		expect(spaces.generation.typeScriptIndent).toBe("  ");
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
					generation: { typescript_indent: 0 },
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
