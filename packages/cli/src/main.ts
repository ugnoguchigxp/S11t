import { buildProject } from "./build-command.js";
import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";
import { inspectContext, inspectCoverage } from "./inspect-command.js";
import { lintProject } from "./lint-command.js";

export const HELP = `s11t - SystemContext authoring and build tools

Usage:
  s11t lint --release-profile name [--config s11t.config.toml] [--format human|json]
  s11t build --release-profile name [--config s11t.config.toml] [--check] [--format human|json]
  s11t inspect <key> --release-profile name [--resolved] [--locale ja-JP] [--config s11t.config.toml] [--format human|json]
  s11t inspect --coverage --locale en-US --release-profile name [--fallback-locale ja-JP] [--config s11t.config.toml] [--format human|json]
  s11t --help
`;

export type CommandIo = {
	stdout(value: string): void;
	stderr(value: string): void;
	cwd: string;
};

class CliUsageError extends Error {}

function takeOption(arguments_: string[], name: string): string | undefined {
	const index = arguments_.indexOf(name);
	if (index === -1) return undefined;
	const value = arguments_[index + 1];
	if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${name} requires a value`);
	arguments_.splice(index, 2);
	return value;
}

function takeFlag(arguments_: string[], name: string): boolean {
	const index = arguments_.indexOf(name);
	if (index === -1) return false;
	arguments_.splice(index, 1);
	return true;
}

function takeOptions(arguments_: string[], name: string): string[] {
	const values: string[] = [];
	for (;;) {
		const value = takeOption(arguments_, name);
		if (value === undefined) return values;
		values.push(value);
	}
}

function formatDiagnostic(diagnostic: S11tDiagnostic): string {
	const location =
		diagnostic.line === undefined
			? diagnostic.file
			: `${diagnostic.file}:${diagnostic.line}${diagnostic.column === undefined ? "" : `:${diagnostic.column}`}`;
	const path = diagnostic.path.length === 0 ? "" : ` [${diagnostic.path.join(".")}]`;
	return `${location}: ${diagnostic.severity} ${diagnostic.code}${path}: ${diagnostic.message}`;
}

function formatInspectValue(value: unknown, indentation = 0): string[] {
	const prefix = "\t".repeat(indentation);
	if (value === null || typeof value !== "object") return [`${prefix}${String(value)}`];
	if (Array.isArray(value)) {
		if (value.length === 0) return [`${prefix}[]`];
		if (value.every((item) => item === null || typeof item !== "object")) {
			return [`${prefix}[${value.map((item) => JSON.stringify(item)).join(", ")}]`];
		}
		return value.flatMap((item, index) => [
			`${prefix}${index}:`,
			...formatInspectValue(item, indentation + 1),
		]);
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length === 0) return [`${prefix}{}`];
	return entries.flatMap(([key, item]) => {
		if (item === null || typeof item !== "object") return [`${prefix}${key}: ${String(item)}`];
		if (Array.isArray(item) && item.every((entry) => entry === null || typeof entry !== "object")) {
			return [`${prefix}${key}: [${item.map((entry) => JSON.stringify(entry)).join(", ")}]`];
		}
		return [`${prefix}${key}:`, ...formatInspectValue(item, indentation + 1)];
	});
}

function formatInspectHuman(value: unknown): string {
	return `${formatInspectValue(value).join("\n")}\n`;
}

export function runCli(
	argumentsInput: readonly string[],
	io: CommandIo = {
		stdout: (value) => process.stdout.write(value),
		stderr: (value) => process.stderr.write(value),
		cwd: process.cwd(),
	},
): number {
	const arguments_ = [...argumentsInput];
	if (arguments_.length === 0 || arguments_.includes("--help") || arguments_.includes("-h")) {
		io.stdout(HELP);
		return 0;
	}
	const command = arguments_.shift();
	let format = "human";
	try {
		format = takeOption(arguments_, "--format") ?? "human";
		if (format !== "human" && format !== "json") {
			throw new CliUsageError("--format must be human or json");
		}
		const config = takeOption(arguments_, "--config");
		const releaseProfile = takeOption(arguments_, "--release-profile");
		if (command === "lint") {
			if (arguments_.length > 0) throw new CliUsageError(`Unknown argument: ${arguments_[0]}`);
			const result = lintProject(config, io.cwd, releaseProfile);
			io.stdout(
				format === "json"
					? `${JSON.stringify({ ok: true, ...result })}\n`
					: `Lint passed: ${result.contexts} context(s) in ${result.files} file(s).\n`,
			);
			return 0;
		}
		if (command === "build") {
			const check = takeFlag(arguments_, "--check");
			if (arguments_.length > 0) throw new CliUsageError(`Unknown argument: ${arguments_[0]}`);
			const result = buildProject({
				...(config === undefined ? {} : { config }),
				...(releaseProfile === undefined ? {} : { releaseProfile }),
				check,
				cwd: io.cwd,
			});
			io.stdout(
				format === "json"
					? `${JSON.stringify({ ok: true, ...result })}\n`
					: check
						? `Generated outputs are current (${result.catalogDigest}).\n`
						: `Built ${result.catalogPath} and ${result.typesPath} (${result.catalogDigest}).\n`,
			);
			return 0;
		}
		if (command === "inspect") {
			const locale = takeOption(arguments_, "--locale");
			const fallbackLocales = takeOptions(arguments_, "--fallback-locale");
			const coverage = takeFlag(arguments_, "--coverage");
			const resolved = takeFlag(arguments_, "--resolved");
			const key = arguments_.shift();
			if (coverage) {
				if (key !== undefined) {
					throw new CliUsageError("inspect --coverage does not accept a context key");
				}
				if (resolved) throw new CliUsageError("inspect --coverage does not accept --resolved");
				if (locale === undefined) throw new CliUsageError("inspect --coverage requires --locale");
				if (releaseProfile === undefined) {
					throw new CliUsageError("inspect --coverage requires --release-profile");
				}
				const result = inspectCoverage({
					...(config === undefined ? {} : { config }),
					locale,
					fallbackLocales,
					releaseProfile,
					cwd: io.cwd,
				});
				io.stdout(
					format === "json" ? `${JSON.stringify(result, null, 2)}\n` : formatInspectHuman(result),
				);
				return 0;
			}
			if (fallbackLocales.length > 0) {
				throw new CliUsageError("--fallback-locale requires --coverage");
			}
			if (key === undefined) throw new CliUsageError("inspect requires a context key");
			if (arguments_.length > 0) throw new CliUsageError(`Unknown argument: ${arguments_[0]}`);
			const result = inspectContext(key, {
				...(config === undefined ? {} : { config }),
				...(locale === undefined ? {} : { locale }),
				...(releaseProfile === undefined ? {} : { releaseProfile }),
				resolved,
				cwd: io.cwd,
			});
			io.stdout(
				format === "json" ? `${JSON.stringify(result, null, 2)}\n` : formatInspectHuman(result),
			);
			return 0;
		}
		throw new CliUsageError(`Unknown command: ${command ?? ""}`);
	} catch (error) {
		if (error instanceof CliUsageError) {
			io.stderr(`${error.message}\n\n${HELP}`);
			return 2;
		}
		if (error instanceof S11tDiagnosticError) {
			const usageDiagnostic = error.diagnostics.find((diagnostic) =>
				diagnostic.code === "S11T_RELEASE_PROFILE_REQUIRED",
			);
			if (usageDiagnostic !== undefined) {
				io.stderr(`${usageDiagnostic.message}\n\n${HELP}`);
				return 2;
			}
			io.stderr(
				format === "json"
					? `${JSON.stringify(error.diagnostics)}\n`
					: `${error.diagnostics.map(formatDiagnostic).join("\n")}\n`,
			);
			return 1;
		}
		const message = error instanceof Error ? error.stack ?? error.message : String(error);
		io.stderr(`S11T_INTERNAL_ERROR: ${message}\n`);
		return 3;
	}
}
