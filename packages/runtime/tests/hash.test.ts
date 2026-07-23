import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CanonicalContextDefinition } from "../src/canonical-definition.js";
import {
	hashArtifact,
	hashCatalog,
	hashDefinition,
	hashPolicy,
	hashRelease,
} from "../src/hash.js";
import type { S11tCompiledSection } from "../src/types.js";

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
			enforcement: "prompt",
			optimizable: false,
			locales: { "en-US": "Hello [[name]]", "ja-JP": "こんにちは [[name]]" },
		},
	],
};

const sections: Record<string, S11tCompiledSection[]> = {
	"en-US": [
		{
			id: "context.text",
			kind: "instruction",
			severity: "must",
			enforcement: "prompt",
			optimizable: false,
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
			enforcement: "prompt",
			optimizable: false,
			segments: [
				{ type: "literal", value: "こんにちは " },
				{ type: "variable", name: "name" },
			],
		},
	],
};

describe("hash contract", () => {
	it("matches all golden identity vectors", () => {
		const renderingContract = "delimited-context" as const;
		const definitionHash = hashDefinition(definition, renderingContract);
		const artifactHashes = Object.fromEntries(
			Object.entries(sections).map(([locale, compiledSections]) => [
				locale,
				hashArtifact({
					key: definition.key,
					locale,
					sections: compiledSections,
					renderingContract,
				}),
			]),
		);
		const releaseDigest = hashRelease({
			key: definition.key,
			compilerVersion: "0.0.0",
			definitionHash,
			artifactHashes,
			renderingContract,
		});
		const policyDigest = hashPolicy({
			releaseProfile: "production",
			requiredLocales: { [definition.key]: definition.requiredLocales },
			renderingContract,
		});
		const catalogDigest = hashCatalog({
			compilerVersion: "0.0.0",
			policyDigest,
			releaseDigests: { [definition.key]: releaseDigest },
			aliases: { "example.greetingAlias": definition.key },
			renderingContract,
		});

		expect({
			definitionHash,
			artifactHashes,
			releaseDigest,
			policyDigest,
			catalogDigest,
		}).toEqual(golden);
	});

	it("sorts policy, release and alias identity pairs", () => {
		expect(
			hashPolicy({
				releaseProfile: "production",
				requiredLocales: { "z.last": ["ja-JP"], "a.first": ["en-US"] },
				renderingContract: "delimited-context",
			}),
		).toBe(
			hashPolicy({
				releaseProfile: "production",
				requiredLocales: { "a.first": ["en-US"], "z.last": ["ja-JP"] },
				renderingContract: "delimited-context",
			}),
		);
		expect(
			hashCatalog({
				compilerVersion: "0.0.0",
				policyDigest: golden.policyDigest,
				releaseDigests: { "z.last": "b", "a.first": "a" },
				aliases: { "z.alias": "z.last", "a.alias": "a.first" },
				renderingContract: "delimited-context",
			}),
		).toBe(
			hashCatalog({
				compilerVersion: "0.0.0",
				policyDigest: golden.policyDigest,
				releaseDigests: { "a.first": "a", "z.last": "b" },
				aliases: { "a.alias": "a.first", "z.alias": "z.last" },
				renderingContract: "delimited-context",
			}),
		);
	});
});
