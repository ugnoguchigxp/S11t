import type {
	CanonicalContextDefinition,
	CanonicalSectionDefinition,
	CanonicalVariableDefinition,
} from "s11tnext/compiler";

import type { S11tnextProjectConfig } from "./config.js";
import { S11tnextDiagnosticError, type S11tnextDiagnostic } from "./diagnostics.js";

export type ResolutionOrigins = {
	key: string;
	owner: string;
	contentKind: string;
	sourceLocale: string;
	requiredLocales: string;
	variables: Record<string, string>;
};

export type ResolvedAuthoringDocument = {
	file: string;
	sourcePath: string;
	definition: CanonicalContextDefinition;
	origins: ResolutionOrigins;
};

type Path = Array<string | number>;
type UnknownRecord = Record<string, unknown>;

const DOT_SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const VARIABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const PLACEHOLDER_PATTERN = /\[\[([A-Za-z][A-Za-z0-9_]*)\]\]/g;

function issue(file: string, code: string, message: string, path: Path): never {
	const diagnostic: S11tnextDiagnostic = { code, severity: "error", message, file, path };
	throw new S11tnextDiagnosticError([diagnostic]);
}

function object(value: unknown, file: string, path: Path): UnknownRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return issue(file, "S11TNEXT_SOURCE_INVALID", "Expected an object", path);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		return issue(file, "S11TNEXT_SOURCE_INVALID", "Expected a plain object", path);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") return issue(file, "S11TNEXT_SOURCE_INVALID", "Symbol properties are not supported", path);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			return issue(file, "S11TNEXT_SOURCE_INVALID", "Expected enumerable data properties", [...path, key]);
		}
	}
	return value as UnknownRecord;
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
		if (!allowedSet.has(key)) issue(file, "S11TNEXT_SOURCE_INVALID", `Unsupported field: ${key}`, [...path, key]);
	}
	for (const key of required) {
		if (!Object.hasOwn(value, key)) issue(file, "S11TNEXT_SOURCE_INVALID", `Missing required field: ${key}`, [...path, key]);
	}
}

function string(value: unknown, file: string, path: Path): string {
	if (typeof value !== "string" || value.length === 0) {
		return issue(file, "S11TNEXT_SOURCE_INVALID", "Expected a non-empty string", path);
	}
	return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], file: string, path: Path): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		return issue(file, "S11TNEXT_SOURCE_INVALID", `Expected one of: ${allowed.join(", ")}`, path);
	}
	return value as T;
}

function normalizeText(value: unknown, file: string, path: Path): string {
	return string(value, file, path).replace(/\r\n?/g, "\n");
}

function deriveKey(sourcePath: string, file: string): string {
	const normalized = sourcePath.replaceAll("\\", "/");
	if (!normalized.endsWith(".context.toml")) {
		return issue(file, "S11TNEXT_KEY_INVALID", "Source file must end with .context.toml", []);
	}
	const segments = normalized.slice(0, -".context.toml".length).split("/");
	if (segments.length === 0 || segments.some((segment) => !DOT_SEGMENT_PATTERN.test(segment))) {
		return issue(file, "S11TNEXT_KEY_INVALID", "Source path contains an invalid key segment", []);
	}
	return segments.join(".");
}

function resolveOwner(key: string, config: S11tnextProjectConfig, file: string): { value: string; source: string } {
	const matches = Object.entries(config.keyspaces)
		.filter(([prefix]) => key === prefix || key.startsWith(`${prefix}.`))
		.sort(([left], [right]) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0));
	const match = matches[0];
	if (match === undefined) {
		if (config.governance.requireOwner) {
			return issue(file, "S11TNEXT_OWNER_UNRESOLVED", `Owner is not configured for key: ${key}`, []);
		}
		return { value: "unowned", source: "governance.require_owner=false" };
	}
	return { value: match[1].owner, source: `keyspaces.${match[0]}` };
}

function resolveRequiredLocales(
	config: S11tnextProjectConfig,
	releaseProfile: string,
	file: string,
): string[] {
	const profile = Object.hasOwn(config.releaseProfiles, releaseProfile)
		? config.releaseProfiles[releaseProfile]
		: undefined;
	if (profile === undefined) {
		return issue(file, "S11TNEXT_RELEASE_PROFILE_NOT_FOUND", `Release profile not found: ${releaseProfile}`, []);
	}
	return profile.requiredLocales.map((locale) =>
		locale === "$source" ? config.authoring.sourceLocale : locale,
	);
}

function parseTranslations(
	input: unknown,
	file: string,
	path: Path,
	sourceLocale: string,
): Record<string, string> {
	if (input === undefined) return {};
	const source = object(input, file, path);
	const result: Record<string, string> = {};
	for (const [locale, value] of Object.entries(source)) {
		if (!LOCALE_PATTERN.test(locale)) issue(file, "S11TNEXT_SOURCE_INVALID", "Invalid locale key", [...path, locale]);
		if (locale === sourceLocale) {
			issue(
				file,
				"S11TNEXT_SOURCE_LOCALE_OVERRIDE",
				"translations cannot override authoring.source_locale text",
				[...path, locale],
			);
		}
		const entry = object(value, file, [...path, locale]);
		exactKeys(entry, ["text"], ["text"], file, [...path, locale]);
		result[locale] = normalizeText(entry.text, file, [...path, locale, "text"]);
	}
	return result;
}

function parseVariables(
	input: unknown,
	config: S11tnextProjectConfig,
	file: string,
): { definitions: Record<string, CanonicalVariableDefinition>; origins: Record<string, string> } {
	if (input === undefined) return { definitions: {}, origins: {} };
	const source = object(input, file, ["variables"]);
	const definitions: Record<string, CanonicalVariableDefinition> = {};
	const origins: Record<string, string> = {};
	for (const [name, value] of Object.entries(source)) {
		const path = ["variables", name] satisfies Path;
		if (!VARIABLE_NAME_PATTERN.test(name)) issue(file, "S11TNEXT_SOURCE_INVALID", "Invalid variable name", path);
		const variable = object(value, file, path);
		if (Object.hasOwn(variable, "profile")) {
			exactKeys(variable, ["profile"], ["profile"], file, path);
			const profileName = string(variable.profile, file, [...path, "profile"]);
			const profile = Object.hasOwn(config.variableProfiles, profileName)
				? config.variableProfiles[profileName]
				: undefined;
			if (profile === undefined) {
				issue(file, "S11TNEXT_VARIABLE_PROFILE_NOT_FOUND", `Variable profile not found: ${profileName}`, [...path, "profile"]);
			}
			definitions[name] = { ...profile };
			origins[name] = `variable_profiles.${profileName}`;
			continue;
		}
		exactKeys(variable, ["type", "trust", "placement", "encoding"], ["type", "trust", "placement", "encoding"], file, path);
		const definition: CanonicalVariableDefinition = {
			required: true,
			type: oneOf(variable.type, ["string", "number", "boolean", "json"], file, [...path, "type"]),
			trust: oneOf(variable.trust, ["trusted", "untrusted"], file, [...path, "trust"]),
			placement: oneOf(variable.placement, ["inline", "delimited-context"], file, [...path, "placement"]),
			encoding: oneOf(variable.encoding, ["raw", "json-string", "json-value"], file, [...path, "encoding"]),
		};
		if (definition.trust === "untrusted" && definition.encoding === "raw") {
			issue(file, "S11TNEXT_UNSAFE_UNTRUSTED_RAW", "Untrusted variables cannot use raw encoding", [...path, "encoding"]);
		}
		if (definition.trust === "untrusted" && definition.placement !== "delimited-context") {
			issue(
				file,
				"S11TNEXT_UNSAFE_UNTRUSTED_PLACEMENT",
				"Untrusted variables require delimited-context placement",
				[...path, "placement"],
			);
		}
		if (definition.encoding === "raw" && definition.type !== "string") {
			issue(file, "S11TNEXT_ENCODING_TYPE_MISMATCH", "raw encoding only supports string variables", [...path, "encoding"]);
		}
		if (definition.encoding === "json-string" && definition.type === "json") {
			issue(file, "S11TNEXT_ENCODING_TYPE_MISMATCH", "json-string does not support json variables", [...path, "encoding"]);
		}
		definitions[name] = definition;
		origins[name] = `${file}#variables.${name}`;
	}
	return { definitions, origins };
}

function validateVariableReferences(
	sections: CanonicalSectionDefinition[],
	variables: Record<string, CanonicalVariableDefinition>,
	sourceLocale: string,
	file: string,
): void {
	const referenced = new Set<string>();
	for (const [sectionIndex, section] of sections.entries()) {
		const placeholdersByLocale = new Map<string, Set<string>>();
		for (const [locale, text] of Object.entries(section.locales)) {
			const placeholders = new Set<string>();
			const remaining = text.replace(PLACEHOLDER_PATTERN, "");
			if (remaining.includes("[[") || remaining.includes("]]")) {
				issue(file, "S11TNEXT_PLACEHOLDER_INVALID", "Invalid placeholder syntax", ["sections", sectionIndex, "locales", locale]);
			}
			for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
				const name = match[1];
				if (name !== undefined) {
					if (!Object.hasOwn(variables, name)) {
						issue(file, "S11TNEXT_VARIABLE_UNDECLARED", `Placeholder references undeclared variable: ${name}`, ["sections", sectionIndex, "locales", locale]);
					}
					placeholders.add(name);
					referenced.add(name);
				}
			}
			placeholdersByLocale.set(locale, placeholders);
		}
		const sourcePlaceholders = placeholdersByLocale.get(sourceLocale);
		if (sourcePlaceholders === undefined) {
			issue(file, "S11TNEXT_TRANSLATION_MISSING", `Missing source locale: ${sourceLocale}`, ["sections", sectionIndex, "locales", sourceLocale]);
		}
		for (const [locale, placeholders] of placeholdersByLocale) {
			if (locale === sourceLocale) continue;
			const missing = [...sourcePlaceholders].filter((name) => !placeholders.has(name)).sort();
			const extra = [...placeholders].filter((name) => !sourcePlaceholders.has(name)).sort();
			if (missing.length > 0 || extra.length > 0) {
				const details = [
					missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
					extra.length > 0 ? `extra: ${extra.join(", ")}` : "",
				].filter(Boolean).join("; ");
				issue(
					file,
					"S11TNEXT_TRANSLATION_PLACEHOLDER_MISMATCH",
					`Translation placeholders must match ${sourceLocale} (${details})`,
					["sections", sectionIndex, "locales", locale],
				);
			}
		}
	}
	for (const name of Object.keys(variables)) {
		if (!referenced.has(name)) issue(file, "S11TNEXT_VARIABLE_UNUSED", `Variable is never referenced: ${name}`, ["variables", name]);
	}
}

function validateCoverage(
	sections: CanonicalSectionDefinition[],
	requiredLocales: string[],
	file: string,
	validateRequiredLocales = true,
): void {
	const expected = Object.keys(sections[0]?.locales ?? {}).sort();
	for (const [index, section] of sections.entries()) {
		const available = Object.keys(section.locales).sort();
		if (JSON.stringify(available) !== JSON.stringify(expected)) {
			issue(file, "S11TNEXT_TRANSLATION_MISSING", "Every section must define the same locale set", ["sections", index]);
		}
		if (validateRequiredLocales) {
			for (const locale of requiredLocales) {
				if (!Object.hasOwn(section.locales, locale)) {
					issue(file, "S11TNEXT_TRANSLATION_MISSING", `Missing required locale: ${locale}`, ["sections", index, locale]);
				}
			}
		}
	}
}

function simpleSection(
	text: unknown,
	translations: unknown,
	config: S11tnextProjectConfig,
	file: string,
): CanonicalSectionDefinition {
	return {
		id: "context.text",
		kind: "instruction",
		severity: "must",
		enforcement: "prompt",
		optimizable: false,
		locales: {
			[config.authoring.sourceLocale]: normalizeText(text, file, ["text"]),
			...parseTranslations(
				translations,
				file,
				["translations"],
				config.authoring.sourceLocale,
			),
		},
	};
}

function parseSections(
	input: unknown,
	config: S11tnextProjectConfig,
	file: string,
): CanonicalSectionDefinition[] {
	if (!Array.isArray(input) || input.length === 0) {
		return issue(file, "S11TNEXT_SOURCE_INVALID", "Expected at least one section", ["sections"]);
	}
	const seen = new Set<string>();
	return input.map((value, index) => {
		const path = ["sections", index] satisfies Path;
		const section = object(value, file, path);
		exactKeys(
			section,
			["id", "kind", "severity", "enforcement", "optimizable", "text", "translations"],
			["id", "kind", "severity", "enforcement", "optimizable", "text"],
			file,
			path,
		);
		const id = string(section.id, file, [...path, "id"]);
		if (seen.has(id)) issue(file, "S11TNEXT_SECTION_DUPLICATE_ID", `Duplicate section ID: ${id}`, [...path, "id"]);
		seen.add(id);
		if (typeof section.optimizable !== "boolean") issue(file, "S11TNEXT_SOURCE_INVALID", "Expected a boolean", [...path, "optimizable"]);
		return {
			id,
			kind: oneOf(section.kind, ["instruction", "runtime-fact", "tool-contract", "output-contract", "overlay"], file, [...path, "kind"]),
			severity: oneOf(section.severity, ["must", "should", "may"], file, [...path, "severity"]),
			enforcement: oneOf(section.enforcement, ["prompt", "schema", "host"], file, [...path, "enforcement"]),
			optimizable: section.optimizable,
			locales: {
				[config.authoring.sourceLocale]: normalizeText(section.text, file, [...path, "text"]),
				...parseTranslations(
					section.translations,
					file,
					[...path, "translations"],
					config.authoring.sourceLocale,
				),
			},
		};
	});
}

export function parseAndResolveAuthoring(
	input: unknown,
	file: string,
	sourcePath: string,
	config: S11tnextProjectConfig,
	releaseProfile: string,
	options: { validateRequiredCoverage?: boolean } = {},
): ResolvedAuthoringDocument {
	const source = object(input, file, []);
	exactKeys(source, ["content_kind", "text", "translations", "variables", "sections"], [], file, []);
	const key = deriveKey(sourcePath, file);
	if (source.content_kind !== undefined && source.content_kind !== "text") {
		issue(file, "S11TNEXT_SOURCE_INVALID", "Only text content is supported", ["content_kind"]);
	}
	const hasText = Object.hasOwn(source, "text");
	const hasSections = Object.hasOwn(source, "sections");
	if (hasText === hasSections) issue(file, "S11TNEXT_SOURCE_SHAPE_CONFLICT", "Define exactly one of text or sections", []);
	if (hasSections && Object.hasOwn(source, "translations")) {
		issue(file, "S11TNEXT_SOURCE_SHAPE_CONFLICT", "Root translations are only valid with root text", ["translations"]);
	}
	const owner = resolveOwner(key, config, file);
	const requiredLocales = resolveRequiredLocales(config, releaseProfile, file);
	const variables = parseVariables(source.variables, config, file);
	const sections = hasText
		? [simpleSection(source.text, source.translations, config, file)]
		: parseSections(source.sections, config, file);
	validateCoverage(
		sections,
		requiredLocales,
		file,
		options.validateRequiredCoverage !== false,
	);
	validateVariableReferences(sections, variables.definitions, config.authoring.sourceLocale, file);
	return {
		file,
		sourcePath,
		definition: {
			key,
			owner: owner.value,
			contentKind: "text",
			sourceLocale: config.authoring.sourceLocale,
			requiredLocales,
			variables: variables.definitions,
			sections,
		},
		origins: {
			key: `path:${sourcePath}`,
			owner: owner.source,
			contentKind: "built-in:text",
			sourceLocale: "authoring.source_locale",
			requiredLocales: `release_profiles.${releaseProfile}`,
			variables: variables.origins,
		},
	};
}

export function validateResolvedDocuments(
	documents: readonly ResolvedAuthoringDocument[],
): void {
	const keys = new Map<string, string>();
	for (const document of documents) {
		const previous = keys.get(document.definition.key);
		if (previous !== undefined) {
			issue(document.file, "S11TNEXT_KEY_COLLISION", `Context key is also defined in ${previous}`, ["key"]);
		}
		keys.set(document.definition.key, document.file);
	}
}
