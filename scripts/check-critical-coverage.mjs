import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const criticalCoverageRequirements = {
	"packages/cli/src/authoring-v2.ts": {
		statements: 80,
		branches: 75,
		functions: 80,
		lines: 80,
	},
	"packages/cli/src/inspect-command.ts": {
		statements: 90,
		branches: 80,
		functions: 100,
		lines: 95,
	},
	"packages/cli/src/main.ts": {
		statements: 75,
		branches: 60,
		functions: 55,
		lines: 84,
	},
	"packages/cli/src/migrate-command.ts": {
		statements: 80,
		branches: 68,
		functions: 90,
		lines: 82,
	},
	"packages/cli/src/migration/journal.ts": {
		statements: 84,
		branches: 70,
		functions: 95,
		lines: 84,
	},
	"packages/cli/src/migration/journal-manifest.ts": {
		statements: 85,
		branches: 90,
		functions: 100,
		lines: 90,
	},
	"packages/cli/src/migration/serialize-v2.ts": {
		statements: 85,
		branches: 80,
		functions: 70,
		lines: 90,
	},
	"packages/runtime/src/catalog-shared.ts": {
		statements: 85,
		branches: 80,
		functions: 100,
		lines: 85,
	},
	"packages/runtime/src/catalog-v2.ts": {
		statements: 80,
		branches: 70,
		functions: 85,
		lines: 80,
	},
};

function normalizedRelative(root, path) {
	return relative(root, path).replaceAll("\\", "/");
}

export function checkCriticalCoverage(
	summary,
	requirements = criticalCoverageRequirements,
	root = repositoryRoot,
) {
	const byFile = new Map(
		Object.entries(summary)
			.filter(([file]) => file !== "total")
			.map(([file, metrics]) => [normalizedRelative(root, file), metrics]),
	);
	const failures = [];
	for (const [file, required] of Object.entries(requirements)) {
		const actual = byFile.get(file);
		if (actual === undefined) {
			failures.push(`${file}: missing from coverage summary`);
			continue;
		}
		for (const [metric, threshold] of Object.entries(required)) {
			const percentage = actual[metric]?.pct;
			if (typeof percentage !== "number" || percentage < threshold) {
				failures.push(`${file} ${metric}: ${String(percentage)}% < ${threshold}%`);
			}
		}
	}
	if (failures.length > 0) {
		throw new Error(`Critical coverage thresholds failed:\n${failures.join("\n")}`);
	}
	return Object.keys(requirements).length;
}

export function main() {
	const summaryPath = resolve(repositoryRoot, "coverage/coverage-summary.json");
	const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
	const checked = checkCriticalCoverage(summary);
	process.stdout.write(`Critical coverage passed for ${checked} files.\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
