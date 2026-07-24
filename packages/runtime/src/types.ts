export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export type TemplateSegment =
	| { type: "literal"; value: string }
	| { type: "variable"; name: string };

export type S11tnextVariableType = "string" | "number" | "boolean" | "json";
export type S11tnextVariableTrust = "trusted" | "untrusted";
export type S11tnextVariablePlacement = "inline" | "delimited-context";
export type S11tnextVariableEncoding =
	| "raw"
	| "delimited-text"
	| "json-string"
	| "json-value";
export type PromptMessageRole = "system" | "user";

export type S11tnextCompiledVariable = {
	required: boolean;
	type: S11tnextVariableType;
	trust: S11tnextVariableTrust;
	placement: S11tnextVariablePlacement;
	encoding: S11tnextVariableEncoding;
};

export type S11tnextSectionKind =
	| "instruction"
	| "runtime-fact"
	| "tool-contract"
	| "output-contract"
	| "overlay";

export type S11tnextSectionSeverity = "must" | "should" | "may";

export type S11tnextCompiledSection = {
	id: string;
	kind: S11tnextSectionKind;
	severity: S11tnextSectionSeverity;
	optimizable: boolean;
	omitIfEmpty: boolean;
	segments: TemplateSegment[];
};

export type S11tnextCompiledLocale = {
	sections: S11tnextCompiledSection[];
	artifactHash: string;
};

export type S11tnextCompiledContext = {
	key: string;
	owner: string;
	contentKind: "text";
	messageRole: PromptMessageRole;
	sourceLocale: string;
	requiredLocales: string[];
	variables: Record<string, S11tnextCompiledVariable>;
	locales: Record<string, S11tnextCompiledLocale>;
	definitionHash: string;
	releaseDigest: string;
};

export type S11tnextCatalogArtifact = {
	format: "s11tnext.catalog";
	artifactVersion: 2;
	compilerVersion: string;
	releaseProfile: string;
	policyDigest: string;
	createdFrom: {
		configPath: string;
		sourceFiles: string[];
	};
	contexts: Record<string, S11tnextCompiledContext>;
	catalogDigest: string;
};
