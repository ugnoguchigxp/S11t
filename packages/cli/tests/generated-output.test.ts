import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	replaceGeneratedPair,
	type GeneratedFileOperations,
} from "../src/generated-output.js";

const temporaryDirectories: string[] = [];

function fixture(): {
	directory: string;
	catalogPath: string;
	typesPath: string;
} {
	const directory = mkdtempSync(join(tmpdir(), "s11t-output-"));
	temporaryDirectories.push(directory);
	const catalogPath = join(directory, "catalog.json");
	const typesPath = join(directory, "catalog.generated.ts");
	writeFileSync(catalogPath, "old catalog");
	writeFileSync(typesPath, "old types");
	return { directory, catalogPath, typesPath };
}

function operations(
	fail: { write?: number; rename?: number },
): GeneratedFileOperations {
	let writes = 0;
	let renames = 0;
	return {
		exists: existsSync,
		write: (path, content) => {
			writes += 1;
			if (writes === fail.write) throw new Error("injected write failure");
			writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
		},
		rename: (source, destination) => {
			renames += 1;
			if (renames === fail.rename) throw new Error("injected rename failure");
			renameSync(source, destination);
		},
		remove: (path) => {
			rmSync(path, { force: true });
		},
	};
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("generated output transaction", () => {
	it("leaves the previous pair untouched when staging fails", () => {
		const { directory, catalogPath, typesPath } = fixture();
		expect(() =>
			replaceGeneratedPair(
				[
					{ path: catalogPath, content: "new catalog" },
					{ path: typesPath, content: "new types" },
				],
				operations({ write: 2 }),
			),
		).toThrow("injected write failure");
		expect(readFileSync(catalogPath, "utf8")).toBe("old catalog");
		expect(readFileSync(typesPath, "utf8")).toBe("old types");
		expect(readdirSync(directory).sort()).toEqual(["catalog.generated.ts", "catalog.json"]);
	});

	it("restores the previous pair when the second install fails", () => {
		const { directory, catalogPath, typesPath } = fixture();
		expect(() =>
			replaceGeneratedPair(
				[
					{ path: catalogPath, content: "new catalog" },
					{ path: typesPath, content: "new types" },
				],
				operations({ rename: 4 }),
			),
		).toThrow("injected rename failure");
		expect(readFileSync(catalogPath, "utf8")).toBe("old catalog");
		expect(readFileSync(typesPath, "utf8")).toBe("old types");
		expect(readdirSync(directory).sort()).toEqual(["catalog.generated.ts", "catalog.json"]);
	});
});
