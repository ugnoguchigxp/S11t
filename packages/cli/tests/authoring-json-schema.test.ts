import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(
	readFileSync(new URL("../../../schemas/s11tnext-authoring.schema.json", import.meta.url), "utf8"),
) as object;
const validate = new Ajv2020({ strict: true }).compile(schema);

describe("authoring JSON Schema", () => {
	it("accepts the content-first fixture and rejects unsupported contract fields", () => {
		const source = parse(
			readFileSync(
				new URL("../../../fixtures/valid/content-first/contexts/structuredGeneration/repair.context.toml", import.meta.url),
				"utf8",
			),
		);
		expect(validate(source)).toBe(true);
		expect(validate({ ...source, schema_version: 1 })).toBe(false);
		expect(validate({ ...source, key: "legacy.override" })).toBe(false);
	});

	it("accepts section profiles and rejects enforcement claims", () => {
		expect(
			validate({
				sections: [
					{
						id: "user.context",
						profile: "user.overlay",
						omit_if_empty: true,
						text: "[[userContext]]",
					},
				],
				variables: {
					userContext: {
						required: false,
						type: "string",
						trust: "untrusted",
						placement: "delimited-context",
						encoding: "delimited-text",
					},
				},
			}),
		).toBe(true);
		expect(
			validate({
				sections: [
					{
						id: "unsafe.claim",
						kind: "instruction",
						severity: "must",
						enforcement: "host",
						optimizable: false,
						text: "Claim",
					},
				],
			}),
		).toBe(false);
	});

	it("accepts document source locale overrides and rejects invalid locale IDs", () => {
		expect(validate({ source_locale: "fr-FR", text: "Bonjour" })).toBe(true);
		expect(validate({ source_locale: "not a locale", text: "Bonjour" })).toBe(false);
	});

	it("accepts system and user message roles and rejects unsupported values", () => {
		expect(validate({ message_role: "system", text: "System" })).toBe(true);
		expect(validate({ message_role: "user", text: "User" })).toBe(true);
		for (const message_role of ["assistant", 1, true, [], {}]) {
			expect(validate({ message_role, text: "Invalid" })).toBe(false);
		}
	});
});
