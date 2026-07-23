import { S11tDiagnosticError, type S11tDiagnostic } from "../diagnostics.js";

export type MigrationMapping = {
	file: string;
	oldKey: string;
	canonicalKey: string;
};

export type MigrationSummary = {
	contexts: number;
	profiles: number;
	aliases: number;
	mappings: MigrationMapping[];
};

export type MigrationManifest = {
	schemaVersion: 1;
	operation: "authoring-v2";
	operationId: string;
	state: "prepared" | "committed" | "rolled-back";
	createdAt?: string;
	configPath: string;
	summary: MigrationSummary;
	files: Array<{
		path: string;
		backup: string;
		beforeSha256: string;
		afterSha256: string;
		mode?: number;
	}>;
};

export type MigrationOperation = Pick<
	MigrationManifest,
	"operationId" | "state" | "createdAt" | "configPath" | "summary"
>;

export const OPERATION_ID_PATTERN = /^authoring-v2-[0-9a-f]{24}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function diagnostic(
	message: string,
	file: string,
	path: Array<string | number> = [],
): never {
	const value: S11tDiagnostic = {
		code: "S11T_AUTHORING_MIGRATION_INVALID",
		severity: "error",
		message,
		file,
		path,
	};
	throw new S11tDiagnosticError([value]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const allowedSet = new Set(allowed);
	return Object.keys(value).every((key) => allowedSet.has(key));
}

export function parseMigrationManifest(input: unknown, file: string): MigrationManifest {
	if (!isRecord(input)) return diagnostic("Invalid migration manifest", file);
	const manifest = input as Partial<MigrationManifest>;
	const summary = manifest.summary;
	if (
		!hasExactKeys(input, [
			"schemaVersion",
			"operation",
			"operationId",
			"state",
			"createdAt",
			"configPath",
			"summary",
			"files",
		]) ||
		manifest.schemaVersion !== 1 ||
		manifest.operation !== "authoring-v2" ||
		typeof manifest.operationId !== "string" ||
		!OPERATION_ID_PATTERN.test(manifest.operationId) ||
		!["prepared", "committed", "rolled-back"].includes(manifest.state ?? "") ||
		(manifest.createdAt !== undefined &&
			(typeof manifest.createdAt !== "string" ||
				Number.isNaN(Date.parse(manifest.createdAt)) ||
				new Date(manifest.createdAt).toISOString() !== manifest.createdAt)) ||
		typeof manifest.configPath !== "string" ||
		!isRecord(summary) ||
		!hasExactKeys(summary, ["contexts", "profiles", "aliases", "mappings"]) ||
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
		return diagnostic("Invalid migration manifest", file);
	}
	const mappingFiles = new Set<string>();
	for (const [index, mapping] of summary.mappings.entries()) {
		if (
			!isRecord(mapping) ||
			!hasExactKeys(mapping, ["file", "oldKey", "canonicalKey"]) ||
			typeof mapping.file !== "string" ||
			mapping.file.length === 0 ||
			typeof mapping.oldKey !== "string" ||
			mapping.oldKey.length === 0 ||
			typeof mapping.canonicalKey !== "string" ||
			mapping.canonicalKey.length === 0 ||
			mappingFiles.has(mapping.file)
		) {
			return diagnostic("Invalid migration manifest mapping", file, ["summary", "mappings", index]);
		}
		mappingFiles.add(mapping.file);
	}
	const paths = new Set<string>();
	const backups = new Set<string>();
	for (const [index, entry] of manifest.files.entries()) {
		if (
			!isRecord(entry) ||
			!hasExactKeys(entry, [
				"path",
				"backup",
				"beforeSha256",
				"afterSha256",
				"mode",
			]) ||
			typeof entry.path !== "string" ||
			entry.path.length === 0 ||
			typeof entry.backup !== "string" ||
			!/^[^/\\]+\.bak$/.test(entry.backup) ||
			typeof entry.beforeSha256 !== "string" ||
			!SHA256_PATTERN.test(entry.beforeSha256) ||
			typeof entry.afterSha256 !== "string" ||
			!SHA256_PATTERN.test(entry.afterSha256) ||
			(entry.mode !== undefined &&
				(!Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777)) ||
			paths.has(entry.path) ||
			backups.has(entry.backup)
		) {
			return diagnostic("Invalid migration manifest file entry", file, ["files", index]);
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
		return diagnostic("Migration manifest summary does not match its file set", file, ["summary"]);
	}
	return manifest as MigrationManifest;
}
