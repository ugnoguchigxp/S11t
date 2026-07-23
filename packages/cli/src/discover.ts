import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
	parseAndResolveAuthoring,
	validateResolvedDocuments,
	type ResolvedAuthoringDocument,
} from "./authoring.js";
import { parseProjectConfig, type S11tProjectConfig } from "./config.js";
import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";
import { resolvesWithin } from "./path-safety.js";
import { loadToml } from "./toml-loader.js";

export type LoadedProject = {
	configPath: string;
	configDirectory: string;
	sourceFiles: string[];
	config: S11tProjectConfig;
	documents: ResolvedAuthoringDocument[];
	releaseProfile: string;
	aliases: Record<string, string>;
};

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

export function loadProject(
	configArgument?: string,
	cwd = process.cwd(),
	releaseProfile?: string,
	options: { validateRequiredCoverage?: boolean } = {},
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
	if (releaseProfile === undefined) {
		diagnostic("S11T_RELEASE_PROFILE_REQUIRED", "--release-profile is required", configDisplay, ["release_profiles"]);
	}
	const sourceFiles = absoluteFiles.map((file) => posix(relative(configDirectory, file)));
	const documents = absoluteFiles.map((file, index) => {
		const displayFile = sourceFiles[index]!;
		const sourcePath = posix(relative(sourceDirectory, file));
		return parseAndResolveAuthoring(
			loadToml(file, displayFile),
			displayFile,
			sourcePath,
			config,
			releaseProfile,
			options,
		);
	});
	const aliases = validateResolvedDocuments(documents, config);
	return {
		config,
		configPath,
		configDirectory,
		documents,
		sourceFiles,
		releaseProfile,
		aliases,
	};
}
