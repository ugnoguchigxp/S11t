import { compileCatalog } from "s11tnext/compiler";
import type { S11tnextCatalogArtifact } from "s11tnext";

import { loadProject, type LoadedProject } from "./discover.js";

export type CompiledProject = LoadedProject & { artifact: S11tnextCatalogArtifact };

export function compileProject(
	configArgument?: string,
	cwd = process.cwd(),
	releaseProfile?: string,
): CompiledProject {
	const project = loadProject(configArgument, cwd, releaseProfile);
	const provenance = {
		configPath: project.configPath.slice(project.configDirectory.length + 1).replaceAll("\\", "/"),
		sourceFiles: project.sourceFiles,
	};
	const artifact = compileCatalog(
		project.documents.map((document) => document.definition),
		{
			releaseProfile: project.releaseProfile,
			provenance,
		},
	);
	return { ...project, artifact };
}
