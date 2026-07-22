import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(
	readFileSync(new URL("../../../schemas/s11t-authoring-v2.schema.json", import.meta.url), "utf8"),
) as object;
const validate = new Ajv2020({ strict: true }).compile(schema);

describe("authoring v2 JSON Schema", () => {
	it("accepts the content-first fixture and rejects v1 metadata", () => {
		const source = parse(
			readFileSync(
				new URL("../../../fixtures/valid/content-first/contexts/structuredGeneration/repair.context.toml", import.meta.url),
				"utf8",
			),
		);
		expect(validate(source)).toBe(true);
		expect(validate({ ...source, schema_version: 1 })).toBe(false);
	});
});
