import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(
	readFileSync(new URL("../../../schemas/s11t-authoring-v1.schema.json", import.meta.url), "utf8"),
) as object;
const validate = new Ajv2020({ strict: true }).compile(schema);

function fixture(path: string): unknown {
	return parse(readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8"));
}

describe("public authoring JSON Schema", () => {
	it.each([
		"valid/simple/contexts/repair.context.toml",
		"valid/sectioned/contexts/identity.context.toml",
		"valid/multilingual/contexts/greeting.context.toml",
	])("accepts %s", (path) => {
		expect(validate(fixture(path))).toBe(true);
	});

	it.each([
		"invalid/unsafe-untrusted-raw/contexts/unsafe.context.toml",
		"invalid/unsupported-output/contexts/messages.context.toml",
	])("rejects structurally invalid %s", (path) => {
		expect(validate(fixture(path))).toBe(false);
	});

	it("rejects SemVer prerelease numeric identifiers with leading zeroes", () => {
		const document = structuredClone(
			fixture("valid/simple/contexts/repair.context.toml"),
		) as Record<string, unknown>;
		const context = document.context as Record<string, unknown>;
		context.version = "1.0.0-01";
		expect(validate(document)).toBe(false);
	});
});
