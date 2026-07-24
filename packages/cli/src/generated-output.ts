import { randomBytes } from "node:crypto";
import {
	existsSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";

export type GeneratedOutput = {
	path: string;
	content: string;
};

export type GeneratedFileOperations = {
	exists(path: string): boolean;
	write(path: string, content: string): void;
	rename(source: string, destination: string): void;
	remove(path: string): void;
};

const nodeFileOperations: GeneratedFileOperations = {
	exists: existsSync,
	write: (path, content) => {
		writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
	},
	rename: renameSync,
	remove: (path) => {
		rmSync(path, { force: true });
	},
};

function sibling(path: string, kind: "tmp" | "bak"): string {
	const nonce = randomBytes(12).toString("hex");
	return resolve(path, `../.${basename(path)}.${process.pid}.${nonce}.${kind}`);
}

function cleanup(
	paths: readonly string[],
	operations: GeneratedFileOperations,
	errors?: unknown[],
): void {
	for (const path of paths) {
		try {
			operations.remove(path);
		} catch (error) {
			errors?.push(error);
		}
	}
}

export function replaceGeneratedPair(
	outputs: readonly [GeneratedOutput, GeneratedOutput],
	operations: GeneratedFileOperations = nodeFileOperations,
): void {
	const staged = outputs.map(({ path }) => sibling(path, "tmp"));
	const backups = outputs.map(({ path }) => sibling(path, "bak"));
	const backedUp: number[] = [];
	const installed: number[] = [];
	try {
		for (const [index, output] of outputs.entries()) {
			operations.write(staged[index]!, output.content);
		}
		for (const [index, output] of outputs.entries()) {
			if (operations.exists(output.path)) {
				operations.rename(output.path, backups[index]!);
				backedUp.push(index);
			}
		}
		for (const [index, output] of outputs.entries()) {
			operations.rename(staged[index]!, output.path);
			installed.push(index);
		}
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		cleanup(
			installed.map((index) => outputs[index]!.path).reverse(),
			operations,
			rollbackErrors,
		);
		for (const index of [...backedUp].reverse()) {
			try {
				operations.rename(backups[index]!, outputs[index]!.path);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		cleanup(staged, operations, rollbackErrors);
		if (rollbackErrors.length > 0) {
			throw new AggregateError(
				[error, ...rollbackErrors],
				"Generated output update failed and could not be fully rolled back",
			);
		}
		throw error;
	}
	cleanup(backups, operations);
	cleanup(staged, operations);
}
