import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalJson } from "./canonical-json.js";
import type { CanonicalContextDefinition } from "./canonical-definition.js";
import type { JsonValue, S11tCompiledSectionV1 } from "./types.js";

const HASH_DOMAINS = {
	definition: "s11t.definition.v1",
	artifact: "s11t.artifact.v1",
	release: "s11t.release.v1",
	catalog: "s11t.catalog.v1",
	rendered: "s11t.rendered.v1",
} as const;

export type S11tDigest = `sha256:${string}`;

export type LocaleTemplateIdentityInput = {
	id: string;
	locale: string;
	sections: S11tCompiledSectionV1[];
};

export type ReleaseIdentityInput = {
	id: string;
	version: string;
	schemaVersion: 1;
	compilerVersion: string;
	definitionHash: string;
	artifactHashes: Record<string, string>;
};

export type CatalogIdentityInput = {
	schemaVersion: 1;
	compilerVersion: string;
	defaultLocale: string;
	releaseDigests: Record<string, string>;
};

export function sha256Utf8(value: string): S11tDigest {
	return `sha256:${bytesToHex(sha256(utf8ToBytes(value)))}`;
}

function hashCanonical(domain: string, value: JsonValue): S11tDigest {
	return sha256Utf8(`${domain}\0${canonicalJson(value)}`);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function hashDefinition(value: CanonicalContextDefinition): S11tDigest {
	const identity: JsonValue = {
		id: value.id,
		version: value.version,
		owner: value.owner,
		output: value.output,
		sourceLocale: value.sourceLocale,
		requiredLocales: [...value.requiredLocales],
		variables: value.variables,
		sections: value.sections,
	};
	return hashCanonical(HASH_DOMAINS.definition, identity);
}

export function hashArtifact(value: LocaleTemplateIdentityInput): S11tDigest {
	return hashCanonical(HASH_DOMAINS.artifact, {
		id: value.id,
		locale: value.locale,
		sections: value.sections,
	});
}

export function hashRelease(value: ReleaseIdentityInput): S11tDigest {
	return hashCanonical(HASH_DOMAINS.release, {
		id: value.id,
		version: value.version,
		schemaVersion: value.schemaVersion,
		compilerVersion: value.compilerVersion,
		definitionHash: value.definitionHash,
		artifacts: Object.entries(value.artifactHashes).sort(([left], [right]) => compareCodeUnits(left, right)),
	});
}

export function hashCatalog(value: CatalogIdentityInput): S11tDigest {
	return hashCanonical(HASH_DOMAINS.catalog, {
		schemaVersion: value.schemaVersion,
		compilerVersion: value.compilerVersion,
		defaultLocale: value.defaultLocale,
		releases: Object.entries(value.releaseDigests).sort(([left], [right]) => compareCodeUnits(left, right)),
	});
}

export function hashRendered(text: string): S11tDigest {
	return sha256Utf8(`${HASH_DOMAINS.rendered}\0${text}`);
}
