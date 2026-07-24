import {
	compareCodeUnits,
	digestMismatch,
	templateFromSegments,
} from "./catalog-shared.js";
import type {
	CanonicalContextDefinition,
	CanonicalSectionDefinition,
} from "./canonical-definition.js";
import { S11tError } from "./diagnostics.js";
import {
	hashArtifact,
	hashCatalog,
	hashDefinition,
	hashPolicy,
	hashRelease,
} from "./hash.js";
import type { S11tCatalogArtifact, S11tCompiledContext } from "./types.js";

function definitionFromCompiled(
	context: S11tCompiledContext,
): CanonicalContextDefinition {
	const availableLocales = Object.keys(context.locales).sort(compareCodeUnits);
	if (availableLocales.length === 0) {
		throw new S11tError("S11T_ARTIFACT_INVALID", "locales cannot be empty", [
			"contexts",
			context.key,
			"locales",
		]);
	}
	const sourceSections = context.locales[context.sourceLocale]?.sections;
	if (sourceSections === undefined) {
		throw new S11tError("S11T_ARTIFACT_INVALID", "Locale is missing", [
			"contexts",
			context.key,
			"locales",
			context.sourceLocale,
		]);
	}
	const sections: CanonicalSectionDefinition[] = sourceSections.map(
		(section, sectionIndex) => {
			const locales: Record<string, string> = {};
			for (const locale of availableLocales) {
				const candidate = context.locales[locale]?.sections[sectionIndex];
				if (
					candidate === undefined ||
					context.locales[locale]?.sections.length !== sourceSections.length ||
					candidate.id !== section.id ||
					candidate.kind !== section.kind ||
					candidate.severity !== section.severity ||
					candidate.enforcement !== section.enforcement ||
					candidate.optimizable !== section.optimizable
				) {
					throw new S11tError(
						"S11T_ARTIFACT_INVALID",
						"Locale section metadata does not match",
						["contexts", context.key, "locales", locale, "sections", sectionIndex],
					);
				}
				locales[locale] = templateFromSegments(candidate.segments);
			}
			return {
				id: section.id,
				kind: section.kind,
				severity: section.severity,
				enforcement: section.enforcement,
				optimizable: section.optimizable,
				locales,
			};
		},
	);
	return {
		key: context.key,
		owner: context.owner,
		contentKind: "text",
		sourceLocale: context.sourceLocale,
		requiredLocales: [...context.requiredLocales],
		variables: context.variables,
		sections,
	};
}

function variableNames(
	segments: S11tCompiledContext["locales"][string]["sections"][number]["segments"],
): Set<string> {
	return new Set(
		segments.flatMap((segment) =>
			segment.type === "variable" ? [segment.name] : [],
		),
	);
}

function sameNames(left: Set<string>, right: Set<string>): boolean {
	return (
		[...left].every((name) => right.has(name)) &&
		[...right].every((name) => left.has(name))
	);
}

export function assertCatalogIntegrity(artifact: S11tCatalogArtifact): void {
	const releaseDigests: Record<string, string> = {};
	const requiredLocales: Record<string, string[]> = {};
	for (const [key, context] of Object.entries(artifact.contexts)) {
		if (key !== context.key) {
			throw new S11tError(
				"S11T_ARTIFACT_INVALID",
				"Context map key must match context key",
				["contexts", key, "key"],
			);
		}
		const localeKeys = Object.keys(context.locales).sort(compareCodeUnits);
		if (!localeKeys.includes(context.sourceLocale)) {
			throw new S11tError(
				"S11T_ARTIFACT_INVALID",
				"sourceLocale must be compiled",
				["contexts", key, "sourceLocale"],
			);
		}
		if (context.requiredLocales.some((locale) => !localeKeys.includes(locale))) {
			throw new S11tError(
				"S11T_ARTIFACT_INVALID",
				"Every required locale must be compiled",
				["contexts", key, "locales"],
			);
		}
		const artifactHashes: Record<string, string> = {};
		const referencedVariables = new Set<string>();
		const sectionIds = new Set<string>();
		const sourceSections = context.locales[context.sourceLocale]!.sections;
		for (const locale of localeKeys) {
			const compiledLocale = context.locales[locale];
			if (compiledLocale === undefined) continue;
			for (const [sectionIndex, section] of compiledLocale.sections.entries()) {
				if (locale === context.sourceLocale) {
					if (sectionIds.has(section.id)) {
						throw new S11tError(
							"S11T_ARTIFACT_INVALID",
							"Section IDs must be unique",
							[
								"contexts",
								key,
								"locales",
								locale,
								"sections",
								sectionIndex,
								"id",
							],
						);
					}
					sectionIds.add(section.id);
				}
				for (const [segmentIndex, segment] of section.segments.entries()) {
					if (segment.type === "variable") {
						if (!Object.hasOwn(context.variables, segment.name)) {
							throw new S11tError(
								"S11T_ARTIFACT_INVALID",
								"Segment references an undeclared variable",
								[
									"contexts",
									key,
									"locales",
									locale,
									"sections",
									sectionIndex,
									"segments",
									segmentIndex,
								],
							);
						}
						referencedVariables.add(segment.name);
					}
				}
				const sourceSection = sourceSections[sectionIndex];
				if (
					sourceSection !== undefined &&
					!sameNames(
						variableNames(sourceSection.segments),
						variableNames(section.segments),
					)
				) {
					throw new S11tError(
						"S11T_ARTIFACT_INVALID",
						"Translation placeholders must match the source locale",
						[
							"contexts",
							key,
							"locales",
							locale,
							"sections",
							sectionIndex,
							"segments",
						],
					);
				}
			}
			const expected = hashArtifact({
				key,
				locale,
				sections: compiledLocale.sections,
			});
			if (compiledLocale.artifactHash !== expected) {
				digestMismatch(
					["contexts", key, "locales", locale, "artifactHash"],
					"Artifact",
				);
			}
			artifactHashes[locale] = expected;
		}
		for (const variableName of Object.keys(context.variables)) {
			if (!referencedVariables.has(variableName)) {
				throw new S11tError(
					"S11T_ARTIFACT_INVALID",
					"Every variable must be referenced",
					["contexts", key, "variables", variableName],
				);
			}
		}
		const expectedDefinition = hashDefinition(definitionFromCompiled(context));
		if (context.definitionHash !== expectedDefinition) {
			digestMismatch(["contexts", key, "definitionHash"], "Definition");
		}
		const expectedRelease = hashRelease({
			key,
			compilerVersion: artifact.compilerVersion,
			definitionHash: expectedDefinition,
			artifactHashes,
		});
		if (context.releaseDigest !== expectedRelease) {
			digestMismatch(["contexts", key, "releaseDigest"], "Release");
		}
		releaseDigests[key] = expectedRelease;
		requiredLocales[key] = [...context.requiredLocales];
	}
	const expectedPolicy = hashPolicy({
		releaseProfile: artifact.releaseProfile,
		requiredLocales,
	});
	if (artifact.policyDigest !== expectedPolicy) {
		digestMismatch(["policyDigest"], "Policy");
	}
	const expectedCatalog = hashCatalog({
		compilerVersion: artifact.compilerVersion,
		policyDigest: expectedPolicy,
		releaseDigests,
	});
	if (artifact.catalogDigest !== expectedCatalog) {
		digestMismatch(["catalogDigest"], "Catalog");
	}
}
