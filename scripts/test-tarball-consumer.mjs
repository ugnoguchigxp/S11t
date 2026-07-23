import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";

const { sync: spawnSync } = crossSpawn;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(repositoryRoot, "test-consumer/esm-node");
const artifactDirectory = resolve(repositoryRoot, ".artifacts/packages");
const manifest = JSON.parse(readFileSync(resolve(artifactDirectory, "manifest.json"), "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;
const temporary = mkdtempSync(join(tmpdir(), "s11t-consumer-"));

function run(command, arguments_, options = {}) {
	const result = spawnSync(command, arguments_, {
		cwd: temporary,
		encoding: "utf8",
		env: { ...process.env, npm_config_yes: "false" },
		...options,
	});
	if (result.status !== 0) {
		process.stderr.write(result.stdout ?? "");
		process.stderr.write(result.stderr ?? "");
		throw new Error(`${command} ${arguments_.join(" ")} failed with exit code ${result.status}`);
	}
	return result.stdout ?? "";
}

try {
	if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages) || manifest.packages.length !== 2) {
		throw new Error("Package manifest is invalid");
	}
	cpSync(fixtureRoot, temporary, { recursive: true });
	const packageDirectory = resolve(temporary, "packages");
	mkdirSync(packageDirectory);
	const installTargets = [];
	for (const entry of manifest.packages) {
		const source = resolve(artifactDirectory, entry.file);
		const destination = resolve(packageDirectory, basename(entry.file));
		cpSync(source, destination);
		installTargets.push(`./packages/${basename(entry.file)}`);
	}
	run(npm, ["install", "--ignore-scripts", "--no-audit", "--fund=false", ...installTargets]);

	const lockfile = readFileSync(resolve(temporary, "package-lock.json"), "utf8");
	if (lockfile.includes("workspace:") || lockfile.includes(repositoryRoot)) {
		throw new Error("Consumer lockfile references the workspace");
	}
	const dependencyTree = JSON.parse(
		run(npm, ["ls", "@s11t/runtime", "@s11t/cli", "--json", "--all"]),
	);
	if (dependencyTree.dependencies?.["@s11t/runtime"] === undefined) {
		throw new Error("Consumer did not install @s11t/runtime");
	}
	if (dependencyTree.dependencies?.["@s11t/cli"] === undefined) {
		throw new Error("Consumer did not install @s11t/cli");
	}
	for (const entry of manifest.packages) {
		if (dependencyTree.dependencies?.[entry.name]?.version !== entry.version) {
			throw new Error(
				`Consumer installed ${entry.name}@${dependencyTree.dependencies?.[entry.name]?.version ?? "missing"}; expected ${entry.version}`,
			);
		}
	}

	const binName = process.platform === "win32" ? "s11t.cmd" : "s11t";
	if (!existsSync(resolve(temporary, "node_modules/.bin", binName))) {
		throw new Error("Consumer has no local s11t binary");
	}
	run(npm, ["exec", "--", "s11t", "--help"]);
	run(npm, ["exec", "--", "s11t", "lint"]);
	run(npm, ["exec", "--", "s11t", "build"]);
	run(npm, ["exec", "--", "s11t", "build", "--check"]);
	run(npm, ["exec", "--", "s11t", "lint", "--config", "s11t-v2.config.toml", "--release-profile", "development"]);
	run(npm, ["exec", "--", "s11t", "build", "--config", "s11t-v2.config.toml", "--release-profile", "development"]);
	run(npm, ["exec", "--", "s11t", "build", "--check", "--config", "s11t-v2.config.toml", "--release-profile", "development"]);
	run(npm, ["exec", "--", "tsc", "-p", "tsconfig.json", "--pretty", "false"]);
	const output = run(node, ["dist/src/index.js"]);
	const result = JSON.parse(output);
	const invocation = result.invocation;
	if (invocation.key !== "consumer:identity") throw new Error("Consumer returned the wrong key");
	if (!invocation.content?.text?.includes("tarballを検証する")) {
		throw new Error("Consumer did not render the runtime value");
	}
	if (
		result.invocationV2?.key !== "consumer.identity" ||
		!result.invocationV2?.content?.text?.includes("tarballを検証する")
	) {
		throw new Error("Consumer did not render the artifact v2 runtime value");
	}
	if (
		!result.textV2?.includes("tarballを検証する") ||
		result.statusTextV2 !== "準備完了\n" ||
		result.liveStatusTextJaV2 !== "準備完了\n" ||
		result.liveStatusTextEnV2 !== "Ready\n" ||
		result.fixedStatusAfterLanguageChangeV2 !== "準備完了\n"
	) {
		throw new Error("Consumer did not preserve snapshot and live language-switch semantics");
	}
	if (
		result.invocationV2?.manifest?.requestedLocale !== "ja-JP" ||
		result.invocationV2?.manifest?.resolvedLocale !== "ja-JP" ||
		result.invocationV2?.manifest?.fallbackLocales?.length !== 0 ||
		result.invocationV2?.manifest?.renderedHash === undefined ||
		result.invocationV2?.manifest?.releaseDigest === undefined ||
		result.invocationV2?.manifest?.policyDigest === undefined
	) {
		throw new Error("Consumer did not retain the artifact v2 invocation manifest");
	}
	const expectedVersion = manifest.packages[0]?.version;
	if (invocation.manifest?.compilerVersion !== expectedVersion) {
		throw new Error(
			`Consumer compiler version ${invocation.manifest?.compilerVersion} does not match ${expectedVersion}`,
		);
	}
	if (result.compilerVersion !== expectedVersion) {
		throw new Error(`Compiler subpath exported ${result.compilerVersion}; expected ${expectedVersion}`);
	}
	if (result.segments?.[0]?.type !== "variable" || result.segments[0].name !== "value") {
		throw new Error("Compiler subpath did not expose tokenizeTemplate");
	}
	process.stdout.write(`Isolated ESM consumer passed for ${expectedVersion}.\n`);
} finally {
	if (process.env.S11T_KEEP_CONSUMER_TMP === "1") {
		process.stdout.write(`Consumer workspace retained at ${temporary}.\n`);
	} else {
		rmSync(temporary, { recursive: true, force: true });
	}
}
