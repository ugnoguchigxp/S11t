import { S11tError } from "./diagnostics.js";
import type { S11tCatalogArtifactV1 } from "./types.js";

type Path = Array<string | number>;
type UnknownRecord = Record<string, unknown>;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function fail(path: Path, expected: string): never {
	throw new S11tError(
		"S11T_ARTIFACT_INVALID",
		`Expected ${expected} at ${path.length === 0 ? "$" : path.join(".")}`,
		path,
	);
}

function record(value: unknown, path: Path): UnknownRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return fail(path, "an object");
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		return fail(path, "a plain JSON object");
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") return fail(path, "an object without symbol properties");
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			return fail([...path, key], "an enumerable JSON data property");
		}
	}
	return value as UnknownRecord;
}

function array(value: unknown, path: Path): unknown[] {
	if (!Array.isArray(value)) return fail(path, "an array");
	for (const key of Reflect.ownKeys(value)) {
		if (key === "length") continue;
		if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
			return fail(path, "an array without additional properties");
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			return fail([...path, Number(key)], "an enumerable JSON data property");
		}
	}
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) return fail([...path, index], "an array item");
	}
	return value;
}

function exactKeys(value: UnknownRecord, allowed: readonly string[], path: Path): void {
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(value)) {
		if (!allowedSet.has(key)) fail([...path, key], "no additional property");
	}
	for (const key of allowed) {
		if (!Object.hasOwn(value, key)) fail([...path, key], "a required property");
	}
}

function string(value: unknown, path: Path): string {
	if (typeof value !== "string") return fail(path, "a string");
	return value;
}

function nonEmptyString(value: unknown, path: Path): string {
	const result = string(value, path);
	if (result.length === 0) return fail(path, "a non-empty string");
	return result;
}

function literal<T extends string | number | boolean>(
	value: unknown,
	expected: T,
	path: Path,
): T {
	if (value !== expected) return fail(path, JSON.stringify(expected));
	return expected;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], path: Path): T {
	if (typeof value !== "string" || !values.includes(value as T)) {
		return fail(path, values.map((item) => JSON.stringify(item)).join(" or "));
	}
	return value as T;
}

function digest(value: unknown, path: Path): string {
	const result = string(value, path);
	if (!DIGEST_PATTERN.test(result)) return fail(path, "a sha256 digest");
	return result;
}

function relativePosixPath(value: unknown, path: Path): string {
	const result = nonEmptyString(value, path);
	if (
		result.includes("\\") ||
		result.startsWith("/") ||
		/^[A-Za-z]:/.test(result) ||
		result.split("/").includes("..")
	) {
		return fail(path, "a relative POSIX path without parent traversal");
	}
	return result;
}

function stringArray(value: unknown, path: Path): string[] {
	return array(value, path).map((entry, index) => nonEmptyString(entry, [...path, index]));
}

function nonEmptyUniqueStringArray(value: unknown, path: Path): string[] {
	const result = stringArray(value, path);
	if (result.length === 0) return fail(path, "a non-empty array");
	if (new Set(result).size !== result.length) return fail(path, "an array of unique strings");
	return result;
}

function validateVariable(value: unknown, path: Path): void {
	const object = record(value, path);
	exactKeys(object, ["required", "type", "trust", "placement", "encoding"], path);
	literal(object.required, true, [...path, "required"]);
	oneOf(object.type, ["string", "number", "boolean", "json"], [...path, "type"]);
	oneOf(object.trust, ["trusted", "untrusted"], [...path, "trust"]);
	oneOf(object.placement, ["inline", "delimited-context"], [...path, "placement"]);
	oneOf(object.encoding, ["raw", "json-string", "json-value"], [...path, "encoding"]);
	if (object.trust === "untrusted" && object.encoding === "raw") {
		fail([...path, "encoding"], "a non-raw encoding for untrusted data");
	}
	if (object.encoding === "raw" && object.type !== "string") {
		fail([...path, "encoding"], "raw encoding with a string variable");
	}
	if (object.encoding === "json-string" && object.type === "json") {
		fail([...path, "encoding"], "json-string encoding with a scalar variable");
	}
}

function validateSegment(value: unknown, path: Path): void {
	const object = record(value, path);
	const type = oneOf(object.type, ["literal", "variable"], [...path, "type"]);
	if (type === "literal") {
		exactKeys(object, ["type", "value"], path);
		string(object.value, [...path, "value"]);
		return;
	}
	exactKeys(object, ["type", "name"], path);
	nonEmptyString(object.name, [...path, "name"]);
}

function validateSection(value: unknown, path: Path): void {
	const object = record(value, path);
	exactKeys(
		object,
		["id", "kind", "severity", "enforcement", "optimizable", "segments"],
		path,
	);
	nonEmptyString(object.id, [...path, "id"]);
	oneOf(
		object.kind,
		["instruction", "runtime-fact", "tool-contract", "output-contract", "overlay"],
		[...path, "kind"],
	);
	oneOf(object.severity, ["must", "should", "may"], [...path, "severity"]);
	oneOf(object.enforcement, ["prompt", "schema", "host"], [...path, "enforcement"]);
	if (typeof object.optimizable !== "boolean") fail([...path, "optimizable"], "a boolean");
	array(object.segments, [...path, "segments"]).forEach((segment, index) =>
		validateSegment(segment, [...path, "segments", index]),
	);
}

function validateLocale(value: unknown, path: Path): void {
	const object = record(value, path);
	exactKeys(object, ["sections", "artifactHash"], path);
	const sections = array(object.sections, [...path, "sections"]);
	if (sections.length === 0) fail([...path, "sections"], "a non-empty array");
	sections.forEach((section, index) => validateSection(section, [...path, "sections", index]));
	digest(object.artifactHash, [...path, "artifactHash"]);
}

function validateContext(value: unknown, path: Path): void {
	const object = record(value, path);
	exactKeys(
		object,
		[
			"id",
			"version",
			"owner",
			"output",
			"sourceLocale",
			"requiredLocales",
			"variables",
			"locales",
			"definitionHash",
			"releaseDigest",
		],
		path,
	);
	nonEmptyString(object.id, [...path, "id"]);
	nonEmptyString(object.version, [...path, "version"]);
	nonEmptyString(object.owner, [...path, "owner"]);
	literal(object.output, "text", [...path, "output"]);
	nonEmptyString(object.sourceLocale, [...path, "sourceLocale"]);
	nonEmptyUniqueStringArray(object.requiredLocales, [...path, "requiredLocales"]);
	const variables = record(object.variables, [...path, "variables"]);
	for (const [name, variable] of Object.entries(variables)) {
		validateVariable(variable, [...path, "variables", name]);
	}
	const locales = record(object.locales, [...path, "locales"]);
	if (Object.keys(locales).length === 0) fail([...path, "locales"], "a non-empty object");
	for (const [locale, definition] of Object.entries(locales)) {
		validateLocale(definition, [...path, "locales", locale]);
	}
	digest(object.definitionHash, [...path, "definitionHash"]);
	digest(object.releaseDigest, [...path, "releaseDigest"]);
}

export function assertCatalogArtifactV1(value: unknown): asserts value is S11tCatalogArtifactV1 {
	const object = record(value, []);
	exactKeys(
		object,
		[
			"format",
			"schemaVersion",
			"compilerVersion",
			"defaultLocale",
			"createdFrom",
			"contexts",
			"catalogDigest",
		],
		[],
	);
	literal(object.format, "s11t.catalog", ["format"]);
	literal(object.schemaVersion, 1, ["schemaVersion"]);
	nonEmptyString(object.compilerVersion, ["compilerVersion"]);
	nonEmptyString(object.defaultLocale, ["defaultLocale"]);
	const createdFrom = record(object.createdFrom, ["createdFrom"]);
	exactKeys(createdFrom, ["configPath", "sourceFiles"], ["createdFrom"]);
	relativePosixPath(createdFrom.configPath, ["createdFrom", "configPath"]);
	const sourceFiles = stringArray(createdFrom.sourceFiles, ["createdFrom", "sourceFiles"]);
	sourceFiles.forEach((sourceFile, index) =>
		relativePosixPath(sourceFile, ["createdFrom", "sourceFiles", index]),
	);
	const contexts = record(object.contexts, ["contexts"]);
	for (const [key, context] of Object.entries(contexts)) {
		validateContext(context, ["contexts", key]);
	}
	digest(object.catalogDigest, ["catalogDigest"]);
}

export function isCatalogArtifactV1(value: unknown): value is S11tCatalogArtifactV1 {
	try {
		assertCatalogArtifactV1(value);
		return true;
	} catch (error) {
		if (error instanceof S11tError) return false;
		throw error;
	}
}
