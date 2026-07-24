export type S11tnextErrorCode =
	| "S11TNEXT_ARTIFACT_INVALID"
	| "S11TNEXT_ARTIFACT_VERSION_UNSUPPORTED"
	| "S11TNEXT_ARTIFACT_DIGEST_MISMATCH"
	| "S11TNEXT_CONTEXT_NOT_FOUND"
	| "S11TNEXT_LOCALE_NOT_FOUND"
	| "S11TNEXT_VALUE_MISSING"
	| "S11TNEXT_VALUE_EXTRA"
	| "S11TNEXT_VALUE_INVALID";

export class S11tnextError extends Error {
	readonly code: S11tnextErrorCode;
	readonly path: Array<string | number>;

	constructor(
		code: S11tnextErrorCode,
		message: string,
		path: Array<string | number> = [],
	) {
		super(message);
		this.name = "S11tnextError";
		this.code = code;
		this.path = [...path];
	}
}
