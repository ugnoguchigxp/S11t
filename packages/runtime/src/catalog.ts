import { assertCatalogArtifactV1, isCatalogArtifactV2 } from "./artifact-schema.js";
import { createCatalogV2 } from "./catalog-v2.js";
import type { CanonicalContextDefinition, CanonicalSectionDefinition } from "./canonical-definition.js";
import { S11tError } from "./diagnostics.js";
import { encodeValue } from "./encoding.js";
import {
	hashArtifact,
	hashCatalog,
	hashDefinition,
	hashRelease,
	hashRendered,
} from "./hash.js";
import type {
	JsonValue,
	S11tCatalogArtifactV1,
	S11tCompiledContextV1,
	S11tCompiledSectionV1,
	TemplateSegment,
} from "./types.js";

export type RuntimeValues = Record<string, unknown>;

export type CatalogContract<
	K extends string,
	ValueMap extends Record<K, RuntimeValues>,
	OutputMap extends Record<K, "text">,
> = {
	readonly key: K;
	readonly values: ValueMap;
	readonly outputs: OutputMap;
};

type DefaultContract = CatalogContract<
	string,
	Record<string, RuntimeValues>,
	Record<string, "text">
>;
type ContractKey<C> = C extends CatalogContract<infer K, infer _V, infer _O> ? K : never;
type ContractValues<C> = C extends CatalogContract<infer _K, infer V, infer _O> ? V : never;

export type SystemContextInvocation<K extends string = string> = {
	readonly key: K;
	readonly content: {
		readonly kind: "text";
		readonly text: string;
	};
	readonly manifest: {
		readonly id: string;
		readonly version: string;
		readonly catalogDigest: string;
		readonly releaseDigest: string;
		readonly definitionHash: string;
		readonly artifactHash: string;
		readonly renderedHash: string;
		readonly requestedLocale: string;
		readonly resolvedLocale: string;
		readonly sourceLocale: string;
		readonly fallbackUsed: boolean;
		readonly sectionIds: readonly string[];
		readonly compilerVersion: string;
	};
};

export type SystemContextDescription = {
	readonly id: string;
	readonly version: string;
	readonly owner: string;
	readonly output: "text";
	readonly sourceLocale: string;
	readonly requiredLocales: readonly string[];
	readonly variableNames: readonly string[];
	readonly releaseDigest: string;
};

export type CatalogBinding = {
	instructionLocale: string;
	fallbackLocale?: string;
};

export type Catalog<C extends DefaultContract = DefaultContract> = {
	readonly catalogDigest: string;
	list(): readonly SystemContextDescription[];
	describe<K extends ContractKey<C>>(key: K): SystemContextDescription;
	bind(binding: CatalogBinding): <K extends ContractKey<C>>(
		key: K,
		values: ContractValues<C>[K],
	) => SystemContextInvocation<K>;
};

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function digestMismatch(path: Array<string | number>, label: string): never {
	throw new S11tError("S11T_ARTIFACT_DIGEST_MISMATCH", `${label} digest mismatch`, path);
}

function templateFromSegments(segments: TemplateSegment[]): string {
	return segments
		.map((segment) => (segment.type === "literal" ? segment.value : `[[${segment.name}]]`))
		.join("");
}

function definitionFromCompiled(context: S11tCompiledContextV1): CanonicalContextDefinition {
	const availableLocales = Object.keys(context.locales).sort(compareCodeUnits);
	const firstLocale = availableLocales[0];
	if (firstLocale === undefined) {
		throw new S11tError("S11T_ARTIFACT_INVALID", "requiredLocales cannot be empty", [
			"contexts",
			context.id,
			"requiredLocales",
		]);
	}
	const firstSections = context.locales[firstLocale]?.sections;
	if (firstSections === undefined) {
		throw new S11tError("S11T_ARTIFACT_INVALID", "Required locale is missing", [
			"contexts",
			context.id,
			"locales",
			firstLocale,
		]);
	}
	const sections: CanonicalSectionDefinition[] = firstSections.map((section, sectionIndex) => {
		const locales: Record<string, string> = {};
		for (const locale of availableLocales) {
			const localeSections = context.locales[locale]?.sections;
			if (localeSections?.length !== firstSections.length) {
				throw new S11tError(
					"S11T_ARTIFACT_INVALID",
					"Every locale must contain the same sections",
					["contexts", context.id, "locales", locale, "sections"],
				);
			}
			const candidate = localeSections[sectionIndex];
			if (
				candidate === undefined ||
				candidate.id !== section.id ||
				candidate.kind !== section.kind ||
				candidate.severity !== section.severity ||
				candidate.enforcement !== section.enforcement ||
				candidate.optimizable !== section.optimizable
			) {
				throw new S11tError(
					"S11T_ARTIFACT_INVALID",
					"Locale section metadata does not match",
					["contexts", context.id, "locales", locale, "sections", sectionIndex],
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
	});
	return {
		id: context.id,
		version: context.version,
		owner: context.owner,
		output: context.output,
		sourceLocale: context.sourceLocale,
		requiredLocales: [...context.requiredLocales],
		variables: context.variables,
		sections,
	};
}

function verifyDigests(artifact: S11tCatalogArtifactV1): void {
	const releaseDigests: Record<string, string> = {};
	for (const [key, context] of Object.entries(artifact.contexts)) {
		if (key !== context.id) {
			throw new S11tError("S11T_ARTIFACT_INVALID", "Context map key must match context ID", [
				"contexts",
				key,
				"id",
			]);
		}
		if (!context.requiredLocales.includes(context.sourceLocale)) {
			throw new S11tError("S11T_ARTIFACT_INVALID", "sourceLocale must be required", [
				"contexts",
				key,
				"sourceLocale",
			]);
		}
		const localeKeys = Object.keys(context.locales).sort(compareCodeUnits);
		const requiredLocales = [...context.requiredLocales].sort(compareCodeUnits);
		if (
			new Set(requiredLocales).size !== requiredLocales.length ||
			requiredLocales.some((locale) => !localeKeys.includes(locale))
		) {
			throw new S11tError("S11T_ARTIFACT_INVALID", "Every required locale must be compiled", [
				"contexts",
				key,
				"locales",
			]);
		}
		if (!Object.hasOwn(context.locales, artifact.defaultLocale)) {
			throw new S11tError("S11T_ARTIFACT_INVALID", "defaultLocale must be compiled", [
				"contexts",
				key,
				"locales",
				artifact.defaultLocale,
			]);
		}
		const artifactHashes: Record<string, string> = {};
		const referencedVariables = new Set<string>();
		const sectionIds = new Set<string>();
		for (const locale of localeKeys) {
			const compiledLocale = context.locales[locale];
			if (compiledLocale === undefined) continue;
			for (const [sectionIndex, section] of compiledLocale.sections.entries()) {
				if (locale === requiredLocales[0]) {
					if (sectionIds.has(section.id)) {
						throw new S11tError("S11T_ARTIFACT_INVALID", "Section IDs must be unique", [
							"contexts",
							key,
							"locales",
							locale,
							"sections",
							sectionIndex,
							"id",
						]);
					}
					sectionIds.add(section.id);
				}
				for (const [segmentIndex, segment] of section.segments.entries()) {
					if (segment.type === "variable" && !Object.hasOwn(context.variables, segment.name)) {
						throw new S11tError(
							"S11T_ARTIFACT_INVALID",
							"Segment references an undeclared variable",
							["contexts", key, "locales", locale, "sections", sectionIndex, "segments", segmentIndex],
						);
					}
					if (segment.type === "variable") referencedVariables.add(segment.name);
				}
			}
			const expected = hashArtifact({ id: context.id, locale, sections: compiledLocale.sections });
			if (compiledLocale.artifactHash !== expected) {
				digestMismatch(["contexts", key, "locales", locale, "artifactHash"], "Artifact");
			}
			artifactHashes[locale] = expected;
		}
		for (const variableName of Object.keys(context.variables)) {
			if (!referencedVariables.has(variableName)) {
				throw new S11tError("S11T_ARTIFACT_INVALID", "Every variable must be referenced", [
					"contexts",
					key,
					"variables",
					variableName,
				]);
			}
		}
		const expectedDefinition = hashDefinition(definitionFromCompiled(context));
		if (context.definitionHash !== expectedDefinition) {
			digestMismatch(["contexts", key, "definitionHash"], "Definition");
		}
		const expectedRelease = hashRelease({
			id: context.id,
			version: context.version,
			schemaVersion: 1,
			compilerVersion: artifact.compilerVersion,
			definitionHash: expectedDefinition,
			artifactHashes,
		});
		if (context.releaseDigest !== expectedRelease) {
			digestMismatch(["contexts", key, "releaseDigest"], "Release");
		}
		releaseDigests[key] = expectedRelease;
	}
	const expectedCatalog = hashCatalog({
		schemaVersion: 1,
		compilerVersion: artifact.compilerVersion,
		defaultLocale: artifact.defaultLocale,
		releaseDigests,
	});
	if (artifact.catalogDigest !== expectedCatalog) {
		digestMismatch(["catalogDigest"], "Catalog");
	}
}

function cloneJson<T extends JsonValue>(value: T): T {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, cloneJson(item)]),
	) as T;
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) deepFreeze(item);
	}
	return value;
}

function valuesRecord(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new S11tError("S11T_VALUE_INVALID", "Values must be an object", []);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new S11tError("S11T_VALUE_INVALID", "Values must be a plain object", []);
	}
	return value as Record<string, unknown>;
}

function renderSection(
	section: S11tCompiledSectionV1,
	encodedValues: Record<string, string>,
): string {
	return section.segments
		.map((segment) => {
			if (segment.type === "literal") return segment.value;
			if (!Object.hasOwn(encodedValues, segment.name)) {
				throw new S11tError("S11T_ARTIFACT_INVALID", "Variable segment is undeclared", [segment.name]);
			}
			return encodedValues[segment.name]!;
		})
		.join("");
}

function invoke(
	artifact: S11tCatalogArtifactV1,
	key: string,
	valuesInput: unknown,
	binding: CatalogBinding,
): SystemContextInvocation {
	if (!Object.hasOwn(artifact.contexts, key)) {
		throw new S11tError("S11T_CONTEXT_NOT_FOUND", `Context not found: ${key}`, [key]);
	}
	const context = artifact.contexts[key]!;
	const requestedLocale = binding.instructionLocale;
	let resolvedLocale = requestedLocale;
	let fallbackUsed = false;
	if (!Object.hasOwn(context.locales, resolvedLocale)) {
		if (
			binding.fallbackLocale === undefined ||
			!Object.hasOwn(context.locales, binding.fallbackLocale)
		) {
			throw new S11tError("S11T_LOCALE_NOT_FOUND", `Locale not found: ${requestedLocale}`, [
				key,
				requestedLocale,
			]);
		}
		resolvedLocale = binding.fallbackLocale;
		fallbackUsed = true;
	}
	const values = valuesRecord(valuesInput);
	for (const name of Object.keys(context.variables)) {
		if (!Object.hasOwn(values, name)) {
			throw new S11tError("S11T_VALUE_MISSING", `Missing value: ${name}`, [name]);
		}
	}
	for (const name of Object.keys(values)) {
		if (!Object.hasOwn(context.variables, name)) {
			throw new S11tError("S11T_VALUE_EXTRA", `Unexpected value: ${name}`, [name]);
		}
	}
	const encodedValues: Record<string, string> = {};
	for (const [name, definition] of Object.entries(context.variables)) {
		encodedValues[name] = encodeValue(values[name], definition, [name]);
	}
	const locale = context.locales[resolvedLocale];
	if (locale === undefined) {
		throw new S11tError("S11T_LOCALE_NOT_FOUND", `Locale not found: ${resolvedLocale}`, [key]);
	}
	const text = `${locale.sections
		.map((section) => renderSection(section, encodedValues))
		.join("\n")}\n`;
	return deepFreeze({
		key,
		content: { kind: "text", text },
		manifest: {
			id: context.id,
			version: context.version,
			catalogDigest: artifact.catalogDigest,
			releaseDigest: context.releaseDigest,
			definitionHash: context.definitionHash,
			artifactHash: locale.artifactHash,
			renderedHash: hashRendered(text),
			requestedLocale,
			resolvedLocale,
			sourceLocale: context.sourceLocale,
			fallbackUsed,
			sectionIds: locale.sections.map((section) => section.id),
			compilerVersion: artifact.compilerVersion,
		},
	});
}

export function assertCatalogIntegrityV1(artifact: S11tCatalogArtifactV1): void {
	verifyDigests(artifact);
}

export function createCatalog<C extends DefaultContract = DefaultContract>(
	input: unknown,
	options: { expectedCatalogDigest?: string } = {},
): Catalog<C> {
	if (isCatalogArtifactV2(input)) {
		return createCatalogV2<C>(input, options) as unknown as Catalog<C>;
	}
	assertCatalogArtifactV1(input);
	assertCatalogIntegrityV1(input);
	if (
		options.expectedCatalogDigest !== undefined &&
		input.catalogDigest !== options.expectedCatalogDigest
	) {
		digestMismatch(["catalogDigest"], "Expected catalog");
	}
	const artifact = deepFreeze(cloneJson(input as unknown as JsonValue)) as unknown as S11tCatalogArtifactV1;
	const descriptions = deepFreeze(
		Object.values(artifact.contexts)
			.sort((left, right) => compareCodeUnits(left.id, right.id))
			.map((context) =>
			deepFreeze({
				id: context.id,
				version: context.version,
				owner: context.owner,
				output: context.output,
				sourceLocale: context.sourceLocale,
				requiredLocales: [...context.requiredLocales],
				variableNames: Object.keys(context.variables).sort(compareCodeUnits),
				releaseDigest: context.releaseDigest,
			}),
			),
	);
	return {
		catalogDigest: artifact.catalogDigest,
		list: () => descriptions,
		describe: (key) => {
			const result = descriptions.find((description) => description.id === key);
			if (result === undefined) {
				throw new S11tError("S11T_CONTEXT_NOT_FOUND", `Context not found: ${String(key)}`, [
					String(key),
				]);
			}
			return result;
		},
		bind: (binding) => {
			const snapshot: CatalogBinding = {
				instructionLocale: binding.instructionLocale,
				...(binding.fallbackLocale === undefined
					? {}
					: { fallbackLocale: binding.fallbackLocale }),
			};
			return ((key: string, values: RuntimeValues) =>
				invoke(artifact, key, values, snapshot)) as ReturnType<Catalog<C>["bind"]>;
		},
	};
}
