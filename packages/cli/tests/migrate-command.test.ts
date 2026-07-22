import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

			migrateAuthoringV2({ cwd: root, write: true });
			const after = compileProject(undefined, root, "development");
			expect(isCompiledProjectV2(after)).toBe(true);
			if (!isCompiledProjectV2(after)) throw new Error("Expected v2 artifact");
			const afterText = createCatalogV2(after.artifact)
				.bind({ instructionLocale: "ja-JP" })("structuredOutput:repair", { rawText: "{}" })
				.content.text;
			expect(afterText).toBe(beforeText);
			expect(readFileSync(sourcePath, "utf8")).not.toContain("schema_version");
			expect(readFileSync(sourcePath, "utf8")).toMatch(/^text = /);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

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
