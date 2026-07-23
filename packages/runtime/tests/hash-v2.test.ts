import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CanonicalContextDefinitionV2 } from "../src/canonical-definition-v2.js";
import {
	hashArtifactV2,
	hashCatalogV2,
	hashDefinitionV2,
	hashPolicyV2,
	hashReleaseV2,
} from "../src/hash-v2.js";
import type { S11tCompiledSectionV2 } from "../src/types.js";

type GoldenV2 = {
	definitionHash: string;
	artifactHashes: Record<string, string>;
	releaseDigest: string;
	policyDigest: string;
	catalogDigest: string;
};

const golden = JSON.parse(
	readFileSync(new URL("./golden/hash-v2.json", import.meta.url), "utf8"),
) as GoldenV2;

const definition: CanonicalContextDefinitionV2 = {
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

const sections: Record<string, S11tCompiledSectionV2[]> = {
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

describe("hash contract v2", () => {
	it("matches all v2 golden identity vectors", () => {
		const definitionHash = hashDefinitionV2(definition);
		const artifactHashes = Object.fromEntries(
			Object.entries(sections).map(([locale, compiledSections]) => [
				locale,
				hashArtifactV2({ key: definition.key, locale, sections: compiledSections }),
			]),
		);
		const releaseDigest = hashReleaseV2({
			key: definition.key,
			compilerVersion: "0.0.0",
			definitionHash,
			artifactHashes,
		});
		const policyDigest = hashPolicyV2({
			releaseProfile: "production",
			requiredLocales: { [definition.key]: definition.requiredLocales },
		});
		const catalogDigest = hashCatalogV2({
			compilerVersion: "0.0.0",
			policyDigest,
			releaseDigests: { [definition.key]: releaseDigest },
			aliases: { "example:greeting": definition.key },
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
			hashPolicyV2({
				releaseProfile: "production",
				requiredLocales: { "z.last": ["ja-JP"], "a.first": ["en-US"] },
			}),
		).toBe(
			hashPolicyV2({
				releaseProfile: "production",
				requiredLocales: { "a.first": ["en-US"], "z.last": ["ja-JP"] },
			}),
		);
		expect(
			hashCatalogV2({
				compilerVersion: "0.0.0",
				policyDigest: golden.policyDigest,
				releaseDigests: { "z.last": "b", "a.first": "a" },
				aliases: { "z:last": "z.last", "a:first": "a.first" },
			}),
		).toBe(
			hashCatalogV2({
				compilerVersion: "0.0.0",
				policyDigest: golden.policyDigest,
				releaseDigests: { "a.first": "a", "z.last": "b" },
				aliases: { "a:first": "a.first", "z:last": "z.last" },
			}),
		);
	});
});
