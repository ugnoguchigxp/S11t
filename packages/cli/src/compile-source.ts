import { compileCatalog } from "@s11t/runtime/compiler";
import type { S11tCatalogArtifactV1 } from "@s11t/runtime";

import { loadProject, type LoadedProject } from "./discover.js";

export type CompiledProject = LoadedProject & { artifact: S11tCatalogArtifactV1 };

export function compileProject(configArgument?: string, cwd = process.cwd()): CompiledProject {
	const project = loadProject(configArgument, cwd);
	const artifact = compileCatalog(
		project.documents.map((document) => document.definition),
		{
			defaultLocale: project.config.defaultLocale,
			provenance: {
				configPath: project.configPath.slice(project.configDirectory.length + 1).replaceAll("\\", "/"),
				sourceFiles: project.sourceFiles,
			},
		},
	);
	return { ...project, artifact };
}
