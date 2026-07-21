import { build } from "esbuild";

const result = await build({
	entryPoints: ["packages/runtime/dist/index.js"],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	write: false,
	logLevel: "silent",
});

if (result.outputFiles.length !== 1 || result.outputFiles[0].contents.length === 0) {
	throw new Error("Browser bundle smoke produced no output");
}

process.stdout.write("Runtime resolves as an ESM browser-target bundle.\n");
