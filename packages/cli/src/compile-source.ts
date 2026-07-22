import { compileCatalog, compileCatalogV2 } from "@s11t/runtime/compiler";
import type { S11tCatalogArtifactV1, S11tCatalogArtifactV2 } from "@s11t/runtime";

import { loadProject, type LoadedProjectV1, type LoadedProjectV2 } from "./discover.js";

export type CompiledProjectV1 = LoadedProjectV1 & { artifact: S11tCatalogArtifactV1 };
export type CompiledProjectV2 = LoadedProjectV2 & { artifact: S11tCatalogArtifactV2 };
export type CompiledProject = CompiledProjectV1 | CompiledProjectV2;

function isLoadedProjectV1(project: LoadedProjectV1 | LoadedProjectV2): project is LoadedProjectV1 {
	return project.config.schemaVersion === 1;
}

export function isCompiledProjectV2(project: CompiledProject): project is CompiledProjectV2 {
	return project.artifact.schemaVersion === 2;
}

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
	if (isLoadedProjectV1(project)) {
		const artifact = compileCatalog(
			project.documents.map((document) => document.definition),
			{ defaultLocale: project.config.defaultLocale, provenance },
		);
		return { ...project, artifact };
	}
	const artifact = compileCatalogV2(
		project.documents.map((document) => document.definition),
		{
			releaseProfile: project.releaseProfile,
			aliases: project.aliases,
			provenance,
		},
	);
	return { ...project, artifact };
}
