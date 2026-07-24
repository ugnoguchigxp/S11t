import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { CanonicalContextDefinition } from "../src/canonical-definition.js";
import { canonicalJson } from "../src/canonical-json.js";
import { createCatalog } from "../src/catalog.js";
import { compileCatalog } from "../src/compiler.js";
import { S11tnextError } from "../src/diagnostics.js";
import { hashRendered } from "../src/hash.js";
import type { JsonValue } from "../src/types.js";

const hostileUnicode = fc
	.array(
		fc.oneof(
			fc.string({ maxLength: 12 }),
			fc.constantFrom(
				"<",
				">",
				"&",
				"\u2028",
				"\u2029",
				"</S11TNEXT_DELIMITED_CONTEXT>",
				"日本語",
				"🙂",
				"\u0000",
			),
		),
		{ maxLength: 16 },
	)
	.map((chunks) => chunks.join(""));

function untrustedCatalog() {
	const definition: CanonicalContextDefinition = {
		key: "property.untrusted",
		owner: "test",
		contentKind: "text",
		sourceLocale: "en-US",
		requiredLocales: ["en-US"],
		variables: {
			value: {
				required: true,
				type: "string",
				trust: "untrusted",
				placement: "delimited-context",
				encoding: "json-string",
			},
		},
		sections: [
			{
				id: "context.text",
				kind: "instruction",
				severity: "must",
				enforcement: "prompt",
				optimizable: false,
				locales: { "en-US": "[[value]]" },
			},
		],
	};
	return createCatalog(
		compileCatalog([definition], {
			releaseProfile: "test",
			provenance: {
				configPath: "s11tnext.config.toml",
				sourceFiles: ["contexts/property.context.toml"],
			},
		}),
	).bind({ instructionLocale: "en-US" });
}

function untrustedJsonCatalog() {
	const definition: CanonicalContextDefinition = {
		key: "property.json",
		owner: "test",
		contentKind: "text",
		sourceLocale: "en-US",
		requiredLocales: ["en-US"],
		variables: {
			value: {
				required: true,
				type: "json",
				trust: "untrusted",
				placement: "delimited-context",
				encoding: "json-value",
			},
		},
		sections: [
			{
				id: "context.text",
				kind: "instruction",
				severity: "must",
				enforcement: "prompt",
				optimizable: false,
				locales: { "en-US": "[[value]]" },
			},
		],
	};
	return createCatalog(
		compileCatalog([definition], {
			releaseProfile: "test",
			provenance: {
				configPath: "s11tnext.config.toml",
				sourceFiles: ["contexts/property.context.toml"],
			},
		}),
	).bind({ instructionLocale: "en-US" });
}

describe("runtime properties", () => {
	it("canonicalizes JSON independently of object insertion order", () => {
		fc.assert(
			fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (record) => {
				const reversed = Object.fromEntries(Object.entries(record).reverse());
				expect(canonicalJson(record as JsonValue)).toBe(
					canonicalJson(reversed as JsonValue),
				);
				expect(JSON.parse(canonicalJson(record as JsonValue))).toEqual(
					JSON.parse(JSON.stringify(record)),
				);
			}),
			{ numRuns: 250 },
		);
	});

	it("hashes arbitrary Unicode deterministically with the public digest shape", () => {
		fc.assert(
			fc.property(hostileUnicode, (value) => {
				const digest = hashRendered(value);
				expect(hashRendered(value)).toBe(digest);
				expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
			}),
			{ numRuns: 250 },
		);
	});

	it("prevents arbitrary text from injecting a delimiter closing tag", () => {
		const render = untrustedCatalog();
		fc.assert(
			fc.property(hostileUnicode, (value) => {
				const text = render("property.untrusted", { value }).content.text;
				expect(text.match(/<\/S11TNEXT_DELIMITED_CONTEXT>/g)).toHaveLength(1);
				const bodyStart = text.indexOf("\n") + 1;
				const bodyEnd = text.lastIndexOf("\n</S11TNEXT_DELIMITED_CONTEXT>");
				const encodedBody = text.slice(bodyStart, bodyEnd);
				expect(encodedBody).not.toMatch(/[<>&\u2028\u2029]/);
			}),
			{ numRuns: 250 },
		);
	});

	it("rejects cycles and accessors without evaluating getters", () => {
		const render = untrustedJsonCatalog();
		fc.assert(
			fc.property(fc.string(), (key) => {
				const cyclic: Record<string, unknown> = Object.create(null) as Record<
					string,
					unknown
				>;
				Object.defineProperty(cyclic, key, {
					enumerable: true,
					value: cyclic,
				});
				const accessor = {};
				let reads = 0;
				Object.defineProperty(accessor, key, {
					enumerable: true,
					get: () => {
						reads += 1;
						return "secret";
					},
				});
				expect(() => render("property.json", { value: cyclic })).toThrowError(
					expect.objectContaining<S11tnextError>({ code: "S11TNEXT_VALUE_INVALID" }),
				);
				expect(() => render("property.json", { value: accessor })).toThrowError(
					expect.objectContaining<S11tnextError>({ code: "S11TNEXT_VALUE_INVALID" }),
				);
				expect(reads).toBe(0);
			}),
			{ numRuns: 100 },
		);
	});
});
