import { readFileSync } from "node:fs";

import { parse } from "smol-toml";

import { S11tnextDiagnosticError, type S11tnextDiagnostic } from "./diagnostics.js";

type TomlError = Error & { line?: number; column?: number };

export function loadToml(filePath: string, displayFile: string): unknown {
	let source: string;
	try {
		source = readFileSync(filePath, "utf8");
	} catch {
		const diagnostic: S11tnextDiagnostic = {
			code: "S11TNEXT_FILE_NOT_FOUND",
			severity: "error",
			message: "File could not be read",
			file: displayFile,
			path: [],
		};
		throw new S11tnextDiagnosticError([diagnostic]);
	}
	try {
		return parse(source);
	} catch (error) {
		const tomlError = error as TomlError;
		const diagnostic: S11tnextDiagnostic = {
			code: "S11TNEXT_TOML_SYNTAX",
			severity: "error",
			message: tomlError.message,
			file: displayFile,
			path: [],
		};
		if (tomlError.line !== undefined) diagnostic.line = tomlError.line;
		if (tomlError.column !== undefined) diagnostic.column = tomlError.column;
		throw new S11tnextDiagnosticError([diagnostic]);
	}
}
