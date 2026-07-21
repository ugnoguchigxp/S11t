import { loadProject } from "./discover.js";

export function lintProject(config?: string, cwd?: string): { contexts: number; files: number } {
	const project = loadProject(config, cwd);
	return { contexts: project.documents.length, files: project.sourceFiles.length };
}
