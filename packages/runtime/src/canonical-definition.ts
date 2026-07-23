import type {
	S11tSectionEnforcement,
	S11tSectionKind,
	S11tSectionSeverity,
	S11tVariableEncoding,
	S11tVariablePlacement,
	S11tVariableTrust,
	S11tVariableType,
} from "./types.js";

export type CanonicalVariableDefinition = {
	required: true;
	type: S11tVariableType;
	trust: S11tVariableTrust;
	placement: S11tVariablePlacement;
	encoding: S11tVariableEncoding;
};

export type CanonicalSectionDefinition = {
	id: string;
	kind: S11tSectionKind;
	severity: S11tSectionSeverity;
	enforcement: S11tSectionEnforcement;
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
