import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	assertManagedFilesRestored,
	backupManagedFiles,
	restoreManagedFiles,
} from "./deploy-nightworkers-canary.mjs";

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
	const directory = mkdtempSync(resolve(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("NightWorkers deployment rollback", () => {
	it("restores package files and the vendored tree byte-for-byte", () => {
		const target = temporaryDirectory("s11t-deploy-target-");
		const backup = temporaryDirectory("s11t-deploy-backup-");
		mkdirSync(resolve(target, "vendor/s11t/nested"), { recursive: true });
		writeFileSync(resolve(target, "package.json"), '{"name":"nightworkers","original":true}\n');
		writeFileSync(resolve(target, "bun.lock"), "original lock\n");
		writeFileSync(resolve(target, "vendor/s11t/manifest.json"), '{"version":"old"}\n');
		writeFileSync(resolve(target, "vendor/s11t/nested/package.tgz"), "old tarball");

		const state = backupManagedFiles(target, backup);
		writeFileSync(resolve(target, "package.json"), '{"name":"nightworkers","original":false}\n');
		writeFileSync(resolve(target, "bun.lock"), "new lock\n");
		rmSync(resolve(target, "vendor/s11t"), { recursive: true, force: true });
		mkdirSync(resolve(target, "vendor/s11t"), { recursive: true });
		writeFileSync(resolve(target, "vendor/s11t/new.tgz"), "new tarball");

		restoreManagedFiles(target, backup, state);
		expect(readFileSync(resolve(target, "package.json"), "utf8")).toBe(
			'{"name":"nightworkers","original":true}\n',
		);
		expect(readFileSync(resolve(target, "bun.lock"), "utf8")).toBe("original lock\n");
		expect(readFileSync(resolve(target, "vendor/s11t/nested/package.tgz"), "utf8")).toBe(
			"old tarball",
		);
		expect(() => assertManagedFilesRestored(target, state)).not.toThrow();
	});

	it("removes managed files that did not exist before deployment", () => {
		const target = temporaryDirectory("s11t-deploy-target-");
		const backup = temporaryDirectory("s11t-deploy-backup-");
		writeFileSync(resolve(target, "package.json"), '{"name":"nightworkers"}\n');

		const state = backupManagedFiles(target, backup);
		writeFileSync(resolve(target, "bun.lock"), "generated lock\n");
		mkdirSync(resolve(target, "vendor/s11t"), { recursive: true });
		writeFileSync(resolve(target, "vendor/s11t/new.tgz"), "new tarball");

		restoreManagedFiles(target, backup, state);
		expect(() => readFileSync(resolve(target, "bun.lock"), "utf8")).toThrow();
		expect(() => readFileSync(resolve(target, "vendor/s11t/new.tgz"), "utf8")).toThrow();
		expect(() => assertManagedFilesRestored(target, state)).not.toThrow();
	});
});
