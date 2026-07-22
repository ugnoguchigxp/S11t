import { canonicalJson } from "./canonical-json.js";
import type { CanonicalContextDefinitionV2 } from "./canonical-definition-v2.js";
import { sha256Utf8, type S11tDigest } from "./hash.js";
import type { JsonValue, S11tCompiledSectionV2 } from "./types.js";

const HASH_DOMAINS = {
	definition: "s11t.definition.v2",
	artifact: "s11t.artifact.v2",
	release: "s11t.release.v2",
	policy: "s11t.policy.v2",
	catalog: "s11t.catalog.v2",
} as const;

function hashCanonical(domain: string, value: JsonValue): S11tDigest {
	return sha256Utf8(`${domain}\0${canonicalJson(value)}`);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function hashDefinitionV2(value: CanonicalContextDefinitionV2): S11tDigest {
	return hashCanonical(HASH_DOMAINS.definition, {
		key: value.key,
		owner: value.owner,
		contentKind: value.contentKind,
		sourceLocale: value.sourceLocale,
		requiredLocales: [...value.requiredLocales],
		variables: value.variables,
		sections: value.sections,
	});
}

export function hashArtifactV2(value: {
	key: string;
	locale: string;
	sections: S11tCompiledSectionV2[];
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.artifact, value);
}

export function hashReleaseV2(value: {
	key: string;
	compilerVersion: string;
	definitionHash: string;
	artifactHashes: Record<string, string>;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.release, {
		key: value.key,
		schemaVersion: 2,
		compilerVersion: value.compilerVersion,
		definitionHash: value.definitionHash,
		artifacts: Object.entries(value.artifactHashes).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		),
	});
}

export function hashPolicyV2(value: {
	releaseProfile: string;
	requiredLocales: Record<string, string[]>;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.policy, {
		releaseProfile: value.releaseProfile,
		requiredLocales: Object.entries(value.requiredLocales).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		),
	});
}

export function hashCatalogV2(value: {
	compilerVersion: string;
	policyDigest: string;
	releaseDigests: Record<string, string>;
	aliases: Record<string, string>;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.catalog, {
		schemaVersion: 2,
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
