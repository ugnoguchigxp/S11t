import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CanonicalContextDefinition } from "../src/canonical-definition.js";
import {
	hashArtifact,
	hashCatalog,
	hashDefinition,
	hashPromptMessage,
	hashPolicy,
	hashRelease,
	verifyPromptMessageHash,
} from "../src/hash.js";
import type { S11tnextCompiledSection } from "../src/types.js";

type Golden = {
	definitionHash: string;
	artifactHashes: Record<string, string>;
	releaseDigest: string;
	policyDigest: string;
	catalogDigest: string;
};

const golden = JSON.parse(
	readFileSync(new URL("./golden/hash.json", import.meta.url), "utf8"),
) as Golden;

const definition: CanonicalContextDefinition = {
	key: "example.greeting",
	owner: "examples",
	contentKind: "text",
	messageRole: "system",
	sourceLocale: "en-US",
	requiredLocales: ["en-US", "ja-JP"],
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
			optimizable: false,
			omitIfEmpty: false,
			locales: { "en-US": "Hello [[name]]", "ja-JP": "こんにちは [[name]]" },
		},
	],
};

const sections: Record<string, S11tnextCompiledSection[]> = {
	"en-US": [
		{
			id: "context.text",
			kind: "instruction",
			severity: "must",
			optimizable: false,
			omitIfEmpty: false,
			segments: [
				{ type: "literal", value: "Hello " },
				{ type: "variable", name: "name" },
			],
		},
	],
	"ja-JP": [
		{
			id: "context.text",
			kind: "instruction",
			severity: "must",
			optimizable: false,
			omitIfEmpty: false,
			segments: [
				{ type: "literal", value: "こんにちは " },
				{ type: "variable", name: "name" },
			],
		},
	],
};

describe("hash contract", () => {
	it("matches all golden identity vectors", () => {
		const definitionHash = hashDefinition(definition);
		const artifactHashes = Object.fromEntries(
			Object.entries(sections).map(([locale, compiledSections]) => [
				locale,
				hashArtifact({
					key: definition.key,
					locale,
					sections: compiledSections,
				}),
			]),
		);
		const releaseDigest = hashRelease({
			key: definition.key,
			compilerVersion: "0.0.0",
			definitionHash,
			artifactHashes,
		});
		const policyDigest = hashPolicy({
			releaseProfile: "production",
			requiredLocales: { [definition.key]: definition.requiredLocales },
		});
		const catalogDigest = hashCatalog({
			compilerVersion: "0.0.0",
			policyDigest,
			releaseDigests: { [definition.key]: releaseDigest },
		});

		expect({
			definitionHash,
			artifactHashes,
			releaseDigest,
			policyDigest,
			catalogDigest,
		}).toEqual(golden);
	});

	it("sorts policy and release identity pairs", () => {
		expect(
			hashPolicy({
				releaseProfile: "production",
				requiredLocales: { "z.last": ["ja-JP"], "a.first": ["en-US"] },
			}),
		).toBe(
			hashPolicy({
				releaseProfile: "production",
				requiredLocales: { "a.first": ["en-US"], "z.last": ["ja-JP"] },
			}),
		);
		expect(
			hashCatalog({
				compilerVersion: "0.0.0",
				policyDigest: golden.policyDigest,
				releaseDigests: { "z.last": "b", "a.first": "a" },
			}),
		).toBe(
			hashCatalog({
				compilerVersion: "0.0.0",
				policyDigest: golden.policyDigest,
				releaseDigests: { "a.first": "a", "z.last": "b" },
			}),
		);
	});

	it("binds prompt message hashes to both role and text", () => {
		const value = { role: "user" as const, text: "Review this\nmessage" };
		const digest = hashPromptMessage(value);

		expect(verifyPromptMessageHash(value, digest)).toBe(true);
		expect(
			verifyPromptMessageHash({ role: "system", text: value.text }, digest),
		).toBe(false);
		expect(
			verifyPromptMessageHash({ role: value.role, text: `${value.text}!` }, digest),
		).toBe(false);
	});
});
