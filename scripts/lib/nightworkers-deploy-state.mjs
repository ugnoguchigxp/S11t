import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export function checksum(path) {
	return createHash("sha512").update(readFileSync(path)).digest("hex");
}

function recordedMode(path) {
	return process.platform === "win32" ? {} : { mode: statSync(path).mode & 0o777 };
}

function managedEntry(path) {
	return lstatSync(path, { throwIfNoEntry: false });
}

function snapshotTree(root) {
	if (!existsSync(root)) return [];
	const result = [];
	function visit(directory, prefix = "") {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
		)) {
			const path = resolve(directory, entry.name);
			const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				result.push({ path: relativePath, type: "directory", ...recordedMode(path) });
				visit(path, relativePath);
			} else if (entry.isFile()) {
				result.push({
					path: relativePath,
					type: "file",
					sha512: checksum(path),
					...recordedMode(path),
				});
			} else throw new Error(`Unsupported managed file type: ${path}`);
		}
	}
	visit(root);
	return result;
}

export function backupManagedFiles(target, backupRoot) {
	const files = ["package.json", "bun.lock"];
	const vendorPath = resolve(target, "vendor/s11t");
	const vendorEntry = managedEntry(vendorPath);
	if (vendorEntry?.isSymbolicLink() === true) {
		throw new Error(`Unsupported managed symbolic link: ${vendorPath}`);
	}
	const state = {
		files: new Map(),
		vendorExists: vendorEntry !== undefined,
		...(vendorEntry === undefined ? {} : { vendorMode: recordedMode(vendorPath).mode }),
		vendorSnapshot: snapshotTree(vendorPath),
	};
	for (const file of files) {
		const source = resolve(target, file);
		const sourceEntry = managedEntry(source);
		const present = sourceEntry !== undefined;
		if (sourceEntry?.isSymbolicLink() === true) {
			throw new Error(`Unsupported managed symbolic link: ${source}`);
		}
		state.files.set(file, {
			present,
			...(present ? { sha512: checksum(source) } : {}),
			...(present ? recordedMode(source) : {}),
		});
		if (present) {
			mkdirSync(resolve(backupRoot, dirname(file)), { recursive: true });
			cpSync(source, resolve(backupRoot, file));
		}
	}
	if (state.vendorExists) {
		mkdirSync(resolve(backupRoot, "vendor"), { recursive: true });
		cpSync(resolve(target, "vendor/s11t"), resolve(backupRoot, "vendor/s11t"), {
			recursive: true,
		});
	}
	return state;
}

export function assertManagedFilesRestored(target, state) {
	for (const [file, expected] of state.files) {
		const destination = resolve(target, file);
		if (existsSync(destination) !== expected.present) {
			throw new Error(`Rollback did not restore ${file} presence`);
		}
		if (expected.present && checksum(destination) !== expected.sha512) {
			throw new Error(`Rollback did not restore ${file} bytes`);
		}
		if (
			expected.present &&
			expected.mode !== undefined &&
			(statSync(destination).mode & 0o777) !== expected.mode
		) {
			throw new Error(`Rollback did not restore ${file} mode`);
		}
	}
	const vendor = resolve(target, "vendor/s11t");
	if (existsSync(vendor) !== state.vendorExists) {
		throw new Error("Rollback did not restore vendor/s11t presence");
	}
	if (state.vendorExists) {
		if (
			state.vendorMode !== undefined &&
			(statSync(vendor).mode & 0o777) !== state.vendorMode
		) {
			throw new Error("Rollback did not restore vendor/s11t mode");
		}
		const actual = JSON.stringify(snapshotTree(vendor));
		const expected = JSON.stringify(state.vendorSnapshot);
		if (actual !== expected) throw new Error("Rollback did not restore vendor/s11t bytes");
	}
}

export function restoreManagedFiles(target, backupRoot, state) {
	for (const [file, expected] of state.files) {
		const destination = resolve(target, file);
		rmSync(destination, { force: true });
		if (expected.present) {
			cpSync(resolve(backupRoot, file), destination);
			if (expected.mode !== undefined) chmodSync(destination, expected.mode);
		}
	}
	const vendor = resolve(target, "vendor/s11t");
	rmSync(vendor, { recursive: true, force: true });
	if (state.vendorExists) {
		cpSync(resolve(backupRoot, "vendor/s11t"), vendor, { recursive: true });
		if (process.platform !== "win32") {
			for (const entry of [...state.vendorSnapshot].reverse()) {
				if (entry.mode !== undefined) chmodSync(resolve(vendor, entry.path), entry.mode);
			}
			if (state.vendorMode !== undefined) chmodSync(vendor, state.vendorMode);
		}
	}
	assertManagedFilesRestored(target, state);
}
