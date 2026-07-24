import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";

const { sync: spawnSync } = crossSpawn;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(repositoryRoot, ".artifacts/packages");
const manifestPath = resolve(outputDirectory, "manifest.json");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageDefinitions = [
	{ name: "s11tnext", directory: resolve(repositoryRoot, "packages/runtime") },
	{ name: "s11tnext-cli", directory: resolve(repositoryRoot, "packages/cli") },
];

function run(command, arguments_, cwd) {
	const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", stdio: "pipe" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout ?? "");
		process.stderr.write(result.stderr ?? "");
		throw new Error(`${command} ${arguments_.join(" ")} failed with exit code ${result.status}`);
	}
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
}

function readPackage(directory) {
	return JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
}

function tarballPrefix(name) {
	return `${name.replace(/^@/, "").replaceAll("/", "-")}-`;
}

mkdirSync(outputDirectory, { recursive: true });
for (const name of readdirSync(outputDirectory)) {
	if (
		name === "manifest.json" ||
		packageDefinitions.some((definition) =>
			name.startsWith(tarballPrefix(definition.name)) && name.endsWith(".tgz"),
		)
	) {
		rmSync(resolve(outputDirectory, name), { force: true });
	}
}

run(pnpm, ["clean"], repositoryRoot);
for (const definition of packageDefinitions) {
	rmSync(resolve(definition.directory, "dist"), { recursive: true, force: true });
}
run(pnpm, ["build"], repositoryRoot);

const packages = [];
for (const definition of packageDefinitions) {
	const packageJson = readPackage(definition.directory);
	if (typeof packageJson.version !== "string") {
		throw new TypeError(`${definition.name} has no package version`);
	}
	const before = new Set(readdirSync(outputDirectory));
	run(pnpm, ["pack", "--pack-destination", outputDirectory], definition.directory);
	const created = readdirSync(outputDirectory).filter(
		(name) => !before.has(name) && name.endsWith(".tgz"),
	);
	if (created.length !== 1) {
		throw new Error(`Expected one tarball for ${definition.name}, found ${created.length}`);
	}
	const file = created[0];
	if (file === undefined || !file.startsWith(tarballPrefix(definition.name))) {
		throw new Error(`Unexpected tarball name for ${definition.name}: ${file ?? "missing"}`);
	}
	const path = resolve(outputDirectory, file);
	if (!existsSync(path)) throw new Error(`Tarball was not created: ${path}`);
	packages.push({
		name: definition.name,
		version: packageJson.version,
		file,
		sha512: createHash("sha512").update(readFileSync(path)).digest("hex"),
	});
}

const versions = new Set(packages.map((entry) => entry.version));
if (versions.size !== 1) throw new Error("Runtime and CLI tarballs must share one version");

const manifest = { packages };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Packed ${packages.length} packages into ${relative(repositoryRoot, outputDirectory)}.\n`);
