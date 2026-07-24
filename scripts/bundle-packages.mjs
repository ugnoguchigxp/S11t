import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selectedPackage = process.argv[2];
const packageBuilds = {
	runtime: {
		declarationEntries: ["index.d.ts", "compiler.d.ts"],
		entryPoints: [
			resolve(repositoryRoot, "packages/runtime/src/index.ts"),
			resolve(repositoryRoot, "packages/runtime/src/compiler.ts"),
		],
		external: ["@noble/hashes/*"],
		outdir: resolve(repositoryRoot, "packages/runtime/dist"),
		platform: "neutral",
	},
	cli: {
		declarationEntries: ["index.d.ts"],
		entryPoints: [
			resolve(repositoryRoot, "packages/cli/src/index.ts"),
			resolve(repositoryRoot, "packages/cli/src/bin.ts"),
		],
		external: ["@s11t/runtime", "@s11t/runtime/compiler", "smol-toml"],
		outdir: resolve(repositoryRoot, "packages/cli/dist"),
		platform: "node",
	},
};

function removeJavaScriptFiles(directory) {
	if (!existsSync(directory)) return;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) removeJavaScriptFiles(path);
		else if (entry.name.endsWith(".js")) rmSync(path);
	}
}

function filesUnder(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? filesUnder(path) : [path];
	});
}

function pruneDeclarations(directory, entries) {
	const retained = new Set();
	const pending = entries.map((entry) => resolve(directory, entry));
	while (pending.length > 0) {
		const path = pending.pop();
		if (path === undefined || retained.has(path)) continue;
		retained.add(path);
		const imports = readFileSync(path, "utf8").matchAll(
			/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']/g,
		);
		for (const imported of imports) {
			const specifier = imported[1];
			if (specifier === undefined) continue;
			const declarationPath = resolve(
				dirname(path),
				specifier.replace(/\.js$/, ".d.ts"),
			);
			if (existsSync(declarationPath)) pending.push(declarationPath);
		}
	}
	for (const path of filesUnder(directory)) {
		if (path.endsWith(".d.ts") && !retained.has(path)) rmSync(path);
	}
}

if (selectedPackage === "clean") {
	for (const options of Object.values(packageBuilds)) {
		removeJavaScriptFiles(options.outdir);
	}
	process.exit(0);
}

const names =
	selectedPackage === undefined
		? Object.keys(packageBuilds)
		: [selectedPackage];

for (const name of names) {
	const options = packageBuilds[name];
	if (options === undefined) {
		throw new TypeError(`Unknown package build: ${name}`);
	}
	const { declarationEntries, ...buildOptions } = options;
	removeJavaScriptFiles(options.outdir);
	await build({
		...buildOptions,
		bundle: true,
		chunkNames: "chunks/[name]-[hash]",
		format: "esm",
		logLevel: "silent",
		minify: true,
		splitting: true,
		target: "es2022",
	});
	pruneDeclarations(options.outdir, declarationEntries);
}
