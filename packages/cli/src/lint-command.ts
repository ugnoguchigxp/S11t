import { loadProject } from "./discover.js";

export function lintProject(config?: string, cwd?: string, releaseProfile?: string): { contexts: number; files: number } {
	const project = loadProject(config, cwd, releaseProfile);
	return { contexts: project.documents.length, files: project.sourceFiles.length };
}
