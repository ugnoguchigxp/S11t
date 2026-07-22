import type {
	S11tSectionEnforcement,
	S11tSectionKind,
	S11tSectionSeverity,
	S11tVariableEncoding,
	S11tVariablePlacement,
	S11tVariableTrust,
	S11tVariableType,
} from "./types.js";

export type CanonicalVariableDefinitionV2 = {
	required: true;
	type: S11tVariableType;
	trust: S11tVariableTrust;
	placement: S11tVariablePlacement;
	encoding: S11tVariableEncoding;
};

export type CanonicalSectionDefinitionV2 = {
	id: string;
	kind: S11tSectionKind;
	severity: S11tSectionSeverity;
	enforcement: S11tSectionEnforcement;
	optimizable: boolean;
	locales: Record<string, string>;
};

export type CanonicalContextDefinitionV2 = {
	key: string;
	owner: string;
	contentKind: "text";
	sourceLocale: string;
	requiredLocales: string[];
	variables: Record<string, CanonicalVariableDefinitionV2>;
	sections: CanonicalSectionDefinitionV2[];
};
