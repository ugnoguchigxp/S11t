import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const roots = ["packages/runtime/src", "packages/runtime/dist"];
const forbidden = /(?:from\s+|import\s*\()(["'])node:/;
const failures = [];

function visit(path) {
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) {
			visit(child);
		} else if ([".ts", ".js", ".mjs", ".cjs"].includes(extname(entry.name))) {
			if (forbidden.test(readFileSync(child, "utf8"))) failures.push(child);
		}
	}
}

for (const root of roots) {
	if (existsSync(root)) visit(root);
}

if (failures.length > 0) {
	process.stderr.write(`Runtime Node builtin imports detected:\n${failures.join("\n")}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write("Runtime source and dist contain no node: imports.\n");
}
