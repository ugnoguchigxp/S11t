import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertCatalogArtifact } from "s11tnext";

import { compileProject } from "./compile-source.js";
import { S11tnextDiagnosticError, type S11tnextDiagnostic } from "./diagnostics.js";
import { emitTypes } from "./emit-types.js";
import { replaceGeneratedPair } from "./generated-output.js";

export type BuildResult = {
	catalogPath: string;
	typesPath: string;
	catalogDigest: string;
	checked: boolean;
};

function stale(file: string): never {
	const diagnostic: S11tnextDiagnostic = {
		code: "S11TNEXT_BUILD_STALE",
		severity: "error",
		message: "Generated output is missing or stale",
		file,
		path: [],
	};
	throw new S11tnextDiagnosticError([diagnostic]);
}

function sameBytes(path: string, expected: string): boolean {
	try {
		return readFileSync(path, "utf8") === expected;
	} catch {
		return false;
	}
}

export function buildProject(
	options: { config?: string; check?: boolean; cwd?: string; releaseProfile?: string } = {},
): BuildResult {
	const project = compileProject(options.config, options.cwd, options.releaseProfile);
	const catalogBytes = `${JSON.stringify(project.artifact, null, 2)}\n`;
	const parsedArtifact: unknown = JSON.parse(catalogBytes);
	assertCatalogArtifact(parsedArtifact);
	const typeBytes = emitTypes(project.artifact, {
		indent: project.config.generation.typeScriptIndent,
	});
	const outputDirectory = resolve(project.configDirectory, project.config.outDir);
	const catalogPath = resolve(outputDirectory, "catalog.json");
	const typesPath = resolve(outputDirectory, "catalog.generated.ts");
	if (options.check === true) {
		if (!sameBytes(catalogPath, catalogBytes)) stale(catalogPath);
		if (!sameBytes(typesPath, typeBytes)) stale(typesPath);
		return { catalogPath, typesPath, catalogDigest: project.artifact.catalogDigest, checked: true };
	}
	mkdirSync(outputDirectory, { recursive: true });
	replaceGeneratedPair([
		{ path: catalogPath, content: catalogBytes },
		{ path: typesPath, content: typeBytes },
	]);
	return { catalogPath, typesPath, catalogDigest: project.artifact.catalogDigest, checked: false };
}
