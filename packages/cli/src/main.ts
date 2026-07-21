import { buildProject } from "./build-command.js";
import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";
import { inspectContext } from "./inspect-command.js";
import { lintProject } from "./lint-command.js";

export const HELP = `s11t - SystemContext authoring and build tools

Usage:
  s11t lint [--config s11t.config.toml] [--format human|json]
  s11t build [--config s11t.config.toml] [--check] [--format human|json]
  s11t inspect <namespace:key> [--locale ja-JP] [--config s11t.config.toml]
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

function formatDiagnostic(diagnostic: S11tDiagnostic): string {
	const location =
		diagnostic.line === undefined
			? diagnostic.file
			: `${diagnostic.file}:${diagnostic.line}${diagnostic.column === undefined ? "" : `:${diagnostic.column}`}`;
	const path = diagnostic.path.length === 0 ? "" : ` [${diagnostic.path.join(".")}]`;
	return `${location}: ${diagnostic.severity} ${diagnostic.code}${path}: ${diagnostic.message}`;
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
		if (command === "lint") {
			if (arguments_.length > 0) throw new CliUsageError(`Unknown argument: ${arguments_[0]}`);
			const result = lintProject(config, io.cwd);
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
			const key = arguments_.shift();
			if (key === undefined) throw new CliUsageError("inspect requires a namespace:key argument");
			if (arguments_.length > 0) throw new CliUsageError(`Unknown argument: ${arguments_[0]}`);
			io.stdout(
				`${JSON.stringify(
					inspectContext(key, {
						...(config === undefined ? {} : { config }),
						...(locale === undefined ? {} : { locale }),
						cwd: io.cwd,
					}),
					null,
					2,
				)}\n`,
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
