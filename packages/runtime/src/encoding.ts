import { canonicalJson } from "./canonical-json.js";
import { S11tError } from "./diagnostics.js";
import type { JsonValue, S11tCompiledVariableV1 } from "./types.js";

function isPlainObject(value: object): value is Record<string, unknown> {
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function snapshotJsonValueInternal(
	value: unknown,
	path: Array<string | number>,
	ancestors: Set<object>,
): JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return value;
	}
	if (Array.isArray(value)) {
		if (ancestors.has(value)) {
			throw new S11tError("S11T_VALUE_INVALID", "Cyclic JSON values are not supported", path);
		}
		ancestors.add(value);
		try {
			const result: JsonValue[] = [];
			for (let index = 0; index < value.length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(value, index);
				if (descriptor === undefined) {
					throw new S11tError("S11T_VALUE_INVALID", "Sparse JSON arrays are not supported", [
						...path,
						index,
					]);
				}
				if (!("value" in descriptor)) {
					throw new S11tError("S11T_VALUE_INVALID", "JSON accessors are not supported", [
						...path,
						index,
					]);
				}
				result.push(snapshotJsonValueInternal(descriptor.value, [...path, index], ancestors));
			}
			return result;
		} finally {
			ancestors.delete(value);
		}
	}
	if (typeof value === "object" && isPlainObject(value)) {
		if (ancestors.has(value)) {
			throw new S11tError("S11T_VALUE_INVALID", "Cyclic JSON values are not supported", path);
		}
		ancestors.add(value);
		try {
			const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
			for (const key of Object.keys(value)) {
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (descriptor === undefined || !("value" in descriptor)) {
					throw new S11tError("S11T_VALUE_INVALID", "JSON accessors are not supported", [
						...path,
						key,
					]);
				}
				result[key] = snapshotJsonValueInternal(descriptor.value, [...path, key], ancestors);
			}
			return result;
		} finally {
			ancestors.delete(value);
		}
	}
	throw new S11tError("S11T_VALUE_INVALID", "Expected a JSON-compatible value", path);
}

export function assertJsonValue(value: unknown, path: Array<string | number> = []): asserts value is JsonValue {
	snapshotJsonValueInternal(value, path, new Set<object>());
}

function escapeJsonString(value: string): string {
	return escapeBoundaryCharacters(JSON.stringify(value));
}

function escapeBoundaryCharacters(value: string): string {
	return value.replace(/[<>&\u2028\u2029]/g, (character) => {
		const code = character.codePointAt(0);
		return `\\u${code?.toString(16).padStart(4, "0")}`;
	});
}

export function encodeValue(
	value: unknown,
	definition: S11tCompiledVariableV1,
	path: Array<string | number>,
	options: { escapeBoundaryCharacters?: boolean } = {},
): string {
	let jsonValue: JsonValue | undefined;
	if (definition.type === "string" && typeof value !== "string") {
		throw new S11tError("S11T_VALUE_INVALID", "Expected a string", path);
	}
	if (
		definition.type === "number" &&
		(typeof value !== "number" || !Number.isFinite(value))
	) {
		throw new S11tError("S11T_VALUE_INVALID", "Expected a finite number", path);
	}
	if (definition.type === "boolean" && typeof value !== "boolean") {
		throw new S11tError("S11T_VALUE_INVALID", "Expected a boolean", path);
	}
	if (definition.type === "json") {
		jsonValue = snapshotJsonValueInternal(value, path, new Set<object>());
	}

	if (definition.encoding === "raw") return value as string;
	if (definition.encoding === "json-string") return escapeJsonString(String(value));
	jsonValue ??= snapshotJsonValueInternal(value, path, new Set<object>());
	const encoded = canonicalJson(jsonValue);
	return options.escapeBoundaryCharacters === true
		? escapeBoundaryCharacters(encoded)
		: encoded;
}
