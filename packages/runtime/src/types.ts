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

export type S11tVariableType = "string" | "number" | "boolean" | "json";
export type S11tVariableTrust = "trusted" | "untrusted";
export type S11tVariablePlacement = "inline" | "delimited-context";
export type S11tVariableEncoding = "raw" | "json-string" | "json-value";

export type S11tCompiledVariable = {
	required: true;
	type: S11tVariableType;
	trust: S11tVariableTrust;
	placement: S11tVariablePlacement;
	encoding: S11tVariableEncoding;
};

export type S11tSectionKind =
	| "instruction"
	| "runtime-fact"
	| "tool-contract"
	| "output-contract"
	| "overlay";

export type S11tSectionSeverity = "must" | "should" | "may";
export type S11tSectionEnforcement = "prompt" | "schema" | "host";

export type S11tCompiledSection = {
	id: string;
	kind: S11tSectionKind;
	severity: S11tSectionSeverity;
	enforcement: S11tSectionEnforcement;
	optimizable: boolean;
	segments: TemplateSegment[];
};

export type S11tCompiledLocale = {
	sections: S11tCompiledSection[];
	artifactHash: string;
};

export type S11tCompiledContext = {
	key: string;
	owner: string;
	contentKind: "text";
	sourceLocale: string;
	requiredLocales: string[];
	variables: Record<string, S11tCompiledVariable>;
	locales: Record<string, S11tCompiledLocale>;
	definitionHash: string;
	releaseDigest: string;
};

export type S11tRenderingContract = "delimited-context";

export type S11tCatalogArtifact = {
	format: "s11t.catalog";
	schemaVersion: 1;
	compilerVersion: string;
	releaseProfile: string;
	policyDigest: string;
	renderingContract: S11tRenderingContract;
	createdFrom: {
		configPath: string;
		sourceFiles: string[];
	};
	contexts: Record<string, S11tCompiledContext>;
	aliases: Record<string, string>;
	catalogDigest: string;
};
