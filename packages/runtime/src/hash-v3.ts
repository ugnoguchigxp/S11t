import type { CanonicalContextDefinitionV2 } from "./canonical-definition-v2.js";
import { canonicalJson } from "./canonical-json.js";
import { sha256Utf8, type S11tDigest } from "./hash.js";
import type {
	JsonValue,
	S11tCompiledSectionV3,
	S11tRenderingContractV3,
} from "./types.js";

const HASH_DOMAINS = {
	definition: "s11t.definition.v3",
	artifact: "s11t.artifact.v3",
	release: "s11t.release.v3",
	policy: "s11t.policy.v3",
	catalog: "s11t.catalog.v3",
} as const;

function hashCanonical(domain: string, value: JsonValue): S11tDigest {
	return sha256Utf8(`${domain}\0${canonicalJson(value)}`);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function hashDefinitionV3(
	value: CanonicalContextDefinitionV2,
	renderingContract: S11tRenderingContractV3,
): S11tDigest {
	return hashCanonical(HASH_DOMAINS.definition, {
		renderingContract,
		key: value.key,
		owner: value.owner,
		contentKind: value.contentKind,
		sourceLocale: value.sourceLocale,
		requiredLocales: [...value.requiredLocales],
		variables: value.variables,
		sections: value.sections,
	});
}

export function hashArtifactV3(value: {
	key: string;
	locale: string;
	sections: S11tCompiledSectionV3[];
	renderingContract: S11tRenderingContractV3;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.artifact, value);
}

export function hashReleaseV3(value: {
	key: string;
	compilerVersion: string;
	definitionHash: string;
	artifactHashes: Record<string, string>;
	renderingContract: S11tRenderingContractV3;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.release, {
		key: value.key,
		schemaVersion: 3,
		renderingContract: value.renderingContract,
		compilerVersion: value.compilerVersion,
		definitionHash: value.definitionHash,
		artifacts: Object.entries(value.artifactHashes).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		),
	});
}

export function hashPolicyV3(value: {
	releaseProfile: string;
	requiredLocales: Record<string, string[]>;
	renderingContract: S11tRenderingContractV3;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.policy, {
		renderingContract: value.renderingContract,
		releaseProfile: value.releaseProfile,
		requiredLocales: Object.entries(value.requiredLocales).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		),
	});
}

export function hashCatalogV3(value: {
	compilerVersion: string;
	policyDigest: string;
	releaseDigests: Record<string, string>;
	aliases: Record<string, string>;
	renderingContract: S11tRenderingContractV3;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.catalog, {
		schemaVersion: 3,
		renderingContract: value.renderingContract,
		compilerVersion: value.compilerVersion,
		policyDigest: value.policyDigest,
		releases: Object.entries(value.releaseDigests).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		),
		aliases: Object.entries(value.aliases).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		),
	});
}
