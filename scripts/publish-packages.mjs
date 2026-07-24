import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import crossSpawn from "cross-spawn";

const { sync: spawnSync } = crossSpawn;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = resolve(repositoryRoot, ".artifacts/packages");
const manifestPath = resolve(artifactDirectory, "manifest.json");
const arguments_ = process.argv.slice(2);
const planOnly = arguments_.includes("--plan");
const yes = arguments_.includes("--yes");

process.on("uncaughtException", (error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`Publish failed: ${message}\n`);
	process.exitCode = 1;
});

if (
	arguments_.some((argument) => argument !== "--plan" && argument !== "--yes") ||
	arguments_.filter((argument) => argument === "--plan").length > 1 ||
	arguments_.filter((argument) => argument === "--yes").length > 1 ||
	(planOnly && yes)
) {
	process.stderr.write("Usage: node scripts/publish-packages.mjs [--plan | --yes]\n");
	process.exit(2);
}

function readPackage(path) {
	return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

function execute(command, commandArguments, { capture = false } = {}) {
	const result = spawnSync(command, commandArguments, {
		cwd: repositoryRoot,
		encoding: "utf8",
		stdio: capture ? "pipe" : "inherit",
	});
	if (result.status !== 0) {
		if (capture) {
			process.stdout.write(result.stdout ?? "");
			process.stderr.write(result.stderr ?? "");
		}
		throw new Error(`${command} ${commandArguments.join(" ")} exited with code ${result.status}`);
	}
	return capture ? result.stdout.trim() : "";
}

const runtimePackage = readPackage("packages/runtime/package.json");
const cliPackage = readPackage("packages/cli/package.json");
if (runtimePackage.name !== "s11tnext" || cliPackage.name !== "s11tnext-cli") {
	throw new Error("Expected packages s11tnext and s11tnext-cli");
}
if (
	typeof runtimePackage.version !== "string" ||
	runtimePackage.version !== cliPackage.version
) {
	throw new Error("Runtime and CLI package versions must match");
}
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(runtimePackage.version)) {
	throw new Error(`Stable publish requires a normal SemVer version; found ${runtimePackage.version}`);
}

const version = runtimePackage.version;
const expectedPackages = [
	{
		name: runtimePackage.name,
		file: `${runtimePackage.name}-${version}.tgz`,
	},
	{
		name: cliPackage.name,
		file: `${cliPackage.name}-${version}.tgz`,
	},
];

process.stdout.write(`npm release plan
  version: ${version} (from package.json)
  registry: https://registry.npmjs.org/
  dist-tag: latest
  order:
    1. ${expectedPackages[0].name}@${version}
    2. ${expectedPackages[1].name}@${version}
  preflight: full verification, pack, package inspection, isolated install, audit, npm publish --dry-run
  postflight: registry dist-tag verification
`);

if (planOnly) process.exit(0);
if (!yes && (!process.stdin.isTTY || !process.stdout.isTTY)) {
	throw new Error("Interactive confirmation requires a terminal; use --yes only after reviewing --plan");
}

const status = execute("git", ["status", "--porcelain"], { capture: true });
if (status !== "") throw new Error("Commit all changes before publishing");
const npmUser = execute(
	"npm",
	["whoami", "--registry", "https://registry.npmjs.org/"],
	{ capture: true },
);
process.stdout.write(`\nAuthenticated npm user: ${npmUser}\n`);
process.stdout.write("Running release preflight. Nothing will be published during this step.\n\n");
execute("pnpm", ["release:dry-run", "--", "--channel", "stable"]);

if (!existsSync(manifestPath)) throw new Error("Package manifest was not created by preflight");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.packages) || manifest.packages.length !== expectedPackages.length) {
	throw new Error("Package manifest does not contain exactly two packages");
}
for (const [index, expected] of expectedPackages.entries()) {
	const entry = manifest.packages[index];
	if (
		entry?.name !== expected.name ||
		entry?.version !== version ||
		entry?.file !== expected.file
	) {
		throw new Error(`Unexpected package manifest entry at index ${index}`);
	}
	if (!existsSync(resolve(artifactDirectory, entry.file))) {
		throw new Error(`Tarball is missing: ${entry.file}`);
	}
}

if (!yes) {
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await prompt.question(
		`\nPublish both packages as latest? Type ${version} to continue: `,
	);
	prompt.close();
	if (answer.trim() !== version) {
		process.stdout.write("Publish cancelled. No package was published.\n");
		process.exit(0);
	}
}

for (const entry of manifest.packages) {
	process.stdout.write(`\nPublishing ${entry.name}@${entry.version}...\n`);
	try {
		execute("npm", [
			"publish",
			resolve(artifactDirectory, entry.file),
			"--access",
			"public",
			"--tag",
			"latest",
		]);
	} catch (error) {
		process.stderr.write(
			`Stopped while publishing ${entry.name}. Check npm before retrying; a preceding package may already be immutable on the registry.\n`,
		);
		throw error;
	}
}

process.stdout.write("\nBoth publish commands completed. Verifying npm registry state...\n");
execute(process.execPath, ["scripts/verify-registry-release.mjs"]);
process.stdout.write(`Published s11tnext@${version} and s11tnext-cli@${version} successfully.\n`);
