import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isCatalogArtifact } from "../src/artifact-schema.js";
import {
	compileCatalog,
	type CanonicalContextDefinition,
} from "../src/compiler.js";

function artifact() {
	const definition: CanonicalContextDefinition = {
		key: "example.greeting",
		owner: "examples",
		contentKind: "text",
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
				locales: { "en-US": "Hello [[name]]" },
			},
		],
	};
	return compileCatalog([definition], {
		releaseProfile: "development",
		provenance: {
			configPath: "s11tnext.config.toml",
			sourceFiles: ["contexts/example.context.toml"],
		},
	});
}

const schema = JSON.parse(
	readFileSync(
		new URL("../../../schemas/s11tnext-artifact.schema.json", import.meta.url),
		"utf8",
	),
) as object;
const validateJsonSchema = new Ajv2020({ strict: true }).compile(schema);

const mutationPaths = [
	["format"],
	["compilerVersion"],
	["releaseProfile"],
	["policyDigest"],
	["createdFrom"],
	["createdFrom", "configPath"],
	["createdFrom", "sourceFiles"],
	["contexts"],
	["contexts", "example.greeting", "key"],
	["contexts", "example.greeting", "owner"],
	["contexts", "example.greeting", "sourceLocale"],
	["contexts", "example.greeting", "requiredLocales"],
	["contexts", "example.greeting", "variables"],
	["contexts", "example.greeting", "variables", "name", "type"],
	["contexts", "example.greeting", "variables", "name", "trust"],
	["contexts", "example.greeting", "variables", "name", "placement"],
	["contexts", "example.greeting", "variables", "name", "encoding"],
	["contexts", "example.greeting", "locales"],
	["contexts", "example.greeting", "locales", "en-US", "artifactHash"],
	["contexts", "example.greeting", "locales", "en-US", "sections"],
	[
		"contexts",
		"example.greeting",
		"locales",
		"en-US",
		"sections",
		"0",
		"kind",
	],
	["contexts", "example.greeting", "definitionHash"],
	["contexts", "example.greeting", "releaseDigest"],
	["catalogDigest"],
	["unexpected"],
] as const;

function setPath(target: unknown, path: readonly string[], value: unknown): void {
	let current = target as Record<string, unknown>;
	for (const key of path.slice(0, -1)) {
		current = current[key] as Record<string, unknown>;
	}
	current[path.at(-1)!] = value;
}

describe("artifact schema properties", () => {
	it("keeps the handwritten validator aligned with JSON Schema under mutations", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...mutationPaths),
				fc.jsonValue(),
				(path, value) => {
					const input = structuredClone(artifact());
					setPath(input, path, value);
					expect(isCatalogArtifact(input)).toBe(validateJsonSchema(input));
				},
			),
			{ numRuns: 500 },
		);
	});
});
