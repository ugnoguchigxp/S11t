import {
	cpSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";

import {
	assertManagedFilesRestored,
	backupManagedFiles,
	checksum,
	restoreManagedFiles,
} from "./lib/nightworkers-deploy-state.mjs";

export {
	assertManagedFilesRestored,
	backupManagedFiles,
	restoreManagedFiles,
} from "./lib/nightworkers-deploy-state.mjs";

const { sync: spawnSync } = crossSpawn;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageNames = ["@s11t/runtime", "@s11t/cli"];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const bun = process.platform === "win32" ? "bun.exe" : "bun";

function parseArguments(values) {
	let target = resolve(repositoryRoot, "../nightWorkers");
	let verify = false;
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === "--" && index === 0) continue;
		if (value === "--target") {
			const next = values[index + 1];
			if (next === undefined || next.startsWith("--")) {
				throw new Error("--target requires a NightWorkers checkout path");
			}
			target = resolve(next);
			index += 1;
		} else if (value === "--verify") {
			verify = true;
		} else {
			throw new Error(`Unknown argument: ${value}`);
		}
	}
	return { target, verify };
}

function executeCommand(command, arguments_, cwd, { capture = false, allowFailure = false } = {}) {
	const result = spawnSync(command, arguments_, {
		cwd,
		encoding: "utf8",
		stdio: capture ? "pipe" : "inherit",
	});
	if (result.error != null) {
		if (allowFailure) return result;
		throw result.error;
	}
	if (result.status !== 0 && !allowFailure) {
		if (capture && result.stdout) process.stderr.write(result.stdout);
		if (capture && result.stderr) process.stderr.write(result.stderr);
		const ending = result.signal === null ? `exit code ${result.status}` : `signal ${result.signal}`;
		throw new Error(`${command} ${arguments_.join(" ")} failed with ${ending}`);
	}
	return result;
}

function capturedCommand(command, arguments_, cwd) {
	return executeCommand(command, arguments_, cwd, { capture: true }).stdout.trim();
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value, indentation = 2) {
	writeFileSync(path, `${JSON.stringify(value, null, indentation)}\n`, "utf8");
}

function assertNightWorkers(target) {
	const packagePath = resolve(target, "package.json");
	if (!existsSync(target) || !existsSync(packagePath) || !existsSync(resolve(target, ".git"))) {
		throw new Error(`${target} is not a NightWorkers Git checkout`);
	}
	if (readJson(packagePath).name !== "nightworkers") {
		throw new Error(`${packagePath} does not describe the nightworkers package`);
	}
	if (realpathSync(target) === realpathSync(repositoryRoot)) {
		throw new Error("The NightWorkers target cannot be the S11t repository");
	}
}

function validateManifest(path, commit) {
	const manifest = readJson(path);
	if (!Array.isArray(manifest.packages)) {
		throw new Error("The S11t package manifest has an unsupported shape");
	}
	if (
		manifest.packages.length !== packageNames.length ||
		packageNames.some(
			(name) => manifest.packages.filter((entry) => entry?.name === name).length !== 1,
		)
	) {
		throw new Error("The S11t package manifest must contain runtime and CLI exactly once");
	}
	const versions = new Set(manifest.packages.map((entry) => entry.version));
	if (versions.size !== 1) throw new Error("The S11t canary packages have different versions");
	const version = [...versions][0];
	if (typeof version !== "string" || !version.endsWith(`-canary-${commit}`)) {
		throw new Error(`The S11t canary version does not match commit ${commit}`);
	}
	for (const entry of manifest.packages) {
		const expectedPrefix = `s11t-${entry.name.slice("@s11t/".length)}-`;
		if (
			typeof entry.file !== "string" ||
			entry.file !== basename(entry.file) ||
			!/^s11t-(?:runtime|cli)-[A-Za-z0-9._-]+\.tgz$/.test(entry.file) ||
			!entry.file.startsWith(expectedPrefix) ||
			typeof entry.sha512 !== "string" ||
			!/^[0-9a-f]{128}$/.test(entry.sha512)
		) {
			throw new Error(`Invalid package manifest entry for ${entry.name ?? "unknown package"}`);
		}
	}
	return { manifest, version };
}

function installManifest(target, artifactDirectory, manifest, version, commit) {
	const vendorDirectory = resolve(target, "vendor/s11t");
	mkdirSync(vendorDirectory, { recursive: true });
	for (const entry of manifest.packages) {
		const source = resolve(artifactDirectory, entry.file);
		if (!existsSync(source) || checksum(source) !== entry.sha512) {
			throw new Error(`${entry.name} tarball is missing or does not match its SHA-512`);
		}
		cpSync(source, resolve(vendorDirectory, entry.file));
	}
	writeJson(resolve(vendorDirectory, "manifest.json"), manifest);
	const runtime = manifest.packages.find((entry) => entry.name === "@s11t/runtime");
	const cli = manifest.packages.find((entry) => entry.name === "@s11t/cli");
	const readme = `# Vendored S11t canary

This directory is managed by S11t's \`pnpm deploy:nightworkers-canary\` command.
NightWorkers consumes these immutable tarballs through root \`file:\` dependencies.
The runtime override is required so Bun resolves the CLI's transitive runtime
dependency from the same tarball instead of querying the npm registry.

- Version: \`${version}\`
- S11t commit: \`${commit}\`
- Runtime SHA-512: \`${runtime.sha512}\`
- CLI SHA-512: \`${cli.sha512}\`
- Supported Node.js versions: \`^20.19.0 || ^22.0.0 || ^24.0.0\`

The tarballs passed S11t's release dry-run, package-content allowlist, isolated
ESM consumer, type, runtime, CLI, and production dependency audit gates before
being copied here. Keep the exact version pinned during dogfooding.
`;
	writeFileSync(resolve(vendorDirectory, "README.md"), readme, "utf8");

	const packagePath = resolve(target, "package.json");
	const packageJson = readJson(packagePath);
	packageJson.dependencies ??= {};
	packageJson.devDependencies ??= {};
	packageJson.overrides ??= {};
	packageJson.dependencies["@s11t/runtime"] = `file:./vendor/s11t/${runtime.file}`;
	packageJson.devDependencies["@s11t/cli"] = `file:./vendor/s11t/${cli.file}`;
	packageJson.overrides["@s11t/runtime"] = `file:./vendor/s11t/${runtime.file}`;
	writeJson(packagePath, packageJson, "\t");
	return { runtime, cli };
}

function verifyNightWorkers(
	target,
	runtime,
	cli,
	version,
	fullVerification,
	execute,
	checkpoint,
) {
	execute(bun, ["install", "--ignore-scripts"], target);
	checkpoint("target-install");
	execute(bun, ["install", "--frozen-lockfile", "--ignore-scripts"], target);
	checkpoint("target-frozen-install");
	for (const [entry, directory] of [
		[runtime, "runtime"],
		[cli, "cli"],
	]) {
		const installed = readJson(resolve(target, `node_modules/@s11t/${directory}/package.json`));
		if (installed.name !== entry.name || installed.version !== version) {
			throw new Error(`${entry.name}@${version} was not installed from the vendored tarball`);
		}
		if (installed.engines?.node !== "^20.19.0 || ^22.0.0 || ^24.0.0") {
			throw new Error(`${entry.name} does not declare Node.js 20.19 support`);
		}
	}
	const lock = readFileSync(resolve(target, "bun.lock"), "utf8");
	for (const entry of [runtime, cli]) {
		if (!lock.includes(`${entry.name}@./vendor/s11t/${entry.file}`)) {
			throw new Error(`${entry.name} is not pinned to its vendored tarball in bun.lock`);
		}
	}
	execute(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import { COMPILER_VERSION } from "@s11t/runtime/compiler"; if (COMPILER_VERSION !== ${JSON.stringify(version)}) throw new Error(\`Unexpected compiler version: \${COMPILER_VERSION}\`);`,
		],
		target,
	);
	checkpoint("target-runtime-import");
	execute(bun, ["run", "s11t", "--help"], target);
	checkpoint("target-cli-help");
	if (fullVerification) {
		execute(bun, ["run", "typecheck"], target);
		checkpoint("target-typecheck");
		execute(bun, ["run", "build"], target);
		checkpoint("target-build");
	}
}

function pruneOldTarballs(target, keep) {
	const vendorDirectory = resolve(target, "vendor/s11t");
	for (const file of readdirSync(vendorDirectory)) {
		if (/^s11t-(?:runtime|cli)-.+\.tgz$/.test(file) && !keep.has(file)) {
			rmSync(resolve(vendorDirectory, file));
		}
	}
}

export function deployNightWorkers(
	{ target, verify = false },
	{
		execute = executeCommand,
		captured = capturedCommand,
		checkpoint = () => {},
	} = {},
) {
	assertNightWorkers(target);
	const commit = captured("git", ["rev-parse", "HEAD"], repositoryRoot);
	if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("S11t HEAD is not a full Git commit SHA");
	const sourceStatus = captured("git", ["status", "--porcelain"], repositoryRoot);
	if (sourceStatus !== "") {
		process.stderr.write(
			"S11t has uncommitted changes; deployment intentionally uses the committed HEAD only.\n",
		);
	}

	const temporaryRoot = mkdtempSync(resolve(tmpdir(), "s11t-nightworkers-deploy-"));
	const worktree = resolve(temporaryRoot, "source");
	const backupRoot = resolve(temporaryRoot, "backup");
	let worktreeRegistered = false;
	let backupState;
	let targetMutated = false;

	try {
		execute("git", ["worktree", "add", "--detach", worktree, commit], repositoryRoot);
		worktreeRegistered = true;
		checkpoint("source-worktree");
		execute(pnpm, ["install", "--frozen-lockfile", "--ignore-scripts"], worktree);
		checkpoint("source-install");
		execute(pnpm, ["version:canary"], worktree);
		checkpoint("source-version");
		execute(
			pnpm,
			["release:dry-run", "--", "--channel", "canary", "--allow-snapshot-changes"],
			worktree,
		);
		checkpoint("source-release-dry-run");

		const artifactDirectory = resolve(worktree, ".artifacts/packages");
		const { manifest, version } = validateManifest(
			resolve(artifactDirectory, "manifest.json"),
			commit,
		);
		backupState = backupManagedFiles(target, backupRoot);
		targetMutated = true;
		const { runtime, cli } = installManifest(
			target,
			artifactDirectory,
			manifest,
			version,
			commit,
		);
		checkpoint("target-manifest-installed");
		verifyNightWorkers(target, runtime, cli, version, verify, execute, checkpoint);
		pruneOldTarballs(target, new Set([runtime.file, cli.file]));
		checkpoint("target-pruned");
		process.stdout.write(
			`Deployed S11t ${version} from ${commit} to ${relative(dirname(target), target)}.\n`,
		);
	} catch (error) {
		if (targetMutated && backupState !== undefined) {
			process.stderr.write("Deployment failed; restoring NightWorkers package files.\n");
			try {
				checkpoint("rollback-start");
				restoreManagedFiles(target, backupRoot, backupState);
				checkpoint("rollback-files-restored");
				const bunLockState = backupState.files.get("bun.lock");
				if (bunLockState?.present === true) {
					execute(bun, ["install", "--frozen-lockfile", "--ignore-scripts"], target);
				} else {
					execute(bun, ["install", "--ignore-scripts"], target);
					rmSync(resolve(target, "bun.lock"), { force: true });
				}
				checkpoint("rollback-install");
				assertManagedFilesRestored(target, backupState);
			} catch (rollbackError) {
				throw new AggregateError(
					[error, rollbackError],
					"Deployment failed and NightWorkers rollback was incomplete",
				);
			}
		}
		throw error;
	} finally {
		if (worktreeRegistered) {
			execute("git", ["worktree", "remove", "--force", worktree], repositoryRoot, {
				allowFailure: true,
			});
		}
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
}

export function main(arguments_ = process.argv.slice(2)) {
	return deployNightWorkers(parseArguments(arguments_));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
