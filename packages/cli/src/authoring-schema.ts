import type {
	CanonicalContextDefinition,
	CanonicalSectionDefinition,
	CanonicalVariableDefinition,
} from "@s11t/runtime/compiler";

import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";

export type AuthoringDocument = {
	file: string;
	definition: CanonicalContextDefinition;
};

type Path = Array<string | number>;
type UnknownRecord = Record<string, unknown>;

const CONTEXT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z][A-Za-z0-9_.-]*$/;
const VARIABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PLACEHOLDER_PATTERN = /\[\[([A-Za-z][A-Za-z0-9_]*)\]\]/g;

function issue(file: string, code: string, message: string, path: Path): never {
	const diagnostic: S11tDiagnostic = { code, severity: "error", message, file, path };
	throw new S11tDiagnosticError([diagnostic]);
}

function object(value: unknown, file: string, path: Path): UnknownRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return issue(file, "S11T_SOURCE_INVALID", "Expected an object", path);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		return issue(file, "S11T_SOURCE_INVALID", "Expected a plain object", path);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") return issue(file, "S11T_SOURCE_INVALID", "Symbol properties are not supported", path);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			return issue(file, "S11T_SOURCE_INVALID", "Expected enumerable data properties", [...path, key]);
		}
	}
	return value as UnknownRecord;
}

function array(value: unknown, file: string, path: Path): unknown[] {
	if (!Array.isArray(value)) return issue(file, "S11T_SOURCE_INVALID", "Expected an array", path);
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, index);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			return issue(file, "S11T_SOURCE_INVALID", "Expected a dense data array", [...path, index]);
		}
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) {
		return issue(file, "S11T_SOURCE_INVALID", "Array properties are not supported", path);
	}
	return value;
}

function exactKeys(
	value: UnknownRecord,
	allowed: readonly string[],
	required: readonly string[],
	file: string,
	path: Path,
): void {
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(value)) {
		if (!allowedSet.has(key)) issue(file, "S11T_SOURCE_INVALID", `Unsupported field: ${key}`, [...path, key]);
	}
	for (const key of required) {
		if (!Object.hasOwn(value, key)) issue(file, "S11T_SOURCE_INVALID", `Missing required field: ${key}`, [...path, key]);
	}
}

function string(value: unknown, file: string, path: Path): string {
	if (typeof value !== "string" || value.length === 0) {
		return issue(file, "S11T_SOURCE_INVALID", "Expected a non-empty string", path);
	}
	return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], file: string, path: Path): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		return issue(file, "S11T_SOURCE_INVALID", `Expected one of: ${allowed.join(", ")}`, path);
	}
	return value as T;
}

function locales(value: unknown, file: string, path: Path): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		return issue(file, "S11T_SOURCE_INVALID", "Expected a non-empty locale array", path);
	}
	const result = array(value, file, path).map((entry, index) => string(entry, file, [...path, index]));
	for (const [index, locale] of result.entries()) {
		if (!LOCALE_PATTERN.test(locale)) {
			return issue(file, "S11T_SOURCE_INVALID", "Expected a supported locale identifier", [...path, index]);
		}
	}
	if (new Set(result).size !== result.length) {
		return issue(file, "S11T_SOURCE_INVALID", "Locales must be unique", path);
	}
	return result;
}

function normalizeText(value: unknown, file: string, path: Path): string {
	return string(value, file, path).replace(/\r\n?/g, "\n");
}

function parseVariables(
	input: unknown,
	file: string,
): Record<string, CanonicalVariableDefinition> {
	if (input === undefined) return {};
	const source = object(input, file, ["variables"]);
	const result: Record<string, CanonicalVariableDefinition> = {};
	for (const [name, value] of Object.entries(source)) {
		const path = ["variables", name] satisfies Path;
		if (!VARIABLE_NAME_PATTERN.test(name)) {
			issue(file, "S11T_SOURCE_INVALID", "Invalid variable name", path);
		}
		const variable = object(value, file, path);
		exactKeys(
			variable,
			["required", "type", "trust", "placement", "encoding"],
			["required", "type", "trust", "placement", "encoding"],
			file,
			path,
		);
		if (variable.required !== true) {
			issue(file, "S11T_UNSUPPORTED_OPTIONAL_VARIABLE", "v0.1 requires every variable to be required", [...path, "required"]);
		}
		const type = oneOf(variable.type, ["string", "number", "boolean", "json"], file, [...path, "type"]);
		const trust = oneOf(variable.trust, ["trusted", "untrusted"], file, [...path, "trust"]);
		const placement = oneOf(variable.placement, ["inline", "delimited-context"], file, [...path, "placement"]);
		const encoding = oneOf(variable.encoding, ["raw", "json-string", "json-value"], file, [...path, "encoding"]);
		if (trust === "untrusted" && encoding === "raw") {
			issue(file, "S11T_UNSAFE_UNTRUSTED_RAW", "Untrusted variables cannot use raw encoding", [...path, "encoding"]);
		}
		if (encoding === "raw" && type !== "string") {
			issue(file, "S11T_ENCODING_TYPE_MISMATCH", "raw encoding only supports string variables", [...path, "encoding"]);
		}
		if (encoding === "json-string" && type === "json") {
			issue(file, "S11T_ENCODING_TYPE_MISMATCH", "json-string does not support json variables", [...path, "encoding"]);
		}
		result[name] = { required: true, type, trust, placement, encoding };
	}
	return result;
}

function parseLocaleTextMap(
	input: unknown,
	requiredLocales: string[],
	file: string,
	path: Path,
): Record<string, string> {
	const source = object(input, file, path);
	const result: Record<string, string> = {};
	for (const [locale, value] of Object.entries(source)) {
		if (!LOCALE_PATTERN.test(locale)) {
			issue(file, "S11T_SOURCE_INVALID", "Invalid or unsupported locale key", [...path, locale]);
		}
		const localeEntry = object(value, file, [...path, locale]);
		exactKeys(localeEntry, ["text"], ["text"], file, [...path, locale]);
		result[locale] = normalizeText(localeEntry.text, file, [...path, locale, "text"]);
	}
	for (const locale of requiredLocales) {
		if (!Object.hasOwn(result, locale)) {
			issue(file, "S11T_LOCALE_MISSING", `Missing required locale: ${locale}`, [...path, locale]);
		}
	}
	return result;
}

function simpleSection(
	input: unknown,
	requiredLocales: string[],
	file: string,
): CanonicalSectionDefinition {
	return {
		id: "context.text",
		kind: "instruction",
		severity: "must",
		enforcement: "prompt",
		optimizable: false,
		locales: parseLocaleTextMap(input, requiredLocales, file, ["locales"]),
	};
}

function parseSections(
	input: unknown,
	requiredLocales: string[],
	file: string,
): CanonicalSectionDefinition[] {
	if (!Array.isArray(input) || input.length === 0) {
		return issue(file, "S11T_SOURCE_INVALID", "Expected at least one section", ["sections"]);
	}
	const seen = new Set<string>();
	const parsed = array(input, file, ["sections"]).map((entry, index) => {
		const path = ["sections", index] satisfies Path;
		const section = object(entry, file, path);
		exactKeys(
			section,
			["id", "kind", "severity", "enforcement", "optimizable", "locales"],
			["id", "kind", "severity", "enforcement", "optimizable", "locales"],
			file,
			path,
		);
		const id = string(section.id, file, [...path, "id"]);
		if (seen.has(id)) issue(file, "S11T_SECTION_DUPLICATE_ID", `Duplicate section ID: ${id}`, [...path, "id"]);
		seen.add(id);
		if (typeof section.optimizable !== "boolean") {
			issue(file, "S11T_SOURCE_INVALID", "Expected a boolean", [...path, "optimizable"]);
		}
		return {
			id,
			kind: oneOf(
				section.kind,
				["instruction", "runtime-fact", "tool-contract", "output-contract", "overlay"],
				file,
				[...path, "kind"],
			),
			severity: oneOf(section.severity, ["must", "should", "may"], file, [...path, "severity"]),
			enforcement: oneOf(section.enforcement, ["prompt", "schema", "host"], file, [...path, "enforcement"]),
			optimizable: section.optimizable,
			locales: parseLocaleTextMap(section.locales, requiredLocales, file, [...path, "locales"]),
		};
	});
	const expectedLocales = Object.keys(parsed[0]?.locales ?? {}).sort();
	for (const [index, section] of parsed.entries()) {
		const sectionLocales = Object.keys(section.locales).sort();
		if (JSON.stringify(sectionLocales) !== JSON.stringify(expectedLocales)) {
			issue(
				file,
				"S11T_LOCALE_MISSING",
				"Every section must define the same locale set",
				["sections", index, "locales"],
			);
		}
	}
	return parsed;
}

function validateVariableReferences(
	sections: CanonicalSectionDefinition[],
	variables: Record<string, CanonicalVariableDefinition>,
	file: string,
): void {
	const referenced = new Set<string>();
	for (const [sectionIndex, section] of sections.entries()) {
		for (const [locale, text] of Object.entries(section.locales)) {
			const remaining = text.replace(PLACEHOLDER_PATTERN, "");
			if (remaining.includes("[[") || remaining.includes("]]")) {
				issue(
					file,
					"S11T_PLACEHOLDER_INVALID",
					"Invalid placeholder syntax",
					["sections", sectionIndex, "locales", locale, "text"],
				);
			}
			for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
				const name = match[1];
				if (name === undefined) continue;
				if (!Object.hasOwn(variables, name)) {
					issue(
						file,
						"S11T_VARIABLE_UNDECLARED",
						`Placeholder references undeclared variable: ${name}`,
						["sections", sectionIndex, "locales", locale, "text"],
					);
				}
				referenced.add(name);
			}
		}
	}
	for (const name of Object.keys(variables)) {
		if (!referenced.has(name)) {
			issue(file, "S11T_VARIABLE_UNUSED", `Variable is never referenced: ${name}`, ["variables", name]);
		}
	}
}

export function parseAuthoringDocument(input: unknown, file: string): AuthoringDocument {
	const source = object(input, file, []);
	exactKeys(
		source,
		["schema_version", "context", "variables", "locales", "sections"],
		["schema_version", "context"],
		file,
		[],
	);
	if (source.schema_version !== 1) {
		return issue(file, "S11T_SCHEMA_VERSION_UNSUPPORTED", "Only authoring schema_version = 1 is supported", ["schema_version"]);
	}
	const context = object(source.context, file, ["context"]);
	exactKeys(
		context,
		["id", "version", "owner", "source_locale", "required_locales", "output"],
		["id", "version", "owner", "source_locale", "required_locales", "output"],
		file,
		["context"],
	);
	const id = string(context.id, file, ["context", "id"]);
	if (!CONTEXT_ID_PATTERN.test(id)) issue(file, "S11T_SOURCE_INVALID", "Expected a namespace:key context ID", ["context", "id"]);
	const version = string(context.version, file, ["context", "version"]);
	if (!SEMVER_PATTERN.test(version)) issue(file, "S11T_SOURCE_INVALID", "Expected a semantic version", ["context", "version"]);
	const output = string(context.output, file, ["context", "output"]);
	if (output !== "text") {
		return issue(file, "S11T_UNSUPPORTED_OUTPUT", `Output ${output} is not supported in v0.1`, ["context", "output"]);
	}
	const requiredLocales = locales(context.required_locales, file, ["context", "required_locales"]);
	const sourceLocale = string(context.source_locale, file, ["context", "source_locale"]);
	if (!requiredLocales.includes(sourceLocale)) {
		return issue(file, "S11T_LOCALE_MISSING", "source_locale must be included in required_locales", ["context", "source_locale"]);
	}
	const hasSimple = Object.hasOwn(source, "locales");
	const hasSectioned = Object.hasOwn(source, "sections");
	if (hasSimple === hasSectioned) {
		return issue(file, "S11T_SOURCE_SHAPE_CONFLICT", "Define exactly one of locales or sections", []);
	}
	const variables = parseVariables(source.variables, file);
	const sections = hasSimple
		? [simpleSection(source.locales, requiredLocales, file)]
		: parseSections(source.sections, requiredLocales, file);
	validateVariableReferences(sections, variables, file);
	return {
		file,
		definition: {
			id,
			version,
			owner: string(context.owner, file, ["context", "owner"]),
			output: "text",
			sourceLocale,
			requiredLocales,
			variables,
			sections,
		},
	};
}

export function validateAuthoringDocuments(documents: readonly AuthoringDocument[]): void {
	const ids = new Map<string, string>();
	for (const document of documents) {
		const previousFile = ids.get(document.definition.id);
		if (previousFile !== undefined) {
			issue(
				document.file,
				"S11T_DUPLICATE_ID",
				`Context ID ${document.definition.id} is also defined in ${previousFile}`,
				["context", "id"],
			);
		}
		ids.set(document.definition.id, document.file);
	}
}
