import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCatalog, createCatalogV2 } from "@s11t/runtime";
import { describe, expect, it } from "vitest";

import { compileProject, isCompiledProjectV2 } from "../src/compile-source.js";
import { migrateAuthoringV2 } from "../src/migrate-command.js";

const fixture = fileURLToPath(new URL("../../../fixtures/valid/simple/", import.meta.url));

describe("migrate authoring-v2", () => {
	it("is dry-run by default and preserves rendered semantics after write", () => {
		const root = mkdtempSync(resolve(tmpdir(), "s11t-migrate-v2-"));
		try {
			cpSync(fixture, root, { recursive: true });
			const sourcePath = resolve(root, "contexts/repair.context.toml");
			const beforeBytes = readFileSync(sourcePath, "utf8");
			const before = compileProject(undefined, root);
			if (before.artifact.schemaVersion !== 1) throw new Error("Expected v1 artifact");
			const beforeText = createCatalog(before.artifact)
				.bind({ instructionLocale: "ja-JP" })("structuredOutput:repair", { rawText: "{}" })
				.content.text;

			const dryRun = migrateAuthoringV2({ cwd: root });
			expect(dryRun).toMatchObject({ written: false, contexts: 1, profiles: 1, aliases: 1 });
			expect(readFileSync(sourcePath, "utf8")).toBe(beforeBytes);

			const written = migrateAuthoringV2({ cwd: root, write: true });
			expect(written).toMatchObject({
				written: true,
				restored: false,
				operationId: expect.stringMatching(/^authoring-v2-[0-9a-f]{24}$/),
			});
			const after = compileProject(undefined, root, "development");
			expect(isCompiledProjectV2(after)).toBe(true);
			if (!isCompiledProjectV2(after)) throw new Error("Expected v2 artifact");
			const afterText = createCatalogV2(after.artifact)
				.bind({ instructionLocale: "ja-JP" })("structuredOutput:repair", { rawText: "{}" })
				.content.text;
			expect(afterText).toBe(beforeText);
			expect(readFileSync(sourcePath, "utf8")).not.toContain("schema_version");
			expect(readFileSync(sourcePath, "utf8")).toMatch(/^text = /);

			const operationId = written.operationId!;
			const operationDirectory = resolve(root, ".s11t/migrations", operationId);
			const manifestPath = resolve(operationDirectory, "manifest.json");
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
				state: string;
				files: Array<{ backup: string }>;
			};
			expect(manifest.state).toBe("committed");
			expect(manifest.files).toHaveLength(2);
			expect(manifest.files.every((entry) => existsSync(resolve(operationDirectory, entry.backup)))).toBe(
				true,
			);

			const restored = migrateAuthoringV2({ cwd: root, restore: operationId });
			expect(restored).toMatchObject({ written: false, restored: true, operationId });
			expect(readFileSync(sourcePath, "utf8")).toBe(beforeBytes);
			expect(JSON.parse(readFileSync(manifestPath, "utf8")).state).toBe("rolled-back");
			expect(compileProject(undefined, root).artifact.schemaVersion).toBe(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("blocks a new write while a durable prepared operation awaits restore", () => {
		const root = mkdtempSync(resolve(tmpdir(), "s11t-migrate-v2-pending-"));
		try {
			cpSync(fixture, root, { recursive: true });
			const result = migrateAuthoringV2({ cwd: root, write: true });
			const operationId = result.operationId!;
			const manifestPath = resolve(root, ".s11t/migrations", operationId, "manifest.json");
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { state: string };
			manifest.state = "prepared";
			writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

			expect(() => migrateAuthoringV2({ cwd: root, write: true })).toThrowError(
				expect.objectContaining({
					diagnostics: [
						expect.objectContaining({ code: "S11T_AUTHORING_MIGRATION_PENDING" }),
					],
				}),
			);
			expect(readdirSync(resolve(root, ".s11t/migrations"))).toEqual([operationId]);

			migrateAuthoringV2({ cwd: root, restore: operationId });
			expect(compileProject(undefined, root).artifact.schemaVersion).toBe(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")(
		"rejects a migration backup directory symlinked outside the project",
		() => {
			const root = mkdtempSync(resolve(tmpdir(), "s11t-migrate-v2-symlink-"));
			const outside = mkdtempSync(resolve(tmpdir(), "s11t-migrate-v2-outside-"));
			try {
				cpSync(fixture, root, { recursive: true });
				symlinkSync(outside, resolve(root, ".s11t"), "dir");
				expect(() => migrateAuthoringV2({ cwd: root, write: true })).toThrowError(
					expect.objectContaining({
						diagnostics: [
							expect.objectContaining({ code: "S11T_AUTHORING_MIGRATION_INVALID" }),
						],
					}),
				);
				expect(readdirSync(outside)).toEqual([]);
			} finally {
				rmSync(root, { recursive: true, force: true });
				rmSync(outside, { recursive: true, force: true });
			}
		},
	);

	it("rejects malformed and ambiguous migration manifests", () => {
		for (const corruption of ["null-summary", "duplicate-target"] as const) {
			const root = mkdtempSync(resolve(tmpdir(), `s11t-migrate-v2-${corruption}-`));
			try {
				cpSync(fixture, root, { recursive: true });
				const result = migrateAuthoringV2({ cwd: root, write: true });
				const manifestPath = resolve(
					root,
					".s11t/migrations",
					result.operationId!,
					"manifest.json",
				);
				const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
					summary: unknown;
					files: Array<{ path: string }>;
				};
				if (corruption === "null-summary") {
					manifest.summary = null;
				} else {
					manifest.files[1]!.path = manifest.files[0]!.path;
				}
				writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

				expect(() => migrateAuthoringV2({ cwd: root, restore: result.operationId! })).toThrowError(
					expect.objectContaining({
						diagnostics: [
							expect.objectContaining({ code: "S11T_AUTHORING_MIGRATION_INVALID" }),
						],
					}),
				);
				expect(compileProject(undefined, root, "development").artifact.schemaVersion).toBe(2);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	it.skipIf(process.platform === "win32")(
		"refuses to restore through a source-file symlink outside the project",
		() => {
			const root = mkdtempSync(resolve(tmpdir(), "s11t-migrate-v2-restore-symlink-"));
			const outside = mkdtempSync(resolve(tmpdir(), "s11t-migrate-v2-restore-outside-"));
			try {
				cpSync(fixture, root, { recursive: true });
				const result = migrateAuthoringV2({ cwd: root, write: true });
				const sourcePath = resolve(root, "contexts/repair.context.toml");
				const outsidePath = resolve(outside, "repair.context.toml");
				writeFileSync(outsidePath, "outside\n", "utf8");
				rmSync(sourcePath);
				symlinkSync(outsidePath, sourcePath, "file");

				expect(() => migrateAuthoringV2({ cwd: root, restore: result.operationId! })).toThrowError(
					expect.objectContaining({
						diagnostics: [
							expect.objectContaining({ code: "S11T_AUTHORING_MIGRATION_INVALID" }),
						],
					}),
				);
				expect(readFileSync(outsidePath, "utf8")).toBe("outside\n");
			} finally {
				rmSync(root, { recursive: true, force: true });
				rmSync(outside, { recursive: true, force: true });
			}
		},
	);

	it("rejects per-context required locale drift during dry-run", () => {
		const root = mkdtempSync(resolve(tmpdir(), "s11t-migrate-v2-drift-"));
		try {
			cpSync(fixture, root, { recursive: true });
			const sourcePath = resolve(root, "contexts/repair.context.toml");
			const original = readFileSync(sourcePath, "utf8");
			const withExtraRequiredLocale = original
				.replace(
					'required_locales = ["ja-JP", "en-US"]',
					'required_locales = ["ja-JP", "en-US", "fr-FR"]',
				)
				.concat('\n[locales."fr-FR"]\ntext = "Réparez la réponse. [[rawText]]"\n');
			writeFileSync(sourcePath, withExtraRequiredLocale, "utf8");

			expect(() => migrateAuthoringV2({ cwd: root })).toThrowError(
				expect.objectContaining({
					diagnostics: [
						expect.objectContaining({ code: "S11T_AUTHORING_MIGRATION_DRIFT" }),
					],
				}),
			);
			expect(readFileSync(sourcePath, "utf8")).toBe(withExtraRequiredLocale);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
