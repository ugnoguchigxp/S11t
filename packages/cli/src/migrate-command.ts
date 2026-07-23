import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

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
import { resolvesWithin } from "./path-safety.js";

export type AuthoringV2MigrationResult = {
	written: boolean;
	restored: boolean;
	operationId?: string;
	contexts: number;
	profiles: number;
	aliases: number;
	mappings: Array<{ file: string; oldKey: string; canonicalKey: string }>;
};

type MigrationManifest = {
	schemaVersion: 1;
	operation: "authoring-v2";
	operationId: string;
	state: "prepared" | "committed" | "rolled-back";
	configPath: string;
	summary: {
		contexts: number;
		profiles: number;
		aliases: number;
		mappings: AuthoringV2MigrationResult["mappings"];
	};
	files: Array<{
		path: string;
		backup: string;
		beforeSha256: string;
		afterSha256: string;
	}>;
};

const OPERATION_ID_PATTERN = /^authoring-v2-[0-9a-f]{24}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function diagnostic(
	message: string,
	file: string,
	path: Array<string | number> = [],
	code = "S11T_AUTHORING_MIGRATION_DRIFT",
): never {
	const value: S11tDiagnostic = {
		code,
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

function comparePaths(left: string, right: string): number {
	return compareCodeUnits(left.replaceAll("\\", "/"), right.replaceAll("\\", "/"));
}

function sha256(bytes: string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function migrationRoot(configDirectory: string): string {
	const root = resolve(configDirectory, ".s11t/migrations");
	if (!resolvesWithin(configDirectory, root)) {
		return diagnostic(
			"Migration backup directory resolves outside the config directory",
			root,
			[],
			"S11T_AUTHORING_MIGRATION_INVALID",
		);
	}
	return root;
}

function operationDirectory(configDirectory: string, operationId: string): string {
	if (!OPERATION_ID_PATTERN.test(operationId)) {
		return diagnostic(
			"Invalid migration operation ID",
			"s11t.config.toml",
			["operationId"],
			"S11T_AUTHORING_MIGRATION_INVALID",
		);
	}
	return resolve(migrationRoot(configDirectory), operationId);
}

function relativeMigrationPath(configDirectory: string, path: string): string {
	const result = relative(configDirectory, path);
	if (result === "" || isAbsolute(result) || result === ".." || result.startsWith(`..${sep}`)) {
		return diagnostic(
			"Migration target escapes the config directory",
			path,
			[],
			"S11T_AUTHORING_MIGRATION_INVALID",
		);
	}
	return result.replaceAll("\\", "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseManifest(input: unknown, file: string): MigrationManifest {
	if (!isRecord(input)) {
		return diagnostic("Invalid migration manifest", file, [], "S11T_AUTHORING_MIGRATION_INVALID");
	}
	const manifest = input as Partial<MigrationManifest>;
	const summary = manifest.summary;
	if (
		manifest.schemaVersion !== 1 ||
		manifest.operation !== "authoring-v2" ||
		typeof manifest.operationId !== "string" ||
		!OPERATION_ID_PATTERN.test(manifest.operationId) ||
		!["prepared", "committed", "rolled-back"].includes(manifest.state ?? "") ||
		typeof manifest.configPath !== "string" ||
		!isRecord(summary) ||
		!Array.isArray(summary.mappings) ||
		!Number.isSafeInteger(summary.contexts) ||
		(summary.contexts as number) < 0 ||
		!Number.isSafeInteger(summary.profiles) ||
		(summary.profiles as number) < 0 ||
		!Number.isSafeInteger(summary.aliases) ||
		(summary.aliases as number) < 0 ||
		!Array.isArray(manifest.files) ||
		manifest.files.length === 0
	) {
		return diagnostic("Invalid migration manifest", file, [], "S11T_AUTHORING_MIGRATION_INVALID");
	}
	const mappingFiles = new Set<string>();
	for (const [index, mapping] of summary.mappings.entries()) {
		if (
			!isRecord(mapping) ||
			typeof mapping.file !== "string" ||
			mapping.file.length === 0 ||
			typeof mapping.oldKey !== "string" ||
			mapping.oldKey.length === 0 ||
			typeof mapping.canonicalKey !== "string" ||
			mapping.canonicalKey.length === 0 ||
			mappingFiles.has(mapping.file)
		) {
			return diagnostic(
				"Invalid migration manifest mapping",
				file,
				["summary", "mappings", index],
				"S11T_AUTHORING_MIGRATION_INVALID",
			);
		}
		mappingFiles.add(mapping.file);
	}
	const paths = new Set<string>();
	const backups = new Set<string>();
	for (const [index, entry] of manifest.files.entries()) {
		if (
			!isRecord(entry) ||
			typeof entry.path !== "string" ||
			entry.path.length === 0 ||
			typeof entry.backup !== "string" ||
			!/^[^/\\]+\.bak$/.test(entry.backup) ||
			typeof entry.beforeSha256 !== "string" ||
			!SHA256_PATTERN.test(entry.beforeSha256) ||
			typeof entry.afterSha256 !== "string" ||
			!SHA256_PATTERN.test(entry.afterSha256) ||
			paths.has(entry.path) ||
			backups.has(entry.backup)
		) {
			return diagnostic(
				"Invalid migration manifest file entry",
				file,
				["files", index],
				"S11T_AUTHORING_MIGRATION_INVALID",
			);
		}
		paths.add(entry.path);
		backups.add(entry.backup);
	}
	const expectedPaths = new Set([manifest.configPath, ...mappingFiles]);
	if (
		summary.contexts !== summary.mappings.length ||
		summary.aliases !== summary.contexts ||
		paths.size !== expectedPaths.size ||
		[...paths].some((path) => !expectedPaths.has(path))
	) {
		return diagnostic(
			"Migration manifest summary does not match its file set",
			file,
			["summary"],
			"S11T_AUTHORING_MIGRATION_INVALID",
		);
	}
	return manifest as MigrationManifest;
}

function readManifest(configDirectory: string, operationId: string): MigrationManifest {
	const directory = operationDirectory(configDirectory, operationId);
	const manifestPath = resolve(directory, "manifest.json");
	let input: unknown;
	try {
		input = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return diagnostic(
			`Unable to read migration manifest: ${message}`,
			manifestPath,
			[],
			"S11T_AUTHORING_MIGRATION_INVALID",
		);
	}
	const manifest = parseManifest(input, manifestPath);
	if (manifest.operationId !== operationId) {
		return diagnostic(
			"Migration manifest operation ID does not match its directory",
			manifestPath,
			["operationId"],
			"S11T_AUTHORING_MIGRATION_INVALID",
		);
	}
	return manifest;
}

function writeManifest(configDirectory: string, manifest: MigrationManifest): void {
	const path = resolve(operationDirectory(configDirectory, manifest.operationId), "manifest.json");
	atomicWrite(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function pendingMigration(configDirectory: string): string | undefined {
	const root = migrationRoot(configDirectory);
	if (!existsSync(root)) return undefined;
	for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) =>
		compareCodeUnits(left.name, right.name),
	)) {
		if (!entry.isDirectory() || !OPERATION_ID_PATTERN.test(entry.name)) continue;
		const manifest = readManifest(configDirectory, entry.name);
		if (manifest.state === "prepared") return entry.name;
	}
	return undefined;
}

function prepareMigration(
	project: LoadedProjectV1,
	writes: ReadonlyMap<string, string>,
	summary: MigrationManifest["summary"],
): MigrationManifest {
	const operationId = `authoring-v2-${randomBytes(12).toString("hex")}`;
	const root = migrationRoot(project.configDirectory);
	mkdirSync(root, { recursive: true });
	const preparingDirectory = resolve(root, `.preparing-${operationId}`);
	const preparedDirectory = operationDirectory(project.configDirectory, operationId);
	mkdirSync(preparingDirectory, { recursive: false, mode: 0o700 });
	try {
		const files = [...writes.entries()]
			.sort(([left], [right]) => comparePaths(left, right))
			.map(([path, afterBytes], index) => {
				const beforeBytes = readFileSync(path, "utf8");
				const backup = `${String(index).padStart(4, "0")}.bak`;
				writeFileSync(resolve(preparingDirectory, backup), beforeBytes, {
					encoding: "utf8",
					flag: "wx",
					mode: 0o600,
				});
				return {
					path: relativeMigrationPath(project.configDirectory, path),
					backup,
					beforeSha256: sha256(beforeBytes),
					afterSha256: sha256(afterBytes),
				};
			});
		const manifest: MigrationManifest = {
			schemaVersion: 1,
			operation: "authoring-v2",
			operationId,
			state: "prepared",
			configPath: relativeMigrationPath(project.configDirectory, project.configPath),
			summary,
			files,
		};
		writeFileSync(resolve(preparingDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		renameSync(preparingDirectory, preparedDirectory);
		return manifest;
	} catch (error) {
		rmSync(preparingDirectory, { recursive: true, force: true });
		throw error;
	}
}

function restoreFiles(configDirectory: string, manifest: MigrationManifest): void {
	const directory = operationDirectory(configDirectory, manifest.operationId);
	const restorePlan = manifest.files.map((entry) => {
		const path = resolve(configDirectory, entry.path);
		if (
			relativeMigrationPath(configDirectory, path) !== entry.path ||
			!resolvesWithin(configDirectory, path)
		) {
			return diagnostic(
				"Migration manifest contains a non-canonical target path",
				resolve(directory, "manifest.json"),
				["files", entry.path],
				"S11T_AUTHORING_MIGRATION_INVALID",
			);
		}
		const backupPath = resolve(directory, entry.backup);
		const bytes = readFileSync(backupPath, "utf8");
		if (sha256(bytes) !== entry.beforeSha256) {
			return diagnostic(
				"Migration backup checksum mismatch",
				backupPath,
				[],
				"S11T_AUTHORING_MIGRATION_INVALID",
			);
		}
		const current = readFileSync(path, "utf8");
		const currentSha256 = sha256(current);
		if (currentSha256 !== entry.beforeSha256 && currentSha256 !== entry.afterSha256) {
			return diagnostic(
				"Migration target changed after the operation; refusing to overwrite it",
				path,
				[],
				"S11T_AUTHORING_MIGRATION_DRIFT",
			);
		}
		return { path, bytes, beforeSha256: entry.beforeSha256 };
	});
	for (const entry of restorePlan) atomicWrite(entry.path, entry.bytes);
	for (const entry of restorePlan) {
		if (sha256(readFileSync(entry.path, "utf8")) !== entry.beforeSha256) {
			throw new Error(`Migration restore verification failed for ${entry.path}`);
		}
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
	options: { config?: string; cwd?: string; write?: boolean; restore?: string } = {},
): AuthoringV2MigrationResult {
	if (options.restore !== undefined) {
		if (options.write === true) {
			return diagnostic(
				"--write and --restore cannot be used together",
				options.config ?? "s11t.config.toml",
				[],
				"S11T_AUTHORING_MIGRATION_INVALID",
			);
		}
		const configPath = resolve(options.cwd ?? process.cwd(), options.config ?? "s11t.config.toml");
		const configDirectory = dirname(configPath);
		const manifest = readManifest(configDirectory, options.restore);
		if (manifest.configPath !== relativeMigrationPath(configDirectory, configPath)) {
			return diagnostic(
				"Migration manifest belongs to a different config",
				resolve(operationDirectory(configDirectory, options.restore), "manifest.json"),
				["configPath"],
				"S11T_AUTHORING_MIGRATION_INVALID",
			);
		}
		if (manifest.state === "rolled-back") {
			return diagnostic(
				"Migration operation has already been restored",
				resolve(operationDirectory(configDirectory, options.restore), "manifest.json"),
				["state"],
				"S11T_AUTHORING_MIGRATION_INVALID",
			);
		}
		restoreFiles(configDirectory, manifest);
		manifest.state = "rolled-back";
		writeManifest(configDirectory, manifest);
		return {
			written: false,
			restored: true,
			operationId: manifest.operationId,
			...manifest.summary,
		};
	}
	if (options.write === true) {
		const configPath = resolve(options.cwd ?? process.cwd(), options.config ?? "s11t.config.toml");
		const configDirectory = dirname(configPath);
		const pending = pendingMigration(configDirectory);
		if (pending !== undefined) {
			return diagnostic(
				`Migration ${pending} is incomplete; restore it before starting another write`,
				resolve(operationDirectory(configDirectory, pending), "manifest.json"),
				["state"],
				"S11T_AUTHORING_MIGRATION_PENDING",
			);
		}
	}
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
	let operationId: string | undefined;
	if (options.write === true) {
		const manifest = prepareMigration(project, writes, {
			contexts: project.documents.length,
			profiles: Object.keys(profiles).length,
			aliases: Object.keys(aliases).length,
			mappings,
		});
		operationId = manifest.operationId;
		try {
			for (const [path, bytes] of writes) {
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
			manifest.state = "committed";
			writeManifest(project.configDirectory, manifest);
		} catch (error) {
			try {
				restoreFiles(project.configDirectory, manifest);
				manifest.state = "rolled-back";
				writeManifest(project.configDirectory, manifest);
			} catch (rollbackError) {
				throw new AggregateError(
					[error, rollbackError],
					"Migration failed and rollback was incomplete",
				);
			}
			throw error;
		}
	}
	return {
		written: options.write === true,
		restored: false,
		...(operationId === undefined ? {} : { operationId }),
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
