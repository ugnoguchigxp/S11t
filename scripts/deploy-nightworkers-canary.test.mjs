import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	assertManagedFilesRestored,
	backupManagedFiles,
	deployNightWorkers,
	restoreManagedFiles,
} from "./deploy-nightworkers-canary.mjs";

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
	const directory = mkdtempSync(resolve(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

const commit = "a".repeat(40);

function createNightWorkersTarget() {
	const target = temporaryDirectory("s11tnext-deploy-orchestration-");
	mkdirSync(resolve(target, ".git"), { recursive: true });
	mkdirSync(resolve(target, "vendor/s11tnext/nested"), { recursive: true });
	writeFileSync(resolve(target, "package.json"), '{"name":"nightworkers","original":true}\n');
	writeFileSync(resolve(target, "bun.lock"), "original lock\n");
	writeFileSync(resolve(target, "vendor/s11tnext/manifest.json"), '{"version":"old"}\n');
	writeFileSync(resolve(target, "vendor/s11tnext/nested/old.tgz"), "old tarball");
	writeFileSync(resolve(target, "vendor/s11tnext/s11tnext-old.tgz"), "old runtime");
	return target;
}

function originalTargetState(target) {
	return {
		packageJson: readFileSync(resolve(target, "package.json"), "utf8"),
		lock: readFileSync(resolve(target, "bun.lock"), "utf8"),
		manifest: readFileSync(resolve(target, "vendor/s11tnext/manifest.json"), "utf8"),
		oldTarball: readFileSync(resolve(target, "vendor/s11tnext/nested/old.tgz"), "utf8"),
		oldRuntime: readFileSync(resolve(target, "vendor/s11tnext/s11tnext-old.tgz"), "utf8"),
	};
}

function expectOriginalTargetState(target, before) {
	expect(readFileSync(resolve(target, "package.json"), "utf8")).toBe(before.packageJson);
	expect(readFileSync(resolve(target, "bun.lock"), "utf8")).toBe(before.lock);
	expect(readFileSync(resolve(target, "vendor/s11tnext/manifest.json"), "utf8")).toBe(
		before.manifest,
	);
	expect(readFileSync(resolve(target, "vendor/s11tnext/nested/old.tgz"), "utf8")).toBe(
		before.oldTarball,
	);
	expect(readFileSync(resolve(target, "vendor/s11tnext/s11tnext-old.tgz"), "utf8")).toBe(
		before.oldRuntime,
	);
}

function fakeDeploymentDependencies(target, failureCheckpoint) {
	const checkpoints = [];
	const commands = [];
	function writeArtifacts(worktree) {
		const directory = resolve(worktree, ".artifacts/packages");
		mkdirSync(directory, { recursive: true });
		const version = `0.1.0-canary-${commit}`;
		const packages = [
			{ name: "s11tnext", label: "runtime" },
			{ name: "s11tnext-cli", label: "cli" },
		].map(({ name, label }) => {
			const file = `${name}-${version}.tgz`;
			const bytes = `${label} tarball`;
			writeFileSync(resolve(directory, file), bytes);
			return {
				name,
				version,
				file,
				sha512: createHash("sha512").update(bytes).digest("hex"),
			};
		});
		writeFileSync(
			resolve(directory, "manifest.json"),
			`${JSON.stringify({ packages }, null, 2)}\n`,
		);
	}
	function installTarget() {
		const packageJson = JSON.parse(readFileSync(resolve(target, "package.json"), "utf8"));
		const runtimeReference = packageJson.dependencies?.["s11tnext"];
		const cliReference = packageJson.devDependencies?.["s11tnext-cli"];
		if (typeof runtimeReference !== "string" || typeof cliReference !== "string") return;
		const manifest = JSON.parse(readFileSync(resolve(target, "vendor/s11tnext/manifest.json"), "utf8"));
		for (const entry of manifest.packages) {
			const directory = resolve(target, `node_modules/${entry.name}`);
			mkdirSync(directory, { recursive: true });
			writeFileSync(
				resolve(directory, "package.json"),
				`${JSON.stringify({
					name: entry.name,
					version: entry.version,
					engines: { node: "^20.19.0 || ^22.0.0 || ^24.0.0" },
				})}\n`,
			);
		}
		writeFileSync(
			resolve(target, "bun.lock"),
			manifest.packages
				.map((entry) => `${entry.name}@./vendor/s11tnext/${entry.file}`)
				.join("\n"),
		);
	}
	return {
		checkpoints,
		commands,
		captured(command, arguments_) {
			if (command === "git" && arguments_[0] === "rev-parse") return commit;
			if (command === "git" && arguments_[0] === "status") return "";
			throw new Error(`Unexpected captured command: ${command} ${arguments_.join(" ")}`);
		},
		execute(command, arguments_, cwd) {
			commands.push({ command, arguments: [...arguments_], cwd });
			if (command === "git" && arguments_[0] === "worktree" && arguments_[1] === "add") {
				mkdirSync(arguments_[3], { recursive: true });
			} else if (
				command === "git" &&
				arguments_[0] === "worktree" &&
				arguments_[1] === "remove"
			) {
				// The production finally block removes the enclosing temporary directory.
			} else if (
				(command === "pnpm" || command === "pnpm.cmd") &&
				arguments_[0] === "release:dry-run"
			) {
				writeArtifacts(cwd);
			} else if (
				(command === "pnpm" || command === "pnpm.cmd") &&
				(arguments_[0] === "install" || arguments_[0] === "version:canary")
			) {
				// Source preparation is represented by the generated release artifacts.
			} else if (
				(command === "bun" || command === "bun.exe") &&
				arguments_[0] === "install" &&
				cwd === target
			) {
				installTarget();
			} else if (
				(command === "bun" || command === "bun.exe") &&
				arguments_[0] === "run" &&
				["s11tnext", "typecheck", "build"].includes(arguments_[1])
			) {
				// Installed package checks are validated through the target fixture.
			} else if (command === process.execPath && arguments_[0] === "--input-type=module") {
				// Runtime package identity is validated before this injected command.
			} else throw new Error(`Unexpected command: ${command} ${arguments_.join(" ")}`);
			return { status: 0, signal: null, stdout: "", stderr: "" };
		},
		checkpoint(name) {
			checkpoints.push(name);
			if (name === failureCheckpoint) throw new Error(`Injected failure at ${name}`);
		},
	};
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("NightWorkers deployment rollback", () => {
	it("restores package files and the vendored tree byte-for-byte", () => {
		const target = temporaryDirectory("s11tnext-deploy-target-");
		const backup = temporaryDirectory("s11tnext-deploy-backup-");
		mkdirSync(resolve(target, "vendor/s11tnext/nested"), { recursive: true });
		mkdirSync(resolve(target, "vendor/s11tnext/empty"), { recursive: true });
		writeFileSync(resolve(target, "package.json"), '{"name":"nightworkers","original":true}\n');
		writeFileSync(resolve(target, "bun.lock"), "original lock\n");
		writeFileSync(resolve(target, "vendor/s11tnext/manifest.json"), '{"version":"old"}\n');
		writeFileSync(resolve(target, "vendor/s11tnext/nested/package.tgz"), "old tarball");
		if (process.platform !== "win32") {
			chmodSync(resolve(target, "package.json"), 0o640);
			chmodSync(resolve(target, "bun.lock"), 0o600);
			chmodSync(resolve(target, "vendor/s11tnext/manifest.json"), 0o600);
			chmodSync(resolve(target, "vendor/s11tnext/empty"), 0o700);
		}

		const state = backupManagedFiles(target, backup);
		writeFileSync(resolve(target, "package.json"), '{"name":"nightworkers","original":false}\n');
		writeFileSync(resolve(target, "bun.lock"), "new lock\n");
		rmSync(resolve(target, "vendor/s11tnext"), { recursive: true, force: true });
		mkdirSync(resolve(target, "vendor/s11tnext"), { recursive: true });
		writeFileSync(resolve(target, "vendor/s11tnext/new.tgz"), "new tarball");

		restoreManagedFiles(target, backup, state);
		expect(readFileSync(resolve(target, "package.json"), "utf8")).toBe(
			'{"name":"nightworkers","original":true}\n',
		);
		expect(readFileSync(resolve(target, "bun.lock"), "utf8")).toBe("original lock\n");
		expect(readFileSync(resolve(target, "vendor/s11tnext/nested/package.tgz"), "utf8")).toBe(
			"old tarball",
		);
		expect(existsSync(resolve(target, "vendor/s11tnext/empty"))).toBe(true);
		if (process.platform !== "win32") {
			expect(statSync(resolve(target, "package.json")).mode & 0o777).toBe(0o640);
			expect(statSync(resolve(target, "bun.lock")).mode & 0o777).toBe(0o600);
			expect(statSync(resolve(target, "vendor/s11tnext/manifest.json")).mode & 0o777).toBe(0o600);
			expect(statSync(resolve(target, "vendor/s11tnext/empty")).mode & 0o777).toBe(0o700);
		}
		expect(() => assertManagedFilesRestored(target, state)).not.toThrow();
	});

	it("removes managed files that did not exist before deployment", () => {
		const target = temporaryDirectory("s11tnext-deploy-target-");
		const backup = temporaryDirectory("s11tnext-deploy-backup-");
		writeFileSync(resolve(target, "package.json"), '{"name":"nightworkers"}\n');

		const state = backupManagedFiles(target, backup);
		writeFileSync(resolve(target, "bun.lock"), "generated lock\n");
		mkdirSync(resolve(target, "vendor/s11tnext"), { recursive: true });
		writeFileSync(resolve(target, "vendor/s11tnext/new.tgz"), "new tarball");

		restoreManagedFiles(target, backup, state);
		expect(() => readFileSync(resolve(target, "bun.lock"), "utf8")).toThrow();
		expect(() => readFileSync(resolve(target, "vendor/s11tnext/new.tgz"), "utf8")).toThrow();
		expect(() => assertManagedFilesRestored(target, state)).not.toThrow();
	});

	it.skipIf(process.platform === "win32")(
		"rejects managed symlinks before taking a deployment backup",
		() => {
			const target = temporaryDirectory("s11tnext-deploy-symlink-target-");
			const backup = temporaryDirectory("s11tnext-deploy-symlink-backup-");
			const outside = temporaryDirectory("s11tnext-deploy-symlink-outside-");
			const outsidePackage = resolve(outside, "package.json");
			writeFileSync(outsidePackage, '{"name":"nightworkers","outside":true}\n');
			symlinkSync(outsidePackage, resolve(target, "package.json"), "file");

			expect(() => backupManagedFiles(target, backup)).toThrowError(
				/Unsupported managed symbolic link/,
			);
			expect(readFileSync(outsidePackage, "utf8")).toBe(
				'{"name":"nightworkers","outside":true}\n',
			);

			rmSync(resolve(target, "package.json"));
			writeFileSync(resolve(target, "package.json"), '{"name":"nightworkers"}\n');
			symlinkSync(resolve(outside, "missing-bun.lock"), resolve(target, "bun.lock"), "file");
			expect(() => backupManagedFiles(target, backup)).toThrowError(
				/Unsupported managed symbolic link/,
			);
		},
	);

	it.each([
		"source-worktree",
		"source-install",
		"source-version",
		"source-release-dry-run",
	])("leaves the target untouched when %s fails before mutation", (checkpoint) => {
		const target = createNightWorkersTarget();
		const before = originalTargetState(target);
		const dependencies = fakeDeploymentDependencies(target, checkpoint);

		expect(() =>
			deployNightWorkers({ target, verify: true }, dependencies),
		).toThrowError(`Injected failure at ${checkpoint}`);
		expectOriginalTargetState(target, before);
	});

	it.each([
		"target-manifest-installed",
		"target-install",
		"target-frozen-install",
		"target-runtime-import",
		"target-cli-help",
		"target-typecheck",
		"target-build",
		"target-pruned",
	])("rolls back the exact target state when %s fails", (checkpoint) => {
		const target = createNightWorkersTarget();
		const before = originalTargetState(target);
		const dependencies = fakeDeploymentDependencies(target, checkpoint);

		expect(() =>
			deployNightWorkers({ target, verify: true }, dependencies),
		).toThrowError(`Injected failure at ${checkpoint}`);
		expectOriginalTargetState(target, before);
		expect(dependencies.checkpoints).toContain("rollback-install");
	});

	it("completes the full injected orchestration on success", () => {
		const target = createNightWorkersTarget();
		const dependencies = fakeDeploymentDependencies(target);

		deployNightWorkers({ target, verify: true }, dependencies);

		const packageJson = JSON.parse(readFileSync(resolve(target, "package.json"), "utf8"));
		expect(packageJson.dependencies["s11tnext"]).toMatch(/^file:\.\/vendor\/s11tnext\//);
		expect(packageJson.devDependencies["s11tnext-cli"]).toMatch(/^file:\.\/vendor\/s11tnext\//);
		expect(existsSync(resolve(target, "vendor/s11tnext/s11tnext-old.tgz"))).toBe(false);
		expect(dependencies.checkpoints).toEqual(
			expect.arrayContaining([
				"source-release-dry-run",
				"target-manifest-installed",
				"target-frozen-install",
				"target-runtime-import",
				"target-cli-help",
				"target-typecheck",
				"target-build",
				"target-pruned",
			]),
		);
		expect(
			dependencies.commands.some(
				(entry) =>
					(entry.command === "bun" || entry.command === "bun.exe") &&
					entry.arguments.join(" ") === "run s11tnext --help",
			),
		).toBe(true);
	});

	it("surfaces both deployment and rollback failures", () => {
		const target = createNightWorkersTarget();
		const before = originalTargetState(target);
		const dependencies = fakeDeploymentDependencies(target);
		dependencies.checkpoint = (name) => {
			if (name === "target-manifest-installed") throw new Error("deployment failure");
			if (name === "rollback-files-restored") throw new Error("rollback verification failure");
		};

		expect(() => deployNightWorkers({ target, verify: true }, dependencies)).toThrowError(
			expect.objectContaining({
				name: "AggregateError",
				message: "Deployment failed and NightWorkers rollback was incomplete",
				errors: [
					expect.objectContaining({ message: "deployment failure" }),
					expect.objectContaining({ message: "rollback verification failure" }),
				],
			}),
		);
		expectOriginalTargetState(target, before);
	});
});
