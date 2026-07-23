import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
	compileCatalogV3,
	type CanonicalContextDefinitionV2,
} from "../src/compiler.js";
import { isCatalogArtifactV3 } from "../src/artifact-schema.js";

function artifact() {
	const definition: CanonicalContextDefinitionV2 = {
		key: "example.greeting",
		owner: "examples",
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
	return compileCatalogV3([definition], {
		releaseProfile: "development",
		provenance: {
			configPath: "s11t.config.toml",
			sourceFiles: ["contexts/example.context.toml"],
		},
	});
}

const v2Schema = JSON.parse(
	readFileSync(
		new URL("../../../schemas/s11t-artifact-v2.schema.json", import.meta.url),
		"utf8",
	),
) as object;
const v3Schema = JSON.parse(
	readFileSync(
		new URL("../../../schemas/s11t-artifact-v3.schema.json", import.meta.url),
		"utf8",
	),
) as object;
const ajv = new Ajv2020({ strict: true });
ajv.addSchema(v2Schema);
const validateJsonSchema = ajv.compile(v3Schema);

describe("artifact schema v3", () => {
	it("keeps runtime structural validation and JSON Schema aligned", () => {
		const input = artifact();
		expect(isCatalogArtifactV3(input)).toBe(true);
		expect(validateJsonSchema(input)).toBe(true);

		input.contexts["example.greeting"]!.variables.value!.placement = "inline";
		expect(isCatalogArtifactV3(input)).toBe(false);
		expect(validateJsonSchema(input)).toBe(false);
	});
});
