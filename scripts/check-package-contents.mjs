import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { t as listTar, x as extractTar } from "tar";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = resolve(repositoryRoot, ".artifacts/packages");
const manifestPath = resolve(artifactDirectory, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const requiredRootFiles = [
	"package.json",
	"README.md",
	"LICENSE",
	"NOTICE",
	"SECURITY.md",
	"CONTRIBUTING.md",
	"CHANGELOG.md",
];
const expectedPackageNames = ["@s11t/runtime", "@s11t/cli"];
const expectedRepositoryUrl = "git+https://github.com/ugnoguchigxp/S11t.git";
const expectedBugsUrl = "https://github.com/ugnoguchigxp/S11t/issues";

function filesUnder(root) {
	const files = [];
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) files.push(...filesUnder(path));
		else files.push(path);
	}
	return files;
}

function isAllowed(name, packageName) {
	if (requiredRootFiles.includes(name)) return true;
	if (/^dist\/(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9_./-]+\.(?:js|d\.ts)$/.test(name)) {
		return true;
	}
	return packageName === "@s11t/cli" && name === "bin/s11t.js";
}

function assertSafeTarPath(path) {
	if (
		path.includes("\\") ||
		path.startsWith("/") ||
		path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
	) {
		throw new Error(`Unsafe tar path: ${path}`);
	}
}

function assertExportTarget(packageRoot, packageName, key, value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${packageName} export ${key} must be an object`);
	}
	if (Object.keys(value).sort().join(",") !== "import,types") {
		throw new Error(`${packageName} export ${key} must contain only import and types conditions`);
	}
	for (const condition of ["types", "import"]) {
		const target = value[condition];
		if (
			typeof target !== "string" ||
			!target.startsWith("./dist/") ||
			target.includes("\\") ||
			target.split("/").includes("..") ||
			!existsSync(resolve(packageRoot, target))
		) {
			throw new Error(`${packageName} export ${key}.${condition} has an invalid target`);
		}
	}
}

async function inspectPackage(entry) {
	if (
		entry === null ||
		typeof entry !== "object" ||
		!expectedPackageNames.includes(entry.name) ||
		typeof entry.version !== "string" ||
		typeof entry.file !== "string" ||
		entry.file !== entry.file.split(/[\\/]/).at(-1) ||
		typeof entry.sha512 !== "string" ||
		!/^[0-9a-f]{128}$/.test(entry.sha512)
	) {
		throw new Error("Package manifest contains an invalid entry");
	}
	const tarball = resolve(artifactDirectory, entry.file);
	const actualSha512 = createHash("sha512").update(readFileSync(tarball)).digest("hex");
	if (actualSha512 !== entry.sha512) throw new Error(`${entry.name} tarball checksum mismatch`);
	const tarEntries = [];
	await listTar({
		file: tarball,
		onReadEntry(item) {
			tarEntries.push({ path: item.path, type: item.type, mode: item.mode });
			item.resume();
		},
	});
	for (const item of tarEntries) assertSafeTarPath(item.path.replace(/\/$/, ""));
	const fileEntries = tarEntries.filter((item) => item.type !== "Directory");
	for (const item of fileEntries) {
		if (!item.path.startsWith("package/")) throw new Error(`Unexpected tar path: ${item.path}`);
		const name = item.path.slice("package/".length);
		if (!isAllowed(name, entry.name)) throw new Error(`${entry.name} contains unexpected file: ${name}`);
		if (item.type !== "File" && item.type !== "OldFile" && item.type !== "ContiguousFile") {
			throw new Error(`${entry.name} contains unsupported entry type ${item.type}: ${name}`);
		}
	}
	for (const required of requiredRootFiles) {
		if (!fileEntries.some((item) => item.path === `package/${required}`)) {
			throw new Error(`${entry.name} is missing ${required}`);
		}
	}
	if (!fileEntries.some((item) => item.path.startsWith("package/dist/"))) {
		throw new Error(`${entry.name} contains no compiled output`);
	}
	if (entry.name === "@s11t/cli") {
		const bin = fileEntries.find((item) => item.path === "package/bin/s11t.js");
		if (bin === undefined) throw new Error("CLI tarball is missing bin/s11t.js");
		if (process.platform !== "win32" && ((bin.mode ?? 0) & 0o111) === 0) {
			throw new Error("CLI bin/s11t.js is not executable");
		}
	}

	const temporary = mkdtempSync(join(tmpdir(), "s11t-package-"));
	try {
		await extractTar({ file: tarball, cwd: temporary, strict: true });
		const packageRoot = resolve(temporary, "package");
		const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
		if (packageJson.name !== entry.name || packageJson.version !== entry.version) {
			throw new Error(`${entry.name} packed manifest identity does not match package.json`);
		}
		const changelog = readFileSync(resolve(packageRoot, "CHANGELOG.md"), "utf8");
		if (!changelog.includes(`## ${entry.version}\n`)) {
			throw new Error(`${entry.name} changelog does not contain version ${entry.version}`);
		}
		if (packageJson.license !== "Apache-2.0") throw new Error(`${entry.name} has no Apache-2.0 license metadata`);
		if (
			packageJson.repository?.type !== "git" ||
			packageJson.repository?.url !== expectedRepositoryUrl ||
			packageJson.repository?.directory !== `packages/${entry.name.slice("@s11t/".length)}`
		) {
			throw new Error(`${entry.name} has invalid repository metadata`);
		}
		if (!packageJson.homepage?.startsWith("https://github.com/ugnoguchigxp/S11t/")) {
			throw new Error(`${entry.name} has invalid homepage metadata`);
		}
		if (packageJson.bugs?.url !== expectedBugsUrl) {
			throw new Error(`${entry.name} has invalid bugs metadata`);
		}
		if (packageJson.types !== "./dist/index.d.ts") throw new Error(`${entry.name} has invalid types metadata`);
		if (packageJson.engines?.node !== "^22.0.0 || ^24.0.0") {
			throw new Error(`${entry.name} has unsupported Node.js engine metadata`);
		}
		if (packageJson.private === true) throw new Error(`${entry.name} is marked private`);
		if (packageJson.bundledDependencies !== undefined || packageJson.bundleDependencies !== undefined) {
			throw new Error(`${entry.name} must not bundle dependencies`);
		}
		if (
			packageJson.publishConfig?.access !== "public" ||
			packageJson.publishConfig?.registry !== "https://registry.npmjs.org/"
		) {
			throw new Error(`${entry.name} has unsafe publishConfig metadata`);
		}
		for (const lifecycle of [
			"preinstall",
			"install",
			"postinstall",
			"prepack",
			"prepare",
			"prepublish",
			"prepublishOnly",
		]) {
			if (packageJson.scripts?.[lifecycle] !== undefined) {
				throw new Error(`${entry.name} contains lifecycle script ${lifecycle}`);
			}
		}
		for (const [key, value] of Object.entries(packageJson.exports ?? {})) {
			assertExportTarget(packageRoot, entry.name, key, value);
		}
		const forbidden = [
			{ label: "workspace protocol", pattern: /workspace:/ },
			{ label: "repository file dependency", pattern: /["']file:(?:\.\.\/|\/)/ },
			{ label: "macOS absolute path", pattern: /\/Users\// },
			{ label: "Linux absolute path", pattern: /\/home\// },
			{ label: "Windows absolute path", pattern: /[A-Za-z]:\\\\/ },
			{ label: "current repository path", pattern: new RegExp(repositoryRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) },
		];
		for (const path of filesUnder(packageRoot)) {
			const content = readFileSync(path, "utf8");
			for (const rule of forbidden) {
				if (rule.pattern.test(content)) {
					throw new Error(`${entry.name} contains ${rule.label} in ${relative(packageRoot, path)}`);
				}
			}
		}
		return packageJson;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages) || manifest.packages.length !== 2) {
	throw new Error("Package manifest must contain runtime and CLI tarballs");
}
if (
	new Set(manifest.packages.map((entry) => entry?.name)).size !== expectedPackageNames.length ||
	expectedPackageNames.some((name) => !manifest.packages.some((entry) => entry?.name === name))
) {
	throw new Error("Package manifest must contain each expected package exactly once");
}
const packageJsonByName = new Map();
for (const entry of manifest.packages) packageJsonByName.set(entry.name, await inspectPackage(entry));

const runtime = packageJsonByName.get("@s11t/runtime");
const cli = packageJsonByName.get("@s11t/cli");
if (runtime === undefined || cli === undefined) throw new Error("Runtime or CLI package is missing");
if (runtime.version !== cli.version) throw new Error("Packed package versions differ");
if (cli.dependencies?.["@s11t/runtime"] !== runtime.version) {
	throw new Error(
		`CLI must depend on packed runtime ${runtime.version}; found ${cli.dependencies?.["@s11t/runtime"] ?? "missing"}`,
	);
}
if (Object.keys(runtime.exports ?? {}).sort().join(",") !== ".,./compiler") {
	throw new Error("Runtime package exports are incomplete");
}
if (Object.keys(cli.exports ?? {}).join(",") !== ".") throw new Error("CLI package exports are incomplete");
if (Object.keys(runtime.dependencies ?? {}).join(",") !== "@noble/hashes") {
	throw new Error("Runtime package dependencies are unexpected");
}
if (Object.keys(cli.dependencies ?? {}).sort().join(",") !== "@s11t/runtime,smol-toml") {
	throw new Error("CLI package dependencies are unexpected");
}
if (cli.bin?.s11t !== "./bin/s11t.js") throw new Error("CLI bin export is incorrect");

process.stdout.write(`Package content allowlist passed for ${runtime.version}.\n`);
