export type S11tDiagnosticSeverity = "error" | "warning";

export type S11tDiagnostic = {
	code: string;
	severity: S11tDiagnosticSeverity;
	message: string;
	file: string;
	path: Array<string | number>;
	line?: number;
	column?: number;
};

export class S11tDiagnosticError extends Error {
	readonly diagnostics: S11tDiagnostic[];

	constructor(diagnostics: S11tDiagnostic[]) {
		super(diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("\n"));
		this.name = "S11tDiagnosticError";
		this.diagnostics = diagnostics.map((diagnostic) => ({
			...diagnostic,
			path: [...diagnostic.path],
		}));
	}
}
