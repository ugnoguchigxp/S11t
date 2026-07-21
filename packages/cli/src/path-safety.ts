import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function isWithin(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export function resolvesWithin(root: string, target: string): boolean {
	const realRoot = realpathSync(root);
	let existingAncestor = target;
	while (!existsSync(existingAncestor)) {
		const parent = dirname(existingAncestor);
		if (parent === existingAncestor) return false;
		existingAncestor = parent;
	}
	const realAncestor = realpathSync(existingAncestor);
	const unresolvedSuffix = relative(existingAncestor, target);
	return isWithin(realRoot, resolve(realAncestor, unresolvedSuffix));
}
