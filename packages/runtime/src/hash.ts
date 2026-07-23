import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import type { CanonicalContextDefinition } from "./canonical-definition.js";
import { canonicalJson } from "./canonical-json.js";
import type {
	JsonValue,
	S11tCompiledSection,
	S11tRenderingContract,
} from "./types.js";

const HASH_DOMAINS = {
	definition: "s11t.definition",
	artifact: "s11t.artifact",
	release: "s11t.release",
	policy: "s11t.policy",
	catalog: "s11t.catalog",
	rendered: "s11t.rendered",
} as const;

export type S11tDigest = `sha256:${string}`;

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function sha256Utf8(value: string): S11tDigest {
	return `sha256:${bytesToHex(sha256(utf8ToBytes(value)))}`;
}

function hashCanonical(domain: string, value: JsonValue): S11tDigest {
	return sha256Utf8(`${domain}\0${canonicalJson(value)}`);
}

export function hashDefinition(
	value: CanonicalContextDefinition,
	renderingContract: S11tRenderingContract,
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

export function hashArtifact(value: {
	key: string;
	locale: string;
	sections: S11tCompiledSection[];
	renderingContract: S11tRenderingContract;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.artifact, value);
}

export function hashRelease(value: {
	key: string;
	compilerVersion: string;
	definitionHash: string;
	artifactHashes: Record<string, string>;
	renderingContract: S11tRenderingContract;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.release, {
		key: value.key,
		schemaVersion: 1,
		renderingContract: value.renderingContract,
		compilerVersion: value.compilerVersion,
		definitionHash: value.definitionHash,
		artifacts: Object.entries(value.artifactHashes).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		),
	});
}

export function hashPolicy(value: {
	releaseProfile: string;
	requiredLocales: Record<string, string[]>;
	renderingContract: S11tRenderingContract;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.policy, {
		renderingContract: value.renderingContract,
		releaseProfile: value.releaseProfile,
		requiredLocales: Object.entries(value.requiredLocales).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		),
	});
}

export function hashCatalog(value: {
	compilerVersion: string;
	policyDigest: string;
	releaseDigests: Record<string, string>;
	aliases: Record<string, string>;
	renderingContract: S11tRenderingContract;
}): S11tDigest {
	return hashCanonical(HASH_DOMAINS.catalog, {
		schemaVersion: 1,
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

export function hashRendered(text: string): S11tDigest {
	return sha256Utf8(`${HASH_DOMAINS.rendered}\0${text}`);
}

export function verifyRenderedHash(text: string, digest: string): boolean {
	return hashRendered(text) === digest;
}
