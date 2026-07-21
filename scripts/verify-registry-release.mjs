import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = JSON.parse(
	readFileSync(resolve(repositoryRoot, ".artifacts/release-dry-run.json"), "utf8"),
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const attempts = 12;
const retryDelayMilliseconds = 5_000;

function npmJson(arguments_) {
	const result = spawnSync(npm, arguments_, { cwd: repositoryRoot, encoding: "utf8" });
	if (result.status !== 0) {
		return { error: result.stderr ?? `npm ${arguments_.join(" ")} failed`, value: null };
	}
	try {
		return { error: null, value: JSON.parse(result.stdout) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error), value: null };
	}
}

if (
	report.schemaVersion !== 1 ||
	(report.channel !== "canary" && report.channel !== "stable") ||
	(report.distTag !== "canary" && report.distTag !== "latest") ||
	typeof report.version !== "string" ||
	!Array.isArray(report.packages) ||
	report.packages.length !== 2
) {
	throw new Error("Release dry-run report is invalid");
}

for (const entry of report.packages) {
	let verified = false;
	let lastError = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const result = npmJson(["view", entry.name, "dist-tags", "--json"]);
		lastError = result.error;
		const distTags = result.value;
		if (
			distTags !== null &&
			report.channel === "canary" &&
			distTags.latest !== entry.distTagsBefore.latest
		) {
			throw new Error(`${entry.name} latest dist-tag changed during canary publish`);
		}
		if (distTags !== null && distTags[report.distTag] === report.version) {
			verified = true;
			break;
		}
		if (attempt < attempts) {
			await new Promise((resolvePromise) => setTimeout(resolvePromise, retryDelayMilliseconds));
		}
	}
	if (!verified) {
		if (lastError !== null) process.stderr.write(lastError);
		throw new Error(`${entry.name} ${report.distTag} does not point to ${report.version}`);
	}
}

process.stdout.write(`Registry dist-tags verified for ${report.version}.\n`);
