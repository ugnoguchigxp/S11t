import type {
	CanonicalContextDefinitionV2,
	CanonicalSectionDefinitionV2,
} from "./canonical-definition-v2.js";
import { normalizeNewlines } from "./canonical-definition.js";
import {
	hashArtifactV2,
	hashCatalogV2,
	hashDefinitionV2,
	hashPolicyV2,
	hashReleaseV2,
} from "./hash-v2.js";
import type {
	S11tCatalogArtifactV2,
	S11tCompiledContextV2,
	S11tCompiledSectionV2,
	TemplateSegment,
} from "./types.js";
import { COMPILER_VERSION } from "./version.js";
import { assertCatalogArtifactV2 } from "./artifact-schema.js";
import { assertCatalogIntegrityV2 } from "./catalog-v2.js";

export type {
	CanonicalContextDefinitionV2,
	CanonicalSectionDefinitionV2,
	CanonicalVariableDefinitionV2,
} from "./canonical-definition-v2.js";

export type CompileCatalogV2Options = {
	releaseProfile: string;
	aliases?: Record<string, string>;
	provenance: {
		configPath: string;
		sourceFiles: string[];
	};
};

const PLACEHOLDER_PATTERN = /\[\[([A-Za-z][A-Za-z0-9_]*)\]\]/g;

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSectionText(text: string): string {
	return normalizeNewlines(text).replace(/\n+$/g, "");
}

function tokenizeTemplate(text: string): TemplateSegment[] {
	const segments: TemplateSegment[] = [];
	let offset = 0;
	for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
		const index = match.index;
		const name = match[1];
		if (index === undefined || name === undefined) continue;
		if (index > offset) segments.push({ type: "literal", value: text.slice(offset, index) });
		segments.push({ type: "variable", name });
		offset = index + match[0].length;
	}
	if (offset < text.length) segments.push({ type: "literal", value: text.slice(offset) });
	return segments;
}

function normalizedDefinition(
	definition: CanonicalContextDefinitionV2,
): CanonicalContextDefinitionV2 {
	return {
		key: definition.key,
		owner: definition.owner,
		contentKind: "text",
		sourceLocale: definition.sourceLocale,
		requiredLocales: [...definition.requiredLocales],
		variables: Object.fromEntries(
			Object.entries(definition.variables)
				.sort(([left], [right]) => compareCodeUnits(left, right))
				.map(([name, variable]) => [
					name,
					{
						required: true as const,
						type: variable.type,
						trust: variable.trust,
						placement: variable.placement,
						encoding: variable.encoding,
					},
				]),
		),
		sections: definition.sections.map((section) => ({
			id: section.id,
			kind: section.kind,
			severity: section.severity,
			enforcement: section.enforcement,
			optimizable: section.optimizable,
			locales: Object.fromEntries(
				Object.entries(section.locales)
					.sort(([left], [right]) => compareCodeUnits(left, right))
					.map(([locale, text]) => [locale, normalizeSectionText(text)]),
			),
		})),
	};
}

function compileSections(
	sections: CanonicalSectionDefinitionV2[],
	locale: string,
): S11tCompiledSectionV2[] {
	return sections.map((section) => {
		const text = section.locales[locale];
		if (text === undefined) throw new TypeError(`Missing locale ${locale} in section ${section.id}`);
		return {
			id: section.id,
			kind: section.kind,
			severity: section.severity,
			enforcement: section.enforcement,
			optimizable: section.optimizable,
			segments: tokenizeTemplate(text),
		};
	});
}

function compileContext(definitionInput: CanonicalContextDefinitionV2): S11tCompiledContextV2 {
	const definition = normalizedDefinition(definitionInput);
	const definitionHash = hashDefinitionV2(definition);
	const artifactHashes: Record<string, string> = {};
	const availableLocales = [
		...new Set(definition.sections.flatMap((section) => Object.keys(section.locales))),
	].sort(compareCodeUnits);
	const locales = Object.fromEntries(
		availableLocales.map((locale) => {
			const sections = compileSections(definition.sections, locale);
			const artifactHash = hashArtifactV2({ key: definition.key, locale, sections });
			artifactHashes[locale] = artifactHash;
			return [locale, { sections, artifactHash }];
		}),
	);
	const releaseDigest = hashReleaseV2({
		key: definition.key,
		compilerVersion: COMPILER_VERSION,
		definitionHash,
		artifactHashes,
	});
	return {
		key: definition.key,
		owner: definition.owner,
		contentKind: "text",
		sourceLocale: definition.sourceLocale,
		requiredLocales: [...definition.requiredLocales],
		variables: definition.variables,
		locales,
		definitionHash,
		releaseDigest,
	};
}

function validateAliases(
	aliases: Record<string, string>,
	contexts: Record<string, S11tCompiledContextV2>,
): void {
	for (const [alias, target] of Object.entries(aliases)) {
		if (alias === target || Object.hasOwn(contexts, alias) || !Object.hasOwn(contexts, target)) {
			throw new TypeError(`Invalid context alias: ${alias} -> ${target}`);
		}
		if (Object.hasOwn(aliases, target)) {
			throw new TypeError(`Context alias chains are not supported: ${alias} -> ${target}`);
		}
	}
}

export function compileCatalogV2(
	canonicalDefinitions: readonly CanonicalContextDefinitionV2[],
	options: CompileCatalogV2Options,
): S11tCatalogArtifactV2 {
	const definitions = [...canonicalDefinitions].sort((left, right) =>
		compareCodeUnits(left.key, right.key),
	);
	const contexts: Record<string, S11tCompiledContextV2> = {};
	const releaseDigests: Record<string, string> = {};
	const requiredLocales: Record<string, string[]> = {};
	for (const definition of definitions) {
		if (Object.hasOwn(contexts, definition.key)) {
			throw new TypeError(`Duplicate context key: ${definition.key}`);
		}
		const context = compileContext(definition);
		contexts[definition.key] = context;
		releaseDigests[definition.key] = context.releaseDigest;
		requiredLocales[definition.key] = [...context.requiredLocales];
	}
	const aliases = Object.fromEntries(
		Object.entries(options.aliases ?? {}).sort(([left], [right]) => compareCodeUnits(left, right)),
	);
	validateAliases(aliases, contexts);
	const policyDigest = hashPolicyV2({ releaseProfile: options.releaseProfile, requiredLocales });
	const artifact: S11tCatalogArtifactV2 = {
		format: "s11t.catalog",
		schemaVersion: 2,
		compilerVersion: COMPILER_VERSION,
		releaseProfile: options.releaseProfile,
		policyDigest,
		createdFrom: {
			configPath: options.provenance.configPath,
			sourceFiles: [...options.provenance.sourceFiles].sort(compareCodeUnits),
		},
		contexts,
		aliases,
		catalogDigest: hashCatalogV2({
			compilerVersion: COMPILER_VERSION,
			policyDigest,
			releaseDigests,
			aliases,
		}),
	};
	assertCatalogArtifactV2(artifact);
	assertCatalogIntegrityV2(artifact);
	return artifact;
}
