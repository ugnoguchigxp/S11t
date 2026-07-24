import { assertCatalogArtifact } from "./artifact-schema.js";
import { assertCatalogIntegrity } from "./artifact-integrity.js";
import type {
	CanonicalContextDefinition,
	CanonicalSectionDefinition,
} from "./canonical-definition.js";
import { normalizeNewlines } from "./canonical-definition.js";
import {
	hashArtifact,
	hashCatalog,
	hashDefinition,
	hashPolicy,
	hashRelease,
} from "./hash.js";
import type {
	S11tCatalogArtifact,
	S11tCompiledContext,
	S11tCompiledSection,
	TemplateSegment,
} from "./types.js";
import { COMPILER_VERSION } from "./version.js";

export type {
	CanonicalContextDefinition,
	CanonicalSectionDefinition,
	CanonicalVariableDefinition,
} from "./canonical-definition.js";

export { COMPILER_VERSION } from "./version.js";

export type CompileCatalogOptions = {
	releaseProfile: string;
	provenance: {
		configPath: string;
		sourceFiles: string[];
	};
};

const PLACEHOLDER_PATTERN = /\[\[([A-Za-z][A-Za-z0-9_]*)\]\]/g;

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeSectionText(text: string): string {
	return normalizeNewlines(text).replace(/\n+$/g, "");
}

export function tokenizeTemplate(text: string): TemplateSegment[] {
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
	definition: CanonicalContextDefinition,
): CanonicalContextDefinition {
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
	sections: CanonicalSectionDefinition[],
	locale: string,
): S11tCompiledSection[] {
	return sections.map((section) => {
		const text = section.locales[locale];
		if (text === undefined) {
			throw new TypeError(`Missing locale ${locale} in section ${section.id}`);
		}
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

function compileContext(definitionInput: CanonicalContextDefinition): S11tCompiledContext {
	const definition = normalizedDefinition(definitionInput);
	const definitionHash = hashDefinition(definition);
	const artifactHashes: Record<string, string> = {};
	const availableLocales = [
		...new Set(definition.sections.flatMap((section) => Object.keys(section.locales))),
	].sort(compareCodeUnits);
	const locales = Object.fromEntries(
		availableLocales.map((locale) => {
			const sections = compileSections(definition.sections, locale);
			const artifactHash = hashArtifact({
				key: definition.key,
				locale,
				sections,
			});
			artifactHashes[locale] = artifactHash;
			return [locale, { sections, artifactHash }];
		}),
	);
	const releaseDigest = hashRelease({
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

export function compileCatalog(
	canonicalDefinitions: readonly CanonicalContextDefinition[],
	options: CompileCatalogOptions,
): S11tCatalogArtifact {
	const definitions = [...canonicalDefinitions].sort((left, right) =>
		compareCodeUnits(left.key, right.key),
	);
	const contexts: Record<string, S11tCompiledContext> = {};
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
	const policyDigest = hashPolicy({
		releaseProfile: options.releaseProfile,
		requiredLocales,
	});
	const artifact: S11tCatalogArtifact = {
		format: "s11t.catalog",
		compilerVersion: COMPILER_VERSION,
		releaseProfile: options.releaseProfile,
		policyDigest,
		createdFrom: {
			configPath: options.provenance.configPath,
			sourceFiles: [...options.provenance.sourceFiles].sort(compareCodeUnits),
		},
		contexts,
		catalogDigest: hashCatalog({
			compilerVersion: COMPILER_VERSION,
			policyDigest,
			releaseDigests,
		}),
	};
	assertCatalogArtifact(artifact);
	assertCatalogIntegrity(artifact);
	return artifact;
}
