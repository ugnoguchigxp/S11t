export type S11tErrorCode =
	| "S11T_ARTIFACT_INVALID"
	| "S11T_ARTIFACT_DIGEST_MISMATCH"
	| "S11T_CONTEXT_NOT_FOUND"
	| "S11T_LOCALE_NOT_FOUND"
	| "S11T_VALUE_MISSING"
	| "S11T_VALUE_EXTRA"
	| "S11T_VALUE_INVALID";

export class S11tError extends Error {
	readonly code: S11tErrorCode;
	readonly path: Array<string | number>;

	constructor(
		code: S11tErrorCode,
		message: string,
		path: Array<string | number> = [],
	) {
		super(message);
		this.name = "S11tError";
		this.code = code;
		this.path = [...path];
	}
}
