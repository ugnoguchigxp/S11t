import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { assertCatalogArtifact } from "@s11t/runtime";

import { compileProject } from "./compile-source.js";
import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";
import { emitTypes } from "./emit-types.js";

export type BuildResult = {
	catalogPath: string;
	typesPath: string;
	catalogDigest: string;
	checked: boolean;
};

function stale(file: string): never {
	const diagnostic: S11tDiagnostic = {
		code: "S11T_BUILD_STALE",
		severity: "error",
		message: "Generated output is missing or stale",
		file,
		path: [],
	};
	throw new S11tDiagnosticError([diagnostic]);
}

function sameBytes(path: string, expected: string): boolean {
	try {
		return readFileSync(path, "utf8") === expected;
	} catch {
		return false;
	}
}

function atomicWrite(path: string, content: string): void {
	const nonce = randomBytes(12).toString("hex");
	const temporary = resolve(path, `../.${basename(path)}.${process.pid}.${nonce}.tmp`);
	try {
		writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function buildProject(
	options: { config?: string; check?: boolean; cwd?: string; releaseProfile?: string } = {},
): BuildResult {
	const project = compileProject(options.config, options.cwd, options.releaseProfile);
	const catalogBytes = `${JSON.stringify(project.artifact, null, 2)}\n`;
	const parsedArtifact: unknown = JSON.parse(catalogBytes);
	assertCatalogArtifact(parsedArtifact);
	const typeBytes = emitTypes(project.artifact);
	const outputDirectory = resolve(project.configDirectory, project.config.outDir);
	const catalogPath = resolve(outputDirectory, "catalog.json");
	const typesPath = resolve(outputDirectory, "catalog.generated.ts");
	if (options.check === true) {
		if (!sameBytes(catalogPath, catalogBytes)) stale(catalogPath);
		if (!sameBytes(typesPath, typeBytes)) stale(typesPath);
		return { catalogPath, typesPath, catalogDigest: project.artifact.catalogDigest, checked: true };
	}
	mkdirSync(outputDirectory, { recursive: true });
	atomicWrite(catalogPath, catalogBytes);
	atomicWrite(typesPath, typeBytes);
	return { catalogPath, typesPath, catalogDigest: project.artifact.catalogDigest, checked: false };
}
