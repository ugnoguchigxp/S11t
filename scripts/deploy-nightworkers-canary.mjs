import { createHash } from "node:crypto";
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

function execute(command, arguments_, cwd, { capture = false, allowFailure = false } = {}) {
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

function captured(command, arguments_, cwd) {
	return execute(command, arguments_, cwd, { capture: true }).stdout.trim();
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value, indentation = 2) {
	writeFileSync(path, `${JSON.stringify(value, null, indentation)}\n`, "utf8");
}

function checksum(path) {
	return createHash("sha512").update(readFileSync(path)).digest("hex");
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
	if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages)) {
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

function snapshotTree(root) {
	if (!existsSync(root)) return [];
	const result = [];
	function visit(directory, prefix = "") {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
		)) {
			const path = resolve(directory, entry.name);
			const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) visit(path, relativePath);
			else if (entry.isFile()) result.push({ path: relativePath, sha512: checksum(path) });
			else throw new Error(`Unsupported managed file type: ${path}`);
		}
	}
	visit(root);
	return result;
}

export function backupManagedFiles(target, backupRoot) {
	const files = ["package.json", "bun.lock"];
	const vendorPath = resolve(target, "vendor/s11t");
	const state = {
		files: new Map(),
		vendorExists: existsSync(vendorPath),
		vendorSnapshot: snapshotTree(vendorPath),
	};
	for (const file of files) {
		const source = resolve(target, file);
		const present = existsSync(source);
		state.files.set(file, {
			present,
			...(present ? { sha512: checksum(source) } : {}),
		});
		if (present) {
			mkdirSync(resolve(backupRoot, dirname(file)), { recursive: true });
			cpSync(source, resolve(backupRoot, file));
		}
	}
	if (state.vendorExists) {
		mkdirSync(resolve(backupRoot, "vendor"), { recursive: true });
		cpSync(resolve(target, "vendor/s11t"), resolve(backupRoot, "vendor/s11t"), {
			recursive: true,
		});
	}
	return state;
}

export function assertManagedFilesRestored(target, state) {
	for (const [file, expected] of state.files) {
		const destination = resolve(target, file);
		if (existsSync(destination) !== expected.present) {
			throw new Error(`Rollback did not restore ${file} presence`);
		}
		if (expected.present && checksum(destination) !== expected.sha512) {
			throw new Error(`Rollback did not restore ${file} bytes`);
		}
	}
	const vendor = resolve(target, "vendor/s11t");
	if (existsSync(vendor) !== state.vendorExists) {
		throw new Error("Rollback did not restore vendor/s11t presence");
	}
	if (state.vendorExists) {
		const actual = JSON.stringify(snapshotTree(vendor));
		const expected = JSON.stringify(state.vendorSnapshot);
		if (actual !== expected) throw new Error("Rollback did not restore vendor/s11t bytes");
	}
}

export function restoreManagedFiles(target, backupRoot, state) {
	for (const [file, expected] of state.files) {
		const destination = resolve(target, file);
		rmSync(destination, { force: true });
		if (expected.present) cpSync(resolve(backupRoot, file), destination);
	}
	const vendor = resolve(target, "vendor/s11t");
	rmSync(vendor, { recursive: true, force: true });
	if (state.vendorExists) cpSync(resolve(backupRoot, "vendor/s11t"), vendor, { recursive: true });
	assertManagedFilesRestored(target, state);
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

function verifyNightWorkers(target, runtime, cli, version, fullVerification) {
	execute(bun, ["install", "--ignore-scripts"], target);
	execute(bun, ["install", "--frozen-lockfile", "--ignore-scripts"], target);
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
	execute(bun, ["run", "s11t", "--help"], target);
	if (fullVerification) {
		execute(bun, ["run", "typecheck"], target);
		execute(bun, ["run", "build"], target);
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

export function main(arguments_ = process.argv.slice(2)) {
	const { target, verify } = parseArguments(arguments_);
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
		execute(pnpm, ["install", "--frozen-lockfile", "--ignore-scripts"], worktree);
		execute(pnpm, ["version:canary"], worktree);
		execute(
			pnpm,
			["release:dry-run", "--", "--channel", "canary", "--allow-snapshot-changes"],
			worktree,
		);

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
		verifyNightWorkers(target, runtime, cli, version, verify);
		pruneOldTarballs(target, new Set([runtime.file, cli.file]));
		process.stdout.write(
			`Deployed S11t ${version} from ${commit} to ${relative(dirname(target), target)}.\n`,
		);
	} catch (error) {
		if (targetMutated && backupState !== undefined) {
			process.stderr.write("Deployment failed; restoring NightWorkers package files.\n");
			try {
				restoreManagedFiles(target, backupRoot, backupState);
				const bunLockState = backupState.files.get("bun.lock");
				if (bunLockState?.present === true) {
					execute(bun, ["install", "--frozen-lockfile", "--ignore-scripts"], target);
				} else {
					execute(bun, ["install", "--ignore-scripts"], target);
					rmSync(resolve(target, "bun.lock"), { force: true });
				}
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

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
