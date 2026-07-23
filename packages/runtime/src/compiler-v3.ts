import { assertCatalogArtifactV3 } from "./artifact-schema.js";
import {
	assertCatalogIntegrityV3,
	definitionFromCompiledV2,
} from "./catalog-v2.js";
import type { CanonicalContextDefinitionV2 } from "./canonical-definition-v2.js";
import { compileCatalogV2, type CompileCatalogV2Options } from "./compiler-v2.js";
import {
	hashArtifactV3,
	hashCatalogV3,
	hashDefinitionV3,
	hashPolicyV3,
	hashReleaseV3,
} from "./hash-v3.js";
import type {
	S11tCatalogArtifactV3,
	S11tCompiledContextV3,
	S11tRenderingContractV3,
} from "./types.js";

export const RENDERING_CONTRACT_V3: S11tRenderingContractV3 =
	"delimited-context-v1";

export type CompileCatalogV3Options = CompileCatalogV2Options;

export function compileCatalogV3(
	canonicalDefinitions: readonly CanonicalContextDefinitionV2[],
	options: CompileCatalogV3Options,
): S11tCatalogArtifactV3 {
	const v2 = compileCatalogV2(canonicalDefinitions, options);
	const contexts: Record<string, S11tCompiledContextV3> = {};
	const releaseDigests: Record<string, string> = {};
	const requiredLocales: Record<string, string[]> = {};
	for (const [key, source] of Object.entries(v2.contexts)) {
		const locales = Object.fromEntries(
			Object.entries(source.locales).map(([locale, compiled]) => [
				locale,
				{
					sections: compiled.sections,
					artifactHash: hashArtifactV3({
						key,
						locale,
						sections: compiled.sections,
						renderingContract: RENDERING_CONTRACT_V3,
					}),
				},
			]),
		);
		const contextForDefinition: S11tCompiledContextV3 = {
			...source,
			locales,
		};
		const definitionHash = hashDefinitionV3(
			definitionFromCompiledV2(contextForDefinition),
			RENDERING_CONTRACT_V3,
		);
		const artifactHashes = Object.fromEntries(
			Object.entries(locales).map(([locale, compiled]) => [
				locale,
				compiled.artifactHash,
			]),
		);
		const releaseDigest = hashReleaseV3({
			key,
			compilerVersion: v2.compilerVersion,
			definitionHash,
			artifactHashes,
			renderingContract: RENDERING_CONTRACT_V3,
		});
		contexts[key] = {
			...contextForDefinition,
			definitionHash,
			releaseDigest,
		};
		releaseDigests[key] = releaseDigest;
		requiredLocales[key] = [...source.requiredLocales];
	}
	const policyDigest = hashPolicyV3({
		releaseProfile: v2.releaseProfile,
		requiredLocales,
		renderingContract: RENDERING_CONTRACT_V3,
	});
	const artifact: S11tCatalogArtifactV3 = {
		...v2,
		schemaVersion: 3,
		renderingContract: RENDERING_CONTRACT_V3,
		contexts,
		policyDigest,
		catalogDigest: hashCatalogV3({
			compilerVersion: v2.compilerVersion,
			policyDigest,
			releaseDigests,
			aliases: v2.aliases,
			renderingContract: RENDERING_CONTRACT_V3,
		}),
	};
	assertCatalogArtifactV3(artifact);
	assertCatalogIntegrityV3(artifact);
	return artifact;
}
