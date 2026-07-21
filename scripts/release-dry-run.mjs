import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";

const { sync: spawnSync } = crossSpawn;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = resolve(repositoryRoot, ".artifacts/packages");
const reportPath = resolve(repositoryRoot, ".artifacts/release-dry-run.json");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const git = "git";
const arguments_ = process.argv.slice(2);

function parseArguments(values) {
	let channel;
	let allowLocal = false;
	let allowSnapshotChanges = false;
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === "--" && index === 0) {
			continue;
		}
		if (value === "--channel") {
			const next = values[index + 1];
			if (next === undefined || next.startsWith("--")) throw new Error("--channel requires a value");
			if (channel !== undefined) throw new Error("--channel may only be specified once");
			channel = next;
			index += 1;
		} else if (value === "--allow-local") {
			allowLocal = true;
		} else if (value === "--allow-snapshot-changes") {
			allowSnapshotChanges = true;
		} else {
			throw new Error(`Unknown argument: ${value}`);
		}
	}
	return { channel, allowLocal, allowSnapshotChanges };
}

const { channel, allowLocal, allowSnapshotChanges } = parseArguments(arguments_);
if (channel !== "canary" && channel !== "stable") {
	throw new Error("--channel must be canary or stable");
}
if (allowLocal && process.env.CI === "true") {
	throw new Error("--allow-local cannot be used in CI");
}
const distTag = channel === "canary" ? "canary" : "latest";
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CANARY_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-canary-[0-9a-f]{40}$/;

function execute(command, commandArguments, { allowFailure = false, echo = true } = {}) {
	const result = spawnSync(command, commandArguments, {
		cwd: repositoryRoot,
		encoding: "utf8",
		stdio: "pipe",
	});
	if (echo && result.stdout) process.stdout.write(result.stdout);
	if (result.status !== 0 && !allowFailure) {
		if (result.stderr) process.stderr.write(result.stderr);
		throw new Error(`${command} ${commandArguments.join(" ")} failed with exit code ${result.status}`);
	}
	return result;
}

function readPackage(path) {
	return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

function githubSlug(value) {
	if (typeof value !== "string") return null;
	const match = value
		.replace(/^git\+/, "")
		.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com(?::|\/)([^/]+)\/([^/#]+?)(?:\.git)?$/i);
	return match === null ? null : `${match[1]}/${match[2]}`.toLowerCase();
}

function assertReleaseMetadata(packageJson, expectedRepository) {
	if (packageJson.private === true) throw new Error(`${packageJson.name} is marked private`);
	if (!/^@s11t\/[a-z0-9-]+$/.test(packageJson.name ?? "")) {
		throw new Error(`Unexpected package name: ${packageJson.name ?? "missing"}`);
	}
	if (
		packageJson.publishConfig?.access !== "public" ||
		packageJson.publishConfig?.registry !== "https://registry.npmjs.org/"
	) {
		throw new Error(`${packageJson.name} has unsafe publishConfig metadata`);
	}
	const repositoryUrl =
		typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
	const packageRepository = githubSlug(repositoryUrl);
	if (packageRepository === null) throw new Error(`${packageJson.name} has no GitHub repository metadata`);
	if (packageRepository !== expectedRepository) {
		throw new Error(`${packageJson.name} repository metadata does not match origin`);
	}
	if (typeof packageJson.homepage !== "string" || packageJson.homepage.length === 0) {
		throw new Error(`${packageJson.name} has no homepage metadata`);
	}
	const bugsUrl = typeof packageJson.bugs === "string" ? packageJson.bugs : packageJson.bugs?.url;
	if (typeof bugsUrl !== "string" || bugsUrl.length === 0) {
		throw new Error(`${packageJson.name} has no bugs metadata`);
	}
}

function repositoryState() {
	const commitResult = execute(git, ["rev-parse", "HEAD"], { allowFailure: true, echo: false });
	const remoteResult = execute(git, ["remote", "get-url", "origin"], { allowFailure: true, echo: false });
	const status = execute(git, ["status", "--porcelain"], { echo: false }).stdout.replace(/\n$/, "");
	const commit = commitResult.status === 0 ? commitResult.stdout.trim() : null;
	const remote = remoteResult.status === 0 ? remoteResult.stdout.trim() : null;
	if (!allowLocal && (commit === null || remote === null)) {
		throw new Error("A committed repository with an origin remote is required for release dry-run");
	}
	if (!allowLocal && status !== "") {
		if (!allowSnapshotChanges) throw new Error("Release dry-run requires a clean working tree");
		const allowed = [
			/^ D \.changeset\/[^/]+\.md$/,
			/^ M packages\/(?:runtime|cli)\/package\.json$/,
			/^ M packages\/(?:runtime|cli)\/CHANGELOG\.md$/,
			/^ M packages\/runtime\/src\/version\.ts$/,
			/^ M pnpm-lock\.yaml$/,
		];
		const unexpected = status.split("\n").filter((line) => !allowed.some((pattern) => pattern.test(line)));
		if (unexpected.length > 0) {
			throw new Error(`Unexpected working tree changes during snapshot:\n${unexpected.join("\n")}`);
		}
	}
	return { commit, remote, dirty: status !== "", status };
}

function registryJson(name, fieldArguments) {
	const result = execute(npm, ["view", name, ...fieldArguments, "--json"], {
		allowFailure: true,
		echo: false,
	});
	if (result.status !== 0) {
		if ((result.stderr ?? "").includes("E404")) return null;
		process.stderr.write(result.stderr ?? "");
		throw new Error(`Unable to query npm registry for ${name}`);
	}
	if (result.stdout.trim() === "") return null;
	return JSON.parse(result.stdout);
}

const repository = repositoryState();
const runtimePackage = readPackage("packages/runtime/package.json");
const cliPackage = readPackage("packages/cli/package.json");
if (runtimePackage.version !== cliPackage.version) throw new Error("Runtime and CLI versions differ");
const version = runtimePackage.version;
if (!allowLocal && version === "0.0.0") throw new Error("Version 0.0.0 cannot be released");
if (!allowLocal && channel === "canary" && !CANARY_VERSION_PATTERN.test(version)) {
	throw new Error(`Canary release requires a canary snapshot version; found ${version}`);
}
if (
	!allowLocal &&
	channel === "canary" &&
	repository.commit !== null &&
	!version.endsWith(`-canary-${repository.commit}`)
) {
	throw new Error(`Canary version does not match checked-out commit ${repository.commit}`);
}
if (channel === "stable" && !STABLE_VERSION_PATTERN.test(version)) {
	throw new Error(`Stable release cannot use prerelease version ${version}`);
}
if (!allowLocal) {
	const originRepository = githubSlug(repository.remote);
	if (originRepository === null) throw new Error("origin must be a GitHub repository URL");
	const actionsRepository = process.env.GITHUB_REPOSITORY?.toLowerCase();
	if (actionsRepository !== undefined && actionsRepository !== originRepository) {
		throw new Error("GITHUB_REPOSITORY does not match the origin remote");
	}
	for (const packageJson of [runtimePackage, cliPackage]) {
		assertReleaseMetadata(packageJson, originRepository);
	}
}

execute(pnpm, ["verify"]);
execute(pnpm, ["pack:all"]);
execute(process.execPath, ["scripts/check-package-contents.mjs"]);
execute(process.execPath, ["scripts/test-tarball-consumer.mjs"]);
execute(pnpm, ["audit", "--prod", "--audit-level", "high"]);

const manifest = JSON.parse(readFileSync(resolve(artifactDirectory, "manifest.json"), "utf8"));
const packages = [];
for (const entry of manifest.packages) {
	if (entry.version !== version) throw new Error(`Tarball version differs for ${entry.name}`);
	const existing = registryJson(`${entry.name}@${entry.version}`, ["version"]);
	if (existing !== null) throw new Error(`${entry.name}@${entry.version} already exists on npm`);
	const distTags = registryJson(entry.name, ["dist-tags"]) ?? {};
	const tarball = resolve(artifactDirectory, entry.file);
	const publishResult = execute(
		npm,
		["publish", tarball, "--dry-run", "--json", "--access", "public", "--tag", distTag],
		{ echo: false },
	);
	const publishPreview = JSON.parse(publishResult.stdout);
	packages.push({ ...entry, distTagsBefore: distTags, publishPreview });
}

const report = {
	schemaVersion: 1,
	channel,
	distTag,
	version,
	repository,
	localOverride: allowLocal,
	packages,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
	`Release dry-run passed for ${packages.length} packages at ${version} with dist-tag ${distTag}.\n`,
);
