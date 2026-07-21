import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimePackagePath = resolve(repositoryRoot, "packages/runtime/package.json");
const cliPackagePath = resolve(repositoryRoot, "packages/cli/package.json");
const versionSourcePath = resolve(repositoryRoot, "packages/runtime/src/version.ts");
const checkOnly = process.argv.includes("--check");

function packageVersion(path) {
	const value = JSON.parse(readFileSync(path, "utf8"));
	if (typeof value.version !== "string") throw new TypeError(`${path} has no version`);
	return value.version;
}

const runtimeVersion = packageVersion(runtimePackagePath);
const cliVersion = packageVersion(cliPackagePath);
if (runtimeVersion !== cliVersion) {
	throw new Error(`Package versions differ: runtime=${runtimeVersion}, cli=${cliVersion}`);
}

const source = readFileSync(versionSourcePath, "utf8");
const pattern = /export const COMPILER_VERSION = "([^"]+)";/;
const match = source.match(pattern);
if (match === null) throw new Error(`COMPILER_VERSION was not found in ${versionSourcePath}`);

if (checkOnly) {
	if (match[1] !== runtimeVersion) {
		throw new Error(
			`Compiler version differs from package version: compiler=${match[1]}, package=${runtimeVersion}`,
		);
	}
	process.stdout.write(`Package and compiler versions match (${runtimeVersion}).\n`);
} else {
	const updated = source.replace(pattern, `export const COMPILER_VERSION = "${runtimeVersion}";`);
	if (updated !== source) writeFileSync(versionSourcePath, updated, "utf8");
	process.stdout.write(`Synchronized compiler version to ${runtimeVersion}.\n`);
}
