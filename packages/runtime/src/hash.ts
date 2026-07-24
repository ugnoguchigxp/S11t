import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import type { CanonicalContextDefinition } from "./canonical-definition.js";
import { canonicalJson } from "./canonical-json.js";
import type {
	JsonValue,
	PromptMessageRole,
	S11tnextCompiledSection,
} from "./types.js";

const HASH_DOMAINS = {
	definition: "s11tnext.definition",
	artifact: "s11tnext.artifact",
	release: "s11tnext.release",
	policy: "s11tnext.policy",
	catalog: "s11tnext.catalog",
	rendered: "s11tnext.rendered",
	promptMessage: "s11tnext.prompt-message",
} as const;

export type S11tnextDigest = `sha256:${string}`;

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function sha256Utf8(value: string): S11tnextDigest {
	return `sha256:${bytesToHex(sha256(utf8ToBytes(value)))}`;
}

function hashCanonical(domain: string, value: JsonValue): S11tnextDigest {
	return sha256Utf8(`${domain}\0${canonicalJson(value)}`);
}

export function hashDefinition(
	value: CanonicalContextDefinition,
): S11tnextDigest {
	return hashCanonical(HASH_DOMAINS.definition, {
		key: value.key,
		owner: value.owner,
		contentKind: value.contentKind,
		messageRole: value.messageRole,
		sourceLocale: value.sourceLocale,
		requiredLocales: [...value.requiredLocales],
		variables: value.variables,
		sections: value.sections,
	});
}

export function hashArtifact(value: {
	key: string;
	locale: string;
	sections: S11tnextCompiledSection[];
}): S11tnextDigest {
	return hashCanonical(HASH_DOMAINS.artifact, value);
}

export function hashRelease(value: {
	key: string;
	compilerVersion: string;
	definitionHash: string;
	artifactHashes: Record<string, string>;
}): S11tnextDigest {
	return hashCanonical(HASH_DOMAINS.release, {
		key: value.key,
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
}): S11tnextDigest {
	return hashCanonical(HASH_DOMAINS.policy, {
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
}): S11tnextDigest {
	return hashCanonical(HASH_DOMAINS.catalog, {
		compilerVersion: value.compilerVersion,
		policyDigest: value.policyDigest,
		releases: Object.entries(value.releaseDigests).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		),
	});
}

export function hashRendered(text: string): S11tnextDigest {
	return sha256Utf8(`${HASH_DOMAINS.rendered}\0${text}`);
}

export function verifyRenderedHash(text: string, digest: string): boolean {
	return hashRendered(text) === digest;
}

export function hashPromptMessage(value: {
	role: PromptMessageRole;
	text: string;
}): S11tnextDigest {
	return hashCanonical(HASH_DOMAINS.promptMessage, value);
}

export function verifyPromptMessageHash(
	value: { role: PromptMessageRole; text: string },
	digest: string,
): boolean {
	return hashPromptMessage(value) === digest;
}
