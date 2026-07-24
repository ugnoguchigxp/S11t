import { describe, expect, it } from "vitest";

import {
	digestMismatch,
	renderSection,
	valuesRecord,
} from "../src/catalog-shared.js";
import { S11tnextError } from "../src/diagnostics.js";

describe("catalog internal guards", () => {
	it("reports digest mismatches with the stable error contract", () => {
		expect(() => digestMismatch(["catalogDigest"], "Catalog")).toThrowError(
			expect.objectContaining<S11tnextError>({
				code: "S11TNEXT_ARTIFACT_DIGEST_MISMATCH",
				path: ["catalogDigest"],
			}),
		);
	});

	it("accepts only plain runtime value records", () => {
		expect(valuesRecord(Object.create(null))).toEqual({});
		for (const value of [null, [], new Date()]) {
			expect(() => valuesRecord(value)).toThrowError(
				expect.objectContaining<S11tnextError>({ code: "S11TNEXT_VALUE_INVALID" }),
			);
		}
	});

	it("fails closed when a compiled segment has no encoded value", () => {
		expect(() =>
			renderSection(
				{ segments: [{ type: "variable", name: "missing" }] },
				{},
			),
		).toThrowError(expect.objectContaining<S11tnextError>({ code: "S11TNEXT_ARTIFACT_INVALID" }));
	});
});
