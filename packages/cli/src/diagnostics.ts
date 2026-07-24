export type S11tnextDiagnosticSeverity = "error" | "warning";

export type S11tnextDiagnostic = {
	code: string;
	severity: S11tnextDiagnosticSeverity;
	message: string;
	file: string;
	path: Array<string | number>;
	line?: number;
	column?: number;
};

export class S11tnextDiagnosticError extends Error {
	readonly diagnostics: S11tnextDiagnostic[];

	constructor(diagnostics: S11tnextDiagnostic[]) {
		super(diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("\n"));
		this.name = "S11tnextDiagnosticError";
		this.diagnostics = diagnostics.map((diagnostic) => ({
			...diagnostic,
			path: [...diagnostic.path],
		}));
	}
}
