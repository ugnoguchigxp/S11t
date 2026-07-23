import type { CanonicalVariableDefinition } from "@s11t/runtime/compiler";

import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";

export type S11tReleaseProfile = {
	requiredLocales: string[];
};

export type S11tProjectConfig = {
	sourceDir: string;
	outDir: string;
	authoring: { sourceLocale: string };
	governance: { requireOwner: boolean };
	keyspaces: Record<string, { owner: string }>;
	releaseProfiles: Record<string, S11tReleaseProfile>;
	variableProfiles: Record<string, CanonicalVariableDefinition>;
	keyAliases: Record<string, string>;
};

type Path = Array<string | number>;
type UnknownRecord = Record<string, unknown>;

const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const DOT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/;
const PROFILE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

function issue(file: string, message: string, path: Path): never {
	const diagnostic: S11tDiagnostic = {
		code: "S11T_CONFIG_INVALID",
		severity: "error",
		message,
		file,
		path,
	};
	throw new S11tDiagnosticError([diagnostic]);
}

function object(value: unknown, file: string, path: Path): UnknownRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return issue(file, "Expected an object", path);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		return issue(file, "Expected a plain object", path);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") return issue(file, "Symbol properties are not supported", path);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			return issue(file, "Expected enumerable data properties", [...path, key]);
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
		if (!allowedSet.has(key)) issue(file, `Unsupported config field: ${key}`, [...path, key]);
	}
	for (const key of required) {
		if (!Object.hasOwn(value, key)) issue(file, `Missing required config field: ${key}`, [...path, key]);
	}
}

function string(value: unknown, file: string, path: Path): string {
	if (typeof value !== "string" || value.length === 0) {
		return issue(file, "Expected a non-empty string", path);
	}
	return value;
}

function relativeDirectory(value: unknown, file: string, path: Path): string {
	const result = string(value, file, path).replaceAll("\\", "/");
	if (
		result.includes("\0") ||
		result.startsWith("/") ||
		/^[A-Za-z]:\//.test(result) ||
		result.split("/").includes("..")
	) {
		return issue(file, "Expected a relative directory without parent traversal", path);
	}
	const normalized = result.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
	return normalized === "" ? "." : normalized;
}

function locale(value: unknown, file: string, path: Path): string {
	const result = string(value, file, path);
	if (!LOCALE_PATTERN.test(result)) issue(file, "Expected a supported locale identifier", path);
	return result;
}

function localeArray(value: unknown, file: string, path: Path): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		return issue(file, "Expected a non-empty locale array", path);
	}
	const result = value.map((entry, index) => {
		if (entry === "$source") return "$source";
		return locale(entry, file, [...path, index]);
	});
	if (new Set(result).size !== result.length) issue(file, "Locales must be unique", path);
	return result;
}

function parseVariableProfiles(
	input: unknown,
	file: string,
): Record<string, CanonicalVariableDefinition> {
	if (input === undefined) return {};
	const source = object(input, file, ["variable_profiles"]);
	const result: Record<string, CanonicalVariableDefinition> = {};
	for (const [name, value] of Object.entries(source)) {
		const path = ["variable_profiles", name] satisfies Path;
		if (!PROFILE_NAME_PATTERN.test(name)) issue(file, "Invalid variable profile name", path);
		const profile = object(value, file, path);
		exactKeys(profile, ["type", "trust", "placement", "encoding"], ["type", "trust", "placement", "encoding"], file, path);
		const type = string(profile.type, file, [...path, "type"]);
		const trust = string(profile.trust, file, [...path, "trust"]);
		const placement = string(profile.placement, file, [...path, "placement"]);
		const encoding = string(profile.encoding, file, [...path, "encoding"]);
		if (!["string", "number", "boolean", "json"].includes(type)) issue(file, "Invalid variable type", [...path, "type"]);
		if (!["trusted", "untrusted"].includes(trust)) issue(file, "Invalid variable trust", [...path, "trust"]);
		if (!["inline", "delimited-context"].includes(placement)) issue(file, "Invalid variable placement", [...path, "placement"]);
		if (!["raw", "json-string", "json-value"].includes(encoding)) issue(file, "Invalid variable encoding", [...path, "encoding"]);
		if (trust === "untrusted" && encoding === "raw") issue(file, "Untrusted variables cannot use raw encoding", [...path, "encoding"]);
		if (trust === "untrusted" && placement !== "delimited-context") {
			issue(
				file,
				"Untrusted variables require delimited-context placement",
				[...path, "placement"],
			);
		}
		if (encoding === "raw" && type !== "string") issue(file, "raw encoding only supports string variables", [...path, "encoding"]);
		if (encoding === "json-string" && type === "json") issue(file, "json-string does not support json variables", [...path, "encoding"]);
		result[name] = {
			required: true,
				type: type as CanonicalVariableDefinition["type"],
				trust: trust as CanonicalVariableDefinition["trust"],
				placement: placement as CanonicalVariableDefinition["placement"],
				encoding: encoding as CanonicalVariableDefinition["encoding"],
		};
	}
	return result;
}

export function parseProjectConfig(
	input: unknown,
	file = "s11t.config.toml",
): S11tProjectConfig {
	const source = object(input, file, []);
	exactKeys(
		source,
		[
			"source_dir",
			"out_dir",
			"authoring",
			"governance",
			"keyspaces",
			"release_profiles",
			"variable_profiles",
			"key_aliases",
		],
		[
			"source_dir",
			"out_dir",
			"authoring",
			"governance",
			"keyspaces",
			"release_profiles",
		],
		file,
		[],
	);
	const authoring = object(source.authoring, file, ["authoring"]);
	exactKeys(authoring, ["source_locale"], ["source_locale"], file, ["authoring"]);
	const governance = object(source.governance, file, ["governance"]);
	exactKeys(governance, ["require_owner"], ["require_owner"], file, ["governance"]);
	if (typeof governance.require_owner !== "boolean") issue(file, "Expected a boolean", ["governance", "require_owner"]);

	const keyspaceSource = object(source.keyspaces, file, ["keyspaces"]);
	const keyspaces: Record<string, { owner: string }> = {};
	for (const [prefix, value] of Object.entries(keyspaceSource)) {
		if (!DOT_KEY_PATTERN.test(prefix)) issue(file, "Invalid keyspace prefix", ["keyspaces", prefix]);
		const entry = object(value, file, ["keyspaces", prefix]);
		exactKeys(entry, ["owner"], ["owner"], file, ["keyspaces", prefix]);
		keyspaces[prefix] = { owner: string(entry.owner, file, ["keyspaces", prefix, "owner"]) };
	}

	const releaseSource = object(source.release_profiles, file, ["release_profiles"]);
	const releaseProfiles: Record<string, S11tReleaseProfile> = {};
	for (const [name, value] of Object.entries(releaseSource)) {
		if (!PROFILE_NAME_PATTERN.test(name)) issue(file, "Invalid release profile name", ["release_profiles", name]);
		const entry = object(value, file, ["release_profiles", name]);
		exactKeys(entry, ["required_locales"], ["required_locales"], file, ["release_profiles", name]);
		releaseProfiles[name] = {
			requiredLocales: localeArray(entry.required_locales, file, ["release_profiles", name, "required_locales"]),
		};
	}
	if (Object.keys(releaseProfiles).length === 0) issue(file, "At least one release profile is required", ["release_profiles"]);

	const aliasSource = source.key_aliases === undefined ? {} : object(source.key_aliases, file, ["key_aliases"]);
	const keyAliases: Record<string, string> = {};
	for (const [alias, value] of Object.entries(aliasSource)) {
		if (!DOT_KEY_PATTERN.test(alias)) issue(file, "Alias key must use dot notation", ["key_aliases", alias]);
		const target = string(value, file, ["key_aliases", alias]);
		if (!DOT_KEY_PATTERN.test(target)) issue(file, "Alias target must be a dot key", ["key_aliases", alias]);
		keyAliases[alias] = target;
	}

	return {
		sourceDir: relativeDirectory(source.source_dir, file, ["source_dir"]),
		outDir: relativeDirectory(source.out_dir, file, ["out_dir"]),
		authoring: { sourceLocale: locale(authoring.source_locale, file, ["authoring", "source_locale"]) },
		governance: { requireOwner: governance.require_owner },
		keyspaces,
		releaseProfiles,
		variableProfiles: parseVariableProfiles(source.variable_profiles, file),
		keyAliases,
	};
}
