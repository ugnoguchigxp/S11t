import type {
	S11tnextSectionEnforcement,
	S11tnextSectionKind,
	S11tnextSectionSeverity,
	S11tnextVariableEncoding,
	S11tnextVariablePlacement,
	S11tnextVariableTrust,
	S11tnextVariableType,
} from "./types.js";

export type CanonicalVariableDefinition = {
	required: true;
	type: S11tnextVariableType;
	trust: S11tnextVariableTrust;
	placement: S11tnextVariablePlacement;
	encoding: S11tnextVariableEncoding;
};

export type CanonicalSectionDefinition = {
	id: string;
	kind: S11tnextSectionKind;
	severity: S11tnextSectionSeverity;
	enforcement: S11tnextSectionEnforcement;
	optimizable: boolean;
	locales: Record<string, string>;
};

export type CanonicalContextDefinition = {
	key: string;
	owner: string;
	contentKind: "text";
	sourceLocale: string;
	requiredLocales: string[];
	variables: Record<string, CanonicalVariableDefinition>;
	sections: CanonicalSectionDefinition[];
};

export function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}
