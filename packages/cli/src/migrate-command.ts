import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

import type { CanonicalVariableDefinition } from "@s11t/runtime/compiler";
import { parse } from "smol-toml";

import type { AuthoringDocument } from "./authoring-schema.js";
import {
	parseAndResolveAuthoringV2,
	validateResolvedDocumentsV2,
	type ResolvedAuthoringDocumentV2,
} from "./authoring-v2.js";
import { parseProjectConfigV2 } from "./config-v2.js";
import {
	loadProject,
	type LoadedProject,
	type LoadedProjectV1,
	type LoadedProjectV2,
} from "./discover.js";
import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";

export type AuthoringV2MigrationResult = {
	written: boolean;
	contexts: number;
	profiles: number;
	aliases: number;
	mappings: Array<{ file: string; oldKey: string; canonicalKey: string }>;
};

function diagnostic(message: string, file: string, path: Array<string | number> = []): never {
	const value: S11tDiagnostic = {
		code: "S11T_AUTHORING_MIGRATION_DRIFT",
		severity: "error",
		message,
		file,
		path,
	};
	throw new S11tDiagnosticError([value]);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function variableSignature(variable: CanonicalVariableDefinition): string {
	return [variable.type, variable.trust, variable.placement, variable.encoding].join("|");
}

function profileName(variable: CanonicalVariableDefinition): string {
	const signature = variableSignature(variable);
	const names: Record<string, string> = {
		"string|trusted|inline|raw": "trusted.inline",
		"string|trusted|delimited-context|raw": "trusted.block",
		"string|untrusted|delimited-context|json-string": "untrusted.text",
		"json|untrusted|delimited-context|json-value": "untrusted.json",
		"json|trusted|delimited-context|json-value": "trusted.json",
		"number|trusted|inline|json-value": "trusted.number",
	};
	return names[signature] ?? `${variable.trust}.${variable.type}.${variable.placement}.${variable.encoding}`;
}

function quoted(value: string): string {
	return JSON.stringify(value);
}

function literalText(value: string): string {
	if (value.includes("'''")) return JSON.stringify(value);
	return `'''${value}'''`;
}

function canonicalKey(sourceDir: string, sourceFile: string): string {
	const path = relative(sourceDir, sourceFile)
		.replaceAll("\\", "/")
		.replace(/\.context\.toml$/, "");
	return path.replaceAll("/", ".");
}

function serializeConfig(input: {
	sourceDir: string;
	outDir: string;
	sourceLocale: string;
	requiredLocales: string[];
	owners: Record<string, string>;
	profiles: Record<string, CanonicalVariableDefinition>;
	aliases: Record<string, string>;
}): string {
	const lines = [
		"schema_version = 2",
		"authoring_version = 2",
		"artifact_version = 2",
		`source_dir = ${quoted(input.sourceDir)}`,
		`out_dir = ${quoted(input.outDir)}`,
		"",
		"[authoring]",
		`source_locale = ${quoted(input.sourceLocale)}`,
		"",
		"[governance]",
		"require_owner = true",
	];
	for (const [prefix, owner] of Object.entries(input.owners).sort(([left], [right]) => compareCodeUnits(left, right))) {
		lines.push("", `[keyspaces.${quoted(prefix)}]`, `owner = ${quoted(owner)}`);
	}
	lines.push(
		"",
		"[release_profiles.development]",
		`required_locales = [${input.requiredLocales.map(quoted).join(", ")}]`,
	);
	for (const [name, profile] of Object.entries(input.profiles).sort(([left], [right]) => compareCodeUnits(left, right))) {
		lines.push(
			"",
			`[variable_profiles.${quoted(name)}]`,
			`type = ${quoted(profile.type)}`,
			`trust = ${quoted(profile.trust)}`,
			`placement = ${quoted(profile.placement)}`,
			`encoding = ${quoted(profile.encoding)}`,
		);
	}
	lines.push("", "[key_aliases]");
	for (const [alias, target] of Object.entries(input.aliases).sort(([left], [right]) => compareCodeUnits(left, right))) {
		lines.push(`${quoted(alias)} = ${quoted(target)}`);
	}
	return `${lines.join("\n")}\n`;
}

function serializeV1Document(document: AuthoringDocument, profiles: Map<string, string>): string {
	const lines: string[] = [];
	const sections = document.definition.sections;
	const simple =
		sections.length === 1 &&
		sections[0]?.id === "context.text" &&
		sections[0]?.kind === "instruction" &&
		sections[0]?.severity === "must" &&
		sections[0]?.enforcement === "prompt" &&
		sections[0]?.optimizable === false;
	if (simple) {
		const section = sections[0]!;
		lines.push(`text = ${literalText(section.locales[document.definition.sourceLocale]!)}`);
		for (const [locale, text] of Object.entries(section.locales).sort(([left], [right]) => compareCodeUnits(left, right))) {
			if (locale === document.definition.sourceLocale) continue;
			lines.push("", `[translations.${quoted(locale)}]`, `text = ${literalText(text)}`);
		}
	} else {
		for (const section of sections) {
			lines.push(
				...(lines.length === 0 ? [] : [""]),
				"[[sections]]",
				`id = ${quoted(section.id)}`,
				`kind = ${quoted(section.kind)}`,
				`severity = ${quoted(section.severity)}`,
				`enforcement = ${quoted(section.enforcement)}`,
				`optimizable = ${String(section.optimizable)}`,
				`text = ${literalText(section.locales[document.definition.sourceLocale]!)}`,
			);
			for (const [locale, text] of Object.entries(section.locales).sort(([left], [right]) => compareCodeUnits(left, right))) {
				if (locale === document.definition.sourceLocale) continue;
				lines.push("", `[sections.translations.${quoted(locale)}]`, `text = ${literalText(text)}`);
			}
		}
	}
	for (const [name, variable] of Object.entries(document.definition.variables).sort(([left], [right]) => compareCodeUnits(left, right))) {
		const profile = profiles.get(variableSignature(variable));
		if (profile === undefined) throw new Error(`Missing variable profile for ${name}`);
		lines.push("", `[variables.${name}]`, `profile = ${quoted(profile)}`);
	}
	return `${lines.join("\n")}\n`;
}

function atomicWrite(path: string, bytes: string): void {
	const temporary = resolve(path, `../.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
	try {
		writeFileSync(temporary, bytes, { encoding: "utf8", flag: "wx", mode: 0o644 });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function semanticSnapshot(definition: {
	owner: string;
	sourceLocale: string;
	requiredLocales: string[];
	variables: Record<string, CanonicalVariableDefinition>;
	sections: AuthoringDocument["definition"]["sections"];
}): string {
	return JSON.stringify({
		owner: definition.owner,
		sourceLocale: definition.sourceLocale,
		requiredLocales: [...definition.requiredLocales].sort(compareCodeUnits),
		variables: Object.fromEntries(
			Object.entries(definition.variables).sort(([left], [right]) => compareCodeUnits(left, right)),
		),
		sections: definition.sections.map((section) => ({
			id: section.id,
			kind: section.kind,
			severity: section.severity,
			enforcement: section.enforcement,
			optimizable: section.optimizable,
			locales: Object.fromEntries(
				Object.entries(section.locales).sort(([left], [right]) => compareCodeUnits(left, right)),
			),
		})),
	});
}

function parseSerializedToml(bytes: string, file: string): unknown {
	try {
		return parse(bytes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return diagnostic(`Generated TOML is invalid: ${message}`, file);
	}
}

function validateMigrationPlan(
	project: LoadedProjectV1,
	writes: ReadonlyMap<string, string>,
	mappings: AuthoringV2MigrationResult["mappings"],
): void {
	const configBytes = writes.get(project.configPath);
	if (configBytes === undefined) {
		diagnostic("Migration plan is missing the generated config", project.configPath);
	}
	const config = parseProjectConfigV2(
		parseSerializedToml(configBytes, project.configPath),
		project.configPath,
	);
	const mappingByFile = new Map(mappings.map((mapping) => [mapping.file, mapping]));
	const resolvedDocuments: ResolvedAuthoringDocumentV2[] = [];
	for (const before of project.documents) {
		const absolutePath = resolve(project.configDirectory, before.file);
		const bytes = writes.get(absolutePath);
		if (bytes === undefined) {
			diagnostic("Migration plan is missing a generated context", before.file);
		}
		const sourcePath = relative(project.config.sourceDir, before.file).replaceAll("\\", "/");
		const after = parseAndResolveAuthoringV2(
			parseSerializedToml(bytes, before.file),
			before.file,
			sourcePath,
			config,
			"development",
		);
		const mapping = mappingByFile.get(before.file);
		if (
			mapping === undefined ||
			after.definition.key !== mapping.canonicalKey ||
			semanticSnapshot(before.definition) !== semanticSnapshot(after.definition)
		) {
			diagnostic(
				"Migration changed content, variable, section, owner, or locale semantics",
				before.file,
			);
		}
		resolvedDocuments.push(after);
	}
	const aliases = validateResolvedDocumentsV2(resolvedDocuments, config);
	for (const mapping of mappings) {
		if (aliases[mapping.oldKey] !== mapping.canonicalKey) {
			diagnostic(`Migration did not preserve alias ${mapping.oldKey}`, project.configPath, [
				"key_aliases",
				mapping.oldKey,
			]);
		}
	}
}

export function migrateAuthoringV2(
	options: { config?: string; cwd?: string; write?: boolean } = {},
): AuthoringV2MigrationResult {
	const project = loadProject(options.config, options.cwd);
	if (!isLoadedProjectV1(project)) {
		return diagnostic("authoring-v2 migration requires a config v1 project", project.configPath);
	}
	const owners: Record<string, string> = {};
	const profileBySignature = new Map<string, string>();
	const profiles: Record<string, CanonicalVariableDefinition> = {};
	const aliases: Record<string, string> = {};
	const sourceLocales = new Set<string>();
	const mappings: AuthoringV2MigrationResult["mappings"] = [];
	const writes = new Map<string, string>();
	for (const document of project.documents) {
		sourceLocales.add(document.definition.sourceLocale);
		const key = canonicalKey(project.config.sourceDir, document.file);
		const prefix = key.split(".")[0]!;
		const previousOwner = owners[prefix];
		if (previousOwner !== undefined && previousOwner !== document.definition.owner) {
			return diagnostic(`Keyspace ${prefix} has multiple owners`, document.file, ["context", "owner"]);
		}
		owners[prefix] = document.definition.owner;
		aliases[document.definition.id] = key;
		mappings.push({ file: document.file, oldKey: document.definition.id, canonicalKey: key });
		for (const variable of Object.values(document.definition.variables)) {
			const signature = variableSignature(variable);
			if (!profileBySignature.has(signature)) {
				const name = profileName(variable);
				profileBySignature.set(signature, name);
				profiles[name] = variable;
			}
		}
	}
	if (sourceLocales.size !== 1) {
		return diagnostic("All v1 contexts must share one source_locale before migration", project.configPath);
	}
	const sourceLocale = [...sourceLocales][0]!;
	for (const document of project.documents) {
		writes.set(resolve(project.configDirectory, document.file), serializeV1Document(document, profileBySignature));
	}
	writes.set(
		project.configPath,
		serializeConfig({
			sourceDir: project.config.sourceDir,
			outDir: project.config.outDir,
			sourceLocale,
			requiredLocales: project.config.requiredLocales,
			owners,
			profiles,
			aliases,
		}),
	);
	validateMigrationPlan(project, writes, mappings);
	if (options.write === true) {
		const originals = new Map<string, string>();
		try {
			for (const [path, bytes] of writes) {
				originals.set(path, readFileSync(path, "utf8"));
				atomicWrite(path, bytes);
			}
			const migrated = loadProject(options.config, options.cwd, "development");
			if (!isLoadedProjectV2(migrated)) {
				return diagnostic("Migration did not produce a config v2 project", project.configPath);
			}
			for (const before of project.documents) {
				const mapping = mappings.find((candidate) => candidate.file === before.file)!;
				const after = migrated.documents.find(
					(document) => document.definition.key === mapping.canonicalKey,
				);
				if (
					after === undefined ||
					semanticSnapshot(before.definition) !== semanticSnapshot(after.definition)
				) {
					return diagnostic("Migration changed content, variable, section, owner, or locale semantics", before.file);
				}
			}
		} catch (error) {
			const rollbackErrors: unknown[] = [];
			for (const [path, bytes] of [...originals].reverse()) {
				try {
					atomicWrite(path, bytes);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (rollbackErrors.length > 0) {
				throw new AggregateError(
					[error, ...rollbackErrors],
					"Migration failed and rollback was incomplete",
				);
			}
			throw error;
		}
	}
	return {
		written: options.write === true,
		contexts: project.documents.length,
		profiles: Object.keys(profiles).length,
		aliases: Object.keys(aliases).length,
		mappings,
	};
}

function isLoadedProjectV1(project: LoadedProject): project is LoadedProjectV1 {
	return project.config.schemaVersion === 1;
}

function isLoadedProjectV2(project: LoadedProject): project is LoadedProjectV2 {
	return project.config.schemaVersion === 2;
}
