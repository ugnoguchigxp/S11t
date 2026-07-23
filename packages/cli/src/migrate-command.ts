import { dirname, relative, resolve } from "node:path";

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
import {
	atomicWrite,
	listMigrations,
	pendingMigration,
	prepareMigration,
	purgeMigration,
	readMigrationManifest,
	restoreMigrationFiles,
	writeMigrationManifest,
	type MigrationMapping,
	type MigrationOperation,
} from "./migration/journal.js";
import {
	canonicalKey,
	profileName,
	serializeConfigV2,
	serializeDocumentV2,
	variableSignature,
} from "./migration/serialize-v2.js";

export type AuthoringV2MigrationResult = {
	written: boolean;
	restored: boolean;
	operationId?: string;
	contexts: number;
	profiles: number;
	aliases: number;
	mappings: MigrationMapping[];
};

export type AuthoringV2MigrationListResult = {
	operations: MigrationOperation[];
};

export type AuthoringV2MigrationPurgeResult = {
	purged: true;
	operation: MigrationOperation;
};

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

function migrationConfig(
	options: { config?: string; cwd?: string } = {},
): { configDirectory: string; configPath: string; relativeConfigPath: string } {
	const configPath = resolve(options.cwd ?? process.cwd(), options.config ?? "s11t.config.toml");
	const configDirectory = dirname(configPath);
	return {
		configDirectory,
		configPath,
		relativeConfigPath: relative(configDirectory, configPath).replaceAll("\\", "/"),
	};
}

export function listAuthoringV2Migrations(
	options: { config?: string; cwd?: string } = {},
): AuthoringV2MigrationListResult {
	const { configDirectory, relativeConfigPath } = migrationConfig(options);
	return {
		operations: listMigrations(configDirectory).filter(
			(operation) => operation.configPath === relativeConfigPath,
		),
	};
}

export function purgeAuthoringV2Migration(
	operationId: string,
	options: { config?: string; cwd?: string } = {},
): AuthoringV2MigrationPurgeResult {
	const { configDirectory, relativeConfigPath } = migrationConfig(options);
	return {
		purged: true,
		operation: purgeMigration(configDirectory, operationId, relativeConfigPath),
	};
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
		const manifest = readMigrationManifest(configDirectory, options.restore);
		const relativeConfigPath = relative(configDirectory, configPath).replaceAll("\\", "/");
		const manifestPath = resolve(
			configDirectory,
			".s11t/migrations",
			options.restore,
			"manifest.json",
		);
		if (manifest.configPath !== relativeConfigPath) {
			return diagnostic(
				"Migration manifest belongs to a different config",
				manifestPath,
				["configPath"],
				"S11T_AUTHORING_MIGRATION_INVALID",
			);
		}
		if (manifest.state === "rolled-back") {
			return diagnostic(
				"Migration operation has already been restored",
				manifestPath,
				["state"],
				"S11T_AUTHORING_MIGRATION_INVALID",
			);
		}
		restoreMigrationFiles(configDirectory, manifest);
		manifest.state = "rolled-back";
		writeMigrationManifest(configDirectory, manifest);
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
					resolve(configDirectory, ".s11t/migrations", pending, "manifest.json"),
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
		writes.set(
			resolve(project.configDirectory, document.file),
			serializeDocumentV2(document, profileBySignature),
		);
	}
	writes.set(
		project.configPath,
		serializeConfigV2({
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
		const manifest = prepareMigration(
			project.configDirectory,
			project.configPath,
			writes,
			{
				contexts: project.documents.length,
				profiles: Object.keys(profiles).length,
				aliases: Object.keys(aliases).length,
				mappings,
			},
		);
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
				writeMigrationManifest(project.configDirectory, manifest);
			} catch (error) {
				try {
					restoreMigrationFiles(project.configDirectory, manifest);
					manifest.state = "rolled-back";
					writeMigrationManifest(project.configDirectory, manifest);
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
