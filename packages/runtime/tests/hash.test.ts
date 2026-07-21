import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/canonical-json.js";
import { normalizeNewlines, type CanonicalContextDefinition } from "../src/canonical-definition.js";
import {
	hashArtifact,
	hashCatalog,
	hashDefinition,
	hashRelease,
	hashRendered,
	sha256Utf8,
} from "../src/hash.js";
import type { S11tCompiledSectionV1 } from "../src/types.js";

type Golden = {
	canonical: string;
	definitionHash: string;
	artifactHash: string;
	releaseDigest: string;
	catalogDigest: string;
	renderedHash: string;
};

const golden = JSON.parse(
	readFileSync(new URL("./golden/hash-v1.json", import.meta.url), "utf8"),
) as Golden;

function definition(text = "Hello, [[name]]."): CanonicalContextDefinition {
	return {
		id: "example:greeting",
		version: "1.0.0",
		owner: "examples",
		output: "text",
		sourceLocale: "en-US",
		requiredLocales: ["en-US"],
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
				locales: { "en-US": text },
			},
		],
	};
}

const sections: S11tCompiledSectionV1[] = [
	{
		id: "context.text",
		kind: "instruction",
		severity: "must",
		enforcement: "prompt",
		optimizable: false,
		segments: [
			{ type: "literal", value: "Hello, " },
			{ type: "variable", name: "name" },
			{ type: "literal", value: ".\n" },
		],
	},
];

describe("canonical JSON", () => {
	it("sorts object keys, preserves array order and uses JSON number rendering", () => {
		expect(
			canonicalJson({ z: 1, a: "line break", array: [true, null, { "β": "日本語", a: -0 }] }),
		).toBe(golden.canonical);
	});

	it.each([
		["undefined", { value: undefined }],
		["non-finite", { value: Number.POSITIVE_INFINITY }],
		["class instance", new Date(0)],
	])("rejects %s", (_name, value) => {
		expect(() => canonicalJson(value as never)).toThrow(TypeError);
	});

	it("rejects cycles", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => canonicalJson(cyclic as never)).toThrow(/cyclic/);
	});

	it("rejects sparse arrays and accessors", () => {
		const sparse = new Array(1);
		expect(() => canonicalJson(sparse as never)).toThrow(/sparse/);
		const accessor = Object.defineProperty({}, "value", {
			enumerable: true,
			get: () => 1,
		});
		expect(() => canonicalJson(accessor as never)).toThrow(/accessors/);
	});
});

describe("hash contract", () => {
	it("matches the portable SHA-256 implementation with Node crypto", () => {
		const input = "S11t 日本語 🌍";
		const expected = `sha256:${createHash("sha256").update(input, "utf8").digest("hex")}`;
		expect(sha256Utf8(input)).toBe(expected);
	});

	it("matches all v1 golden identity vectors", () => {
		const definitionHash = hashDefinition(definition());
		const artifactHash = hashArtifact({ id: "example:greeting", locale: "en-US", sections });
		const releaseDigest = hashRelease({
			id: "example:greeting",
			version: "1.0.0",
			schemaVersion: 1,
			compilerVersion: "0.0.0",
			definitionHash,
			artifactHashes: { "en-US": artifactHash },
		});
		const catalogDigest = hashCatalog({
			schemaVersion: 1,
			compilerVersion: "0.0.0",
			defaultLocale: "en-US",
			releaseDigests: { "example:greeting": releaseDigest },
		});

		expect({
			definitionHash,
			artifactHash,
			releaseDigest,
			catalogDigest,
			renderedHash: hashRendered('Hello, "世界".\n'),
		}).toEqual({
			definitionHash: golden.definitionHash,
			artifactHash: golden.artifactHash,
			releaseDigest: golden.releaseDigest,
			catalogDigest: golden.catalogDigest,
			renderedHash: golden.renderedHash,
		});
	});

	it("normalizes source newlines before definition hashing", () => {
		expect(hashDefinition(definition(normalizeNewlines("one\r\ntwo\rthree")))).toBe(
			hashDefinition(definition("one\ntwo\nthree")),
		);
	});

	it("treats semantic and Unicode byte changes as identity changes", () => {
		expect(hashDefinition(definition("first"))).not.toBe(hashDefinition(definition("second")));
		expect(hashDefinition(definition("é"))).not.toBe(hashDefinition(definition("é")));

		const twoSections = definition();
		twoSections.sections.push({
			id: "second",
			kind: "runtime-fact",
			severity: "should",
			enforcement: "prompt",
			optimizable: false,
			locales: { "en-US": "Second" },
		});
		const reversed = { ...twoSections, sections: [...twoSections.sections].reverse() };
		expect(hashDefinition(twoSections)).not.toBe(hashDefinition(reversed));
		expect(
			hashArtifact({ id: "example:greeting", locale: "en-US", sections }),
		).not.toBe(hashArtifact({ id: "example:greeting", locale: "ja-JP", sections }));
	});

	it("includes compiler version and default locale at their identity layers", () => {
		const releaseBase = {
			id: "example:greeting",
			version: "1.0.0",
			schemaVersion: 1 as const,
			definitionHash: golden.definitionHash,
			artifactHashes: { "en-US": golden.artifactHash },
		};
		expect(hashRelease({ ...releaseBase, compilerVersion: "0.0.0" })).not.toBe(
			hashRelease({ ...releaseBase, compilerVersion: "0.0.1" }),
		);
		const catalogBase = {
			schemaVersion: 1 as const,
			compilerVersion: "0.0.0",
			releaseDigests: { "example:greeting": golden.releaseDigest },
		};
		expect(hashCatalog({ ...catalogBase, defaultLocale: "en-US" })).not.toBe(
			hashCatalog({ ...catalogBase, defaultLocale: "ja-JP" }),
		);
	});

	it("sorts locale and context identity pairs", () => {
		const base = {
			id: "example:greeting",
			version: "1.0.0",
			schemaVersion: 1 as const,
			compilerVersion: "0.0.0",
			definitionHash: golden.definitionHash,
		};
		expect(
			hashRelease({ ...base, artifactHashes: { "ja-JP": "b", "en-US": "a" } }),
		).toBe(hashRelease({ ...base, artifactHashes: { "en-US": "a", "ja-JP": "b" } }));
		expect(
			hashCatalog({
				schemaVersion: 1,
				compilerVersion: "0.0.0",
				defaultLocale: "en-US",
				releaseDigests: { "z:last": "b", "a:first": "a" },
			}),
		).toBe(
			hashCatalog({
				schemaVersion: 1,
				compilerVersion: "0.0.0",
				defaultLocale: "en-US",
				releaseDigests: { "a:first": "a", "z:last": "b" },
			}),
		);
	});

	it("keeps provenance outside semantic catalog identity", () => {
		const identity = {
			schemaVersion: 1 as const,
			compilerVersion: "0.0.0",
			defaultLocale: "en-US",
			releaseDigests: { "example:greeting": golden.releaseDigest },
		};
		const withDifferentProvenance = {
			...identity,
			createdFrom: { configPath: "/different/root/config.toml", sourceFiles: ["temporary"] },
		};
		expect(hashCatalog(withDifferentProvenance)).toBe(hashCatalog(identity));
	});
});
