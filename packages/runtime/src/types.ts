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

export type S11tCompiledVariableV1 = {
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

export type S11tCompiledSectionV1 = {
	id: string;
	kind: S11tSectionKind;
	severity: S11tSectionSeverity;
	enforcement: S11tSectionEnforcement;
	optimizable: boolean;
	segments: TemplateSegment[];
};

export type S11tCompiledLocaleV1 = {
	sections: S11tCompiledSectionV1[];
	artifactHash: string;
};

export type S11tCompiledContextV1 = {
	id: string;
	version: string;
	owner: string;
	output: "text";
	sourceLocale: string;
	requiredLocales: string[];
	variables: Record<string, S11tCompiledVariableV1>;
	locales: Record<string, S11tCompiledLocaleV1>;
	definitionHash: string;
	releaseDigest: string;
};

export type S11tCatalogArtifactV1 = {
	format: "s11t.catalog";
	schemaVersion: 1;
	compilerVersion: string;
	defaultLocale: string;
	createdFrom: {
		configPath: string;
		sourceFiles: string[];
	};
	contexts: Record<string, S11tCompiledContextV1>;
	catalogDigest: string;
};

export type S11tCompiledVariableV2 = S11tCompiledVariableV1;
export type S11tCompiledSectionV2 = S11tCompiledSectionV1;
export type S11tCompiledLocaleV2 = S11tCompiledLocaleV1;

export type S11tCompiledContextV2 = {
	key: string;
	owner: string;
	contentKind: "text";
	sourceLocale: string;
	requiredLocales: string[];
	variables: Record<string, S11tCompiledVariableV2>;
	locales: Record<string, S11tCompiledLocaleV2>;
	definitionHash: string;
	releaseDigest: string;
};

export type S11tCatalogArtifactV2 = {
	format: "s11t.catalog";
	schemaVersion: 2;
	compilerVersion: string;
	releaseProfile: string;
	policyDigest: string;
	createdFrom: {
		configPath: string;
		sourceFiles: string[];
	};
	contexts: Record<string, S11tCompiledContextV2>;
	aliases: Record<string, string>;
	catalogDigest: string;
};

export type S11tRenderingContractV3 = "delimited-context-v1";
export type S11tCompiledContextV3 = S11tCompiledContextV2;
export type S11tCompiledLocaleV3 = S11tCompiledLocaleV2;
export type S11tCompiledSectionV3 = S11tCompiledSectionV2;
export type S11tCompiledVariableV3 = S11tCompiledVariableV2;

export type S11tCatalogArtifactV3 = {
	format: "s11t.catalog";
	schemaVersion: 3;
	compilerVersion: string;
	releaseProfile: string;
	policyDigest: string;
	renderingContract: S11tRenderingContractV3;
	createdFrom: {
		configPath: string;
		sourceFiles: string[];
	};
	contexts: Record<string, S11tCompiledContextV3>;
	aliases: Record<string, string>;
	catalogDigest: string;
};
