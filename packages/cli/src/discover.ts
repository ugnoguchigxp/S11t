import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { parseAuthoringDocument, validateAuthoringDocuments, type AuthoringDocument } from "./authoring-schema.js";
import {
	adaptAuthoringV1ToV2,
	parseAndResolveAuthoringV2,
	validateResolvedDocumentsV2,
	type ResolvedAuthoringDocumentV2,
} from "./authoring-v2.js";
import {
	parseProjectConfig,
	type S11tProjectConfigV1,
	type S11tProjectConfigV2,
} from "./config.js";
import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";
import { loadToml } from "./toml-loader.js";
import { resolvesWithin } from "./path-safety.js";

type LoadedProjectBase = {
	configPath: string;
	configDirectory: string;
	sourceFiles: string[];
};

export type LoadedProjectV1 = LoadedProjectBase & {
	config: S11tProjectConfigV1;
	documents: AuthoringDocument[];
};

export type LoadedProjectV2 = LoadedProjectBase & {
	config: S11tProjectConfigV2;
	documents: ResolvedAuthoringDocumentV2[];
	releaseProfile: string;
	aliases: Record<string, string>;
};

export type LoadedProject = LoadedProjectV1 | LoadedProjectV2;

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function posix(path: string): string {
	return path.split(sep).join("/");
}

function diagnostic(code: string, message: string, file: string, path: Array<string | number> = []): never {
	const value: S11tDiagnostic = { code, severity: "error", message, file, path };
	throw new S11tDiagnosticError([value]);
}

function discoverFiles(directory: string, configDirectory: string): string[] {
	const files: string[] = [];
	function visit(current: string): void {
		for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) =>
			compareCodeUnits(left.name, right.name),
		)) {
			const path = resolve(current, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && entry.name.endsWith(".context.toml")) files.push(path);
		}
	}
	visit(directory);
	return files.sort((left, right) =>
		compareCodeUnits(posix(relative(configDirectory, left)), posix(relative(configDirectory, right))),
	);
}

function isV1Source(input: unknown): boolean {
	return input !== null && typeof input === "object" && !Array.isArray(input) && Object.hasOwn(input, "schema_version");
}

export function loadProject(
	configArgument?: string,
	cwd = process.cwd(),
	releaseProfile?: string,
): LoadedProject {
	const configPath = resolve(cwd, configArgument ?? "s11t.config.toml");
	const configDirectory = dirname(configPath);
	const configDisplay = posix(relative(cwd, configPath)) || "s11t.config.toml";
	const config = parseProjectConfig(loadToml(configPath, configDisplay), configDisplay);
	const sourceDirectory = resolve(configDirectory, config.sourceDir);
	const relativeSource = relative(configDirectory, sourceDirectory);
	if (isAbsolute(relativeSource) || relativeSource === ".." || relativeSource.startsWith(`..${sep}`)) {
		diagnostic("S11T_CONFIG_INVALID", "source_dir escapes the config directory", configDisplay, ["source_dir"]);
	}
	if (!existsSync(sourceDirectory)) {
		diagnostic("S11T_SOURCE_DIR_NOT_FOUND", "Configured source_dir does not exist", configDisplay, ["source_dir"]);
	}
	if (!statSync(sourceDirectory).isDirectory()) {
		diagnostic("S11T_CONFIG_INVALID", "Configured source_dir is not a directory", configDisplay, ["source_dir"]);
	}
	if (!resolvesWithin(configDirectory, sourceDirectory)) {
		diagnostic("S11T_CONFIG_INVALID", "source_dir resolves outside the config directory", configDisplay, ["source_dir"]);
	}
	const outputDirectory = resolve(configDirectory, config.outDir);
	if (!resolvesWithin(configDirectory, outputDirectory)) {
		diagnostic("S11T_CONFIG_INVALID", "out_dir resolves outside the config directory", configDisplay, ["out_dir"]);
	}
	if (existsSync(outputDirectory) && !statSync(outputDirectory).isDirectory()) {
		diagnostic("S11T_CONFIG_INVALID", "Configured out_dir is not a directory", configDisplay, ["out_dir"]);
	}
	const absoluteFiles = discoverFiles(sourceDirectory, configDirectory);
	if (absoluteFiles.length === 0) {
		diagnostic("S11T_SOURCE_EMPTY", "No .context.toml files were found", configDisplay, ["source_dir"]);
	}
	const sourceFiles = absoluteFiles.map((file) => posix(relative(configDirectory, file)));
	if (config.schemaVersion === 1) {
		if (releaseProfile !== undefined) {
			diagnostic("S11T_CONFIG_INVALID", "--release-profile is only valid for config v2", configDisplay, []);
		}
		const documents = absoluteFiles.map((file, index) =>
			parseAuthoringDocument(loadToml(file, sourceFiles[index]!), sourceFiles[index]!),
		);
		validateAuthoringDocuments(documents);
		for (const document of documents) {
			for (const locale of config.requiredLocales) {
				if (!document.definition.requiredLocales.includes(locale)) {
					diagnostic(
						"S11T_LOCALE_MISSING",
						`Context does not include project-required locale: ${locale}`,
						document.file,
						["context", "required_locales"],
					);
				}
			}
		}
		return { config, configPath, configDirectory, documents, sourceFiles };
	}
	if (releaseProfile === undefined) {
		diagnostic("S11T_RELEASE_PROFILE_REQUIRED", "config v2 requires --release-profile", configDisplay, ["release_profiles"]);
	}
	const documents = absoluteFiles.map((file, index) => {
		const displayFile = sourceFiles[index]!;
		const sourcePath = posix(relative(sourceDirectory, file));
		const input = loadToml(file, displayFile);
		if (isV1Source(input)) {
			return adaptAuthoringV1ToV2(
				parseAuthoringDocument(input, displayFile),
				sourcePath,
				config,
				releaseProfile,
			);
		}
		return parseAndResolveAuthoringV2(input, displayFile, sourcePath, config, releaseProfile);
	});
	const aliases = validateResolvedDocumentsV2(documents, config);
	return { config, configPath, configDirectory, documents, sourceFiles, releaseProfile, aliases };
}
