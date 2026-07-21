import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { isCatalogArtifactV1 } from "../src/artifact-schema.js";
import type { S11tCatalogArtifactV1 } from "../src/types.js";

const digest = `sha256:${"0".repeat(64)}`;

function validArtifact(): S11tCatalogArtifactV1 {
	return {
		format: "s11t.catalog",
		schemaVersion: 1,
		compilerVersion: "0.0.0",
		defaultLocale: "en-US",
		createdFrom: {
			configPath: "s11t.config.toml",
			sourceFiles: ["contexts/example.context.toml"],
		},
		contexts: {
			"example:greeting": {
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
				locales: {
					"en-US": {
						sections: [
							{
								id: "context.text",
								kind: "instruction",
								severity: "must",
								enforcement: "prompt",
								optimizable: false,
								segments: [
									{ type: "literal", value: "Hello, " },
									{ type: "variable", name: "name" },
								],
							},
						],
						artifactHash: digest,
					},
				},
				definitionHash: digest,
				releaseDigest: digest,
			},
		},
		catalogDigest: digest,
	};
}

const schema = JSON.parse(
	readFileSync(new URL("../../../schemas/s11t-artifact-v1.schema.json", import.meta.url), "utf8"),
) as object;
const ajv = new Ajv2020({ strict: true });
const validateJsonSchema = ajv.compile(schema);

describe("artifact schema", () => {
	it("accepts the v1 artifact fixture", () => {
		const artifact = validArtifact();
		expect(isCatalogArtifactV1(artifact)).toBe(true);
		expect(validateJsonSchema(artifact)).toBe(true);
	});

	it.each([
		["unknown schema", (artifact: Record<string, unknown>) => (artifact.schemaVersion = 2)],
		["extra top-level property", (artifact: Record<string, unknown>) => (artifact.extra = true)],
		["invalid digest", (artifact: Record<string, unknown>) => (artifact.catalogDigest = "sha256:ABC")],
		[
			"absolute provenance path",
			(artifact: Record<string, unknown>) => {
				const createdFrom = artifact.createdFrom as Record<string, unknown>;
				createdFrom.configPath = "/private/config.toml";
			},
		],
		[
			"optional variable",
			(artifact: Record<string, unknown>) => {
				const contexts = artifact.contexts as Record<string, Record<string, unknown>>;
				const context = contexts["example:greeting"];
				const variables = context?.variables as Record<string, Record<string, unknown>>;
				if (variables.name !== undefined) variables.name.required = false;
			},
		],
		[
			"empty required locale list",
			(artifact: Record<string, unknown>) => {
				const contexts = artifact.contexts as Record<string, Record<string, unknown>>;
				const context = contexts["example:greeting"];
				if (context !== undefined) context.requiredLocales = [];
			},
		],
		[
			"duplicate required locale",
			(artifact: Record<string, unknown>) => {
				const contexts = artifact.contexts as Record<string, Record<string, unknown>>;
				const context = contexts["example:greeting"];
				if (context !== undefined) context.requiredLocales = ["en-US", "en-US"];
			},
		],
		[
			"empty section list",
			(artifact: Record<string, unknown>) => {
				const context = (artifact.contexts as Record<string, Record<string, unknown>>)["example:greeting"];
				const locale = (context?.locales as Record<string, Record<string, unknown>>)["en-US"];
				if (locale !== undefined) locale.sections = [];
			},
		],
		[
			"extra segment property",
			(artifact: Record<string, unknown>) => {
				const context = (artifact.contexts as Record<string, Record<string, unknown>>)["example:greeting"];
				const locale = (context?.locales as Record<string, Record<string, unknown>>)["en-US"];
				const section = (locale?.sections as Array<Record<string, unknown>>)[0];
				const segment = (section?.segments as Array<Record<string, unknown>>)[0];
				if (segment !== undefined) segment.extra = true;
			},
		],
	])("keeps runtime and JSON Schema rejection aligned for %s", (_name, mutate) => {
		const artifact = structuredClone(validArtifact()) as unknown as Record<string, unknown>;
		mutate(artifact);
		expect(isCatalogArtifactV1(artifact)).toBe(false);
		expect(validateJsonSchema(artifact)).toBe(false);
	});

	it("rejects non-JSON accessors and sparse arrays", () => {
		const withAccessor = validArtifact() as unknown as Record<string, unknown>;
		Object.defineProperty(withAccessor, "compilerVersion", {
			enumerable: true,
			get: () => "0.0.0",
		});
		expect(isCatalogArtifactV1(withAccessor)).toBe(false);

		const withSparseArray = validArtifact();
		withSparseArray.createdFrom.sourceFiles = new Array(1);
		expect(isCatalogArtifactV1(withSparseArray)).toBe(false);
	});
});
