import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";
import { parseProjectConfigV2, type S11tProjectConfigV2 } from "./config-v2.js";

export type S11tProjectConfigV1 = {
	schemaVersion: 1;
	sourceDir: string;
	outDir: string;
	requiredLocales: string[];
	defaultLocale: string;
};

export type S11tProjectConfig = S11tProjectConfigV1 | S11tProjectConfigV2;
export type { S11tProjectConfigV2 } from "./config-v2.js";

const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

function issue(file: string, code: string, message: string, path: Array<string | number>): never {
	const diagnostic: S11tDiagnostic = { code, severity: "error", message, file, path };
	throw new S11tDiagnosticError([diagnostic]);
}

function object(value: unknown, file: string, path: Array<string | number>): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return issue(file, "S11T_CONFIG_INVALID", "Expected an object", path);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		return issue(file, "S11T_CONFIG_INVALID", "Expected a plain object", path);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") return issue(file, "S11T_CONFIG_INVALID", "Symbol properties are not supported", path);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			return issue(file, "S11T_CONFIG_INVALID", "Expected enumerable data properties", [...path, key]);
		}
	}
	return value as Record<string, unknown>;
}

function string(value: unknown, file: string, path: Array<string | number>): string {
	if (typeof value !== "string" || value.length === 0) {
		return issue(file, "S11T_CONFIG_INVALID", "Expected a non-empty string", path);
	}
	return value;
}

function relativeDirectory(value: unknown, file: string, path: Array<string | number>): string {
	const result = string(value, file, path).replaceAll("\\", "/");
	if (
		result.includes("\0") ||
		result.startsWith("/") ||
		/^[A-Za-z]:\//.test(result) ||
		result.split("/").includes("..")
	) {
		return issue(file, "S11T_CONFIG_INVALID", "Expected a relative directory without parent traversal", path);
	}
	const normalized = result.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
	return normalized === "" ? "." : normalized;
}

function localeArray(value: unknown, file: string, path: Array<string | number>): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		return issue(file, "S11T_CONFIG_INVALID", "Expected a non-empty locale array", path);
	}
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, index);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			return issue(file, "S11T_CONFIG_INVALID", "Expected a dense data array", [...path, index]);
		}
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) {
		return issue(file, "S11T_CONFIG_INVALID", "Array properties are not supported", path);
	}
	const locales = value.map((entry, index) => string(entry, file, [...path, index]));
	for (const [index, locale] of locales.entries()) {
		if (!LOCALE_PATTERN.test(locale)) {
			return issue(file, "S11T_CONFIG_INVALID", "Expected a supported locale identifier", [...path, index]);
		}
	}
	if (new Set(locales).size !== locales.length) {
		return issue(file, "S11T_CONFIG_INVALID", "Locales must be unique", path);
	}
	return locales;
}

export function parseProjectConfig(input: unknown, file = "s11t.config.toml"): S11tProjectConfig {
	const source = object(input, file, []);
	if (source.schema_version === 2) return parseProjectConfigV2(source, file);
	const allowed = new Set([
		"schema_version",
		"source_dir",
		"out_dir",
		"required_locales",
		"default_locale",
	]);
	for (const key of Object.keys(source)) {
		if (!allowed.has(key)) issue(file, "S11T_CONFIG_INVALID", `Unsupported config field: ${key}`, [key]);
	}
	if (source.schema_version !== 1) {
		return issue(file, "S11T_SCHEMA_VERSION_UNSUPPORTED", "Only config schema_version = 1 is supported", ["schema_version"]);
	}
	const requiredLocales = localeArray(source.required_locales, file, ["required_locales"]);
	const defaultLocale = string(source.default_locale, file, ["default_locale"]);
	if (!requiredLocales.includes(defaultLocale)) {
		return issue(file, "S11T_CONFIG_INVALID", "default_locale must be included in required_locales", ["default_locale"]);
	}
	return {
		schemaVersion: 1,
		sourceDir: relativeDirectory(source.source_dir, file, ["source_dir"]),
		outDir: relativeDirectory(source.out_dir, file, ["out_dir"]),
		requiredLocales,
		defaultLocale,
	};
}
