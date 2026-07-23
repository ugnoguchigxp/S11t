import { describe, expect, it } from "vitest";

import { createCatalog } from "../src/catalog.js";
import { compileCatalog, type CanonicalContextDefinition } from "../src/compiler.js";
import { S11tError } from "../src/diagnostics.js";

function context(
	key: string,
	type: "string" | "number" | "boolean" | "json",
	encoding: "raw" | "json-string" | "json-value",
): CanonicalContextDefinition {
	return {
		key,
		owner: "test",
		contentKind: "text",
		sourceLocale: "en-US",
		requiredLocales: ["en-US"],
		variables: {
			value: {
				required: true,
				type,
				trust: "trusted",
				placement: "inline",
				encoding,
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
}

function catalog() {
	return createCatalog(
		compileCatalog(
			[
				context("encoding.string", "string", "json-string"),
				context("encoding.json", "json", "json-value"),
				context("encoding.number", "number", "json-value"),
			],
			{
				releaseProfile: "test",
				provenance: { configPath: "s11t.config.toml", sourceFiles: ["contexts/all.context.toml"] },
			},
		),
	).bind({ instructionLocale: "en-US" });
}

describe("runtime encoding", () => {
	it("escapes HTML-like characters and Unicode separators in json-string", () => {
		expect(catalog()("encoding.string", { value: "<>&  \n" }).content.text).toBe(
			'"\\u003c\\u003e\\u0026\\u2028\\u2029\\n"\n',
		);
	});

	it("renders json-value using canonical JSON", () => {
		expect(catalog()("encoding.json", { value: { z: 1, a: [true, null] } }).content.text).toBe(
			'{"a":[true,null],"z":1}\n',
		);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, "1"])("rejects invalid number %s", (value) => {
		expect(() => catalog()("encoding.number", { value })).toThrowError(
			expect.objectContaining<S11tError>({ code: "S11T_VALUE_INVALID" }),
		);
	});

	it("does not persist rendered values in the manifest", () => {
		const secret = "sentinel-secret";
		const invocation = catalog()("encoding.string", { value: secret });
		expect(JSON.stringify(invocation.manifest)).not.toContain(secret);
	});

	it("rejects cyclic JSON values with a stable runtime error", () => {
		const value: Record<string, unknown> = {};
		value.self = value;
		expect(() => catalog()("encoding.json", { value })).toThrowError(
			expect.objectContaining<S11tError>({ code: "S11T_VALUE_INVALID" }),
		);
	});

	it("rejects sparse arrays and accessors as non-deterministic JSON values", () => {
		expect(() => catalog()("encoding.json", { value: new Array(1) })).toThrowError(
			expect.objectContaining<S11tError>({ code: "S11T_VALUE_INVALID" }),
		);
		const value = Object.defineProperty({}, "dynamic", {
			enumerable: true,
			get: () => "value",
		});
		expect(() => catalog()("encoding.json", { value })).toThrowError(
			expect.objectContaining<S11tError>({ code: "S11T_VALUE_INVALID" }),
		);
	});

	it("encodes a repeated runtime variable only once per invocation", () => {
		const definition = context("encoding.once", "string", "raw");
		definition.sections[0]!.locales["en-US"] = "[[value]][[value]]";
		const p = createCatalog(
			compileCatalog([definition], {
				releaseProfile: "test",
				provenance: {
					configPath: "s11t.config.toml",
					sourceFiles: ["contexts/once.context.toml"],
				},
			}),
		).bind({ instructionLocale: "en-US" });
		let reads = 0;
		const values = Object.defineProperty({}, "value", {
			enumerable: true,
			get: () => {
				reads += 1;
				return "x";
			},
		});
		expect(p("encoding.once", values).content.text).toBe("xx\n");
		expect(reads).toBe(1);
	});
});
