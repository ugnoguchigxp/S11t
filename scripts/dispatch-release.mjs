import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";

const { sync: spawnSync } = crossSpawn;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
const channel = arguments_.shift();
const dryRun = arguments_.includes("--dry-run");

process.on("uncaughtException", (error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`Release dispatch failed: ${message}\n`);
	process.exitCode = 1;
});

if (
	(channel !== "bootstrap" && channel !== "canary" && channel !== "stable") ||
	arguments_.some((argument) => argument !== "--dry-run") ||
	arguments_.filter((argument) => argument === "--dry-run").length > 1
) {
	process.stderr.write(
		"Usage: node scripts/dispatch-release.mjs bootstrap|canary|stable [--dry-run]\n",
	);
	process.exit(2);
}

function readPackage(path) {
	return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

function run(command, commandArguments) {
	const result = spawnSync(command, commandArguments, {
		cwd: repositoryRoot,
		encoding: "utf8",
		stdio: "pipe",
	});
	if (result.status !== 0) {
		process.stdout.write(result.stdout ?? "");
		process.stderr.write(result.stderr ?? "");
		throw new Error(`${command} ${commandArguments.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function repositorySlug(value) {
	const url = typeof value === "string" ? value : value?.url;
	if (typeof url !== "string") return null;
	const match = url.match(
		/^(?:git\+)?https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
	);
	return match?.[1] ?? null;
}

const runtimePackage = readPackage("packages/runtime/package.json");
const cliPackage = readPackage("packages/cli/package.json");
if (runtimePackage.name !== "s11tnext" || cliPackage.name !== "s11tnext-cli") {
	throw new Error("Unexpected release package names");
}
if (
	typeof runtimePackage.version !== "string" ||
	runtimePackage.version !== cliPackage.version
) {
	throw new Error("Runtime and CLI package versions must match");
}
const repository = repositorySlug(runtimePackage.repository);
if (repository === null || repository !== repositorySlug(cliPackage.repository)) {
	throw new Error("Runtime and CLI repository metadata must match");
}

const commit = run("git", ["rev-parse", "HEAD"]);
if (!/^[0-9a-f]{40}$/.test(commit)) {
	throw new Error("Release dispatch requires a committed Git revision");
}
const status = run("git", ["status", "--porcelain"]);
const confirmation = `publish-${channel}`;
const command = [
	"workflow",
	"run",
	"release.yml",
	"--repo",
	repository,
	"--ref",
	"main",
	"--field",
	`channel=${channel}`,
	"--field",
	`ref=${commit}`,
	"--field",
	`confirm=${confirmation}`,
];
const plan = {
	channel,
	version: runtimePackage.version,
	packages: [runtimePackage.name, cliPackage.name],
	repository,
	commit,
	confirmation,
};

if (dryRun) {
	process.stdout.write(`${JSON.stringify({ ...plan, command: ["gh", ...command] }, null, 2)}\n`);
	process.exit(0);
}
if (status !== "") {
	throw new Error("Release dispatch requires a clean working tree");
}

process.stdout.write(
	`Dispatching ${channel} release for ${runtimePackage.name}@${runtimePackage.version} and ${cliPackage.name}@${cliPackage.version} from ${commit}.\n`,
);
run("gh", command);
process.stdout.write(
	`Release workflow dispatched. Follow it with: gh run watch --repo ${repository}\n`,
);
