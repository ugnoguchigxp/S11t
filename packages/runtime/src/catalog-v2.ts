import { assertCatalogArtifactV2 } from "./artifact-schema.js";
import type {
	CanonicalContextDefinitionV2,
	CanonicalSectionDefinitionV2,
} from "./canonical-definition-v2.js";
import type { CatalogContract, RuntimeValues } from "./catalog.js";
import { S11tError } from "./diagnostics.js";
import { encodeValue } from "./encoding.js";
import {
	hashArtifactV2,
	hashCatalogV2,
	hashDefinitionV2,
	hashPolicyV2,
	hashReleaseV2,
} from "./hash-v2.js";
import { hashRendered } from "./hash.js";
import type {
	JsonValue,
	S11tCatalogArtifactV2,
	S11tCompiledContextV2,
	S11tCompiledSectionV2,
	TemplateSegment,
} from "./types.js";

type DefaultContract = CatalogContract<
	string,
	Record<string, RuntimeValues>,
	Record<string, "text">
>;
type ContractKey<C> = C extends CatalogContract<infer K, infer _V, infer _O> ? K : never;
type ContractValues<C> = C extends CatalogContract<infer _K, infer V, infer _O> ? V : never;

export type CatalogBindingV2 = {
	instructionLocale: string;
	fallbackLocales?: readonly string[];
};

export type TextRenderer<C extends DefaultContract = DefaultContract> = <K extends ContractKey<C>>(
	key: K,
	values: ContractValues<C>[K],
) => string;

export type TextRendererObject<C extends DefaultContract = DefaultContract> = {
	readonly [K in ContractKey<C>]: (values: ContractValues<C>[K]) => string;
};

export type BoundTextCatalog<C extends DefaultContract = DefaultContract> = {
	readonly p: TextRenderer<C>;
	readonly byKey: TextRendererObject<C>;
};

export type CatalogBindingResolverV2 = () => CatalogBindingV2;

export type SystemContextInvocationV2<K extends string = string> = {
	readonly key: K;
	readonly content: {
		readonly kind: "text";
		readonly text: string;
	};
	readonly manifest: {
		readonly requestedKey: string;
		readonly resolvedKey: string;
		readonly aliasUsed: boolean;
		readonly catalogDigest: string;
		readonly releaseDigest: string;
		readonly definitionHash: string;
		readonly artifactHash: string;
		readonly renderedHash: string;
		readonly requestedLocale: string;
		readonly fallbackLocales: readonly string[];
		readonly resolvedLocale: string;
		readonly sourceLocale: string;
		readonly fallbackUsed: boolean;
		readonly sectionIds: readonly string[];
		readonly compilerVersion: string;
		readonly releaseProfile: string;
		readonly policyDigest: string;
	};
};

export type SystemContextDescriptionV2 = {
	readonly key: string;
	readonly owner: string;
	readonly contentKind: "text";
	readonly sourceLocale: string;
	readonly requiredLocales: readonly string[];
	readonly availableLocales: readonly string[];
	readonly variableNames: readonly string[];
	readonly releaseDigest: string;
};

export type CatalogV2<C extends DefaultContract = DefaultContract> = {
	readonly catalogDigest: string;
	readonly releaseProfile: string;
	list(): readonly SystemContextDescriptionV2[];
	describe<K extends ContractKey<C>>(key: K): SystemContextDescriptionV2;
	listAliases(): Readonly<Record<string, string>>;
	bind(binding: CatalogBindingV2): <K extends ContractKey<C>>(
		key: K,
		values: ContractValues<C>[K],
	) => SystemContextInvocationV2<K>;
	bindText(binding: CatalogBindingV2): BoundTextCatalog<C>;
	createTextRenderer(resolveBinding: CatalogBindingResolverV2): TextRenderer<C>;
};

const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

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

function definitionFromCompiled(context: S11tCompiledContextV2): CanonicalContextDefinitionV2 {
	const availableLocales = Object.keys(context.locales).sort(compareCodeUnits);
	const firstLocale = availableLocales[0];
	if (firstLocale === undefined) {
		throw new S11tError("S11T_ARTIFACT_INVALID", "locales cannot be empty", [
			"contexts",
			context.key,
			"locales",
		]);
	}
	const firstSections = context.locales[firstLocale]?.sections;
	if (firstSections === undefined) {
		throw new S11tError("S11T_ARTIFACT_INVALID", "Locale is missing", [
			"contexts",
			context.key,
			"locales",
			firstLocale,
		]);
	}
	const sections: CanonicalSectionDefinitionV2[] = firstSections.map((section, sectionIndex) => {
		const locales: Record<string, string> = {};
		for (const locale of availableLocales) {
			const candidate = context.locales[locale]?.sections[sectionIndex];
			if (
				candidate === undefined ||
				context.locales[locale]?.sections.length !== firstSections.length ||
				candidate.id !== section.id ||
				candidate.kind !== section.kind ||
				candidate.severity !== section.severity ||
				candidate.enforcement !== section.enforcement ||
				candidate.optimizable !== section.optimizable
			) {
				throw new S11tError("S11T_ARTIFACT_INVALID", "Locale section metadata does not match", [
					"contexts",
					context.key,
					"locales",
					locale,
					"sections",
					sectionIndex,
				]);
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
		key: context.key,
		owner: context.owner,
		contentKind: "text",
		sourceLocale: context.sourceLocale,
		requiredLocales: [...context.requiredLocales],
		variables: context.variables,
		sections,
	};
}

export function assertCatalogIntegrityV2(artifact: S11tCatalogArtifactV2): void {
	const releaseDigests: Record<string, string> = {};
	const requiredLocales: Record<string, string[]> = {};
	for (const [key, context] of Object.entries(artifact.contexts)) {
		if (key !== context.key) {
			throw new S11tError("S11T_ARTIFACT_INVALID", "Context map key must match context key", [
				"contexts",
				key,
				"key",
			]);
		}
		const localeKeys = Object.keys(context.locales).sort(compareCodeUnits);
		if (!localeKeys.includes(context.sourceLocale)) {
			throw new S11tError("S11T_ARTIFACT_INVALID", "sourceLocale must be compiled", [
				"contexts",
				key,
				"sourceLocale",
			]);
		}
		if (context.requiredLocales.some((locale) => !localeKeys.includes(locale))) {
			throw new S11tError("S11T_ARTIFACT_INVALID", "Every required locale must be compiled", [
				"contexts",
				key,
				"locales",
			]);
		}
		const artifactHashes: Record<string, string> = {};
		const referencedVariables = new Set<string>();
		const sectionIds = new Set<string>();
		for (const locale of localeKeys) {
			const compiledLocale = context.locales[locale];
			if (compiledLocale === undefined) continue;
			for (const [sectionIndex, section] of compiledLocale.sections.entries()) {
				if (locale === localeKeys[0]) {
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
					if (segment.type === "variable") {
						if (!Object.hasOwn(context.variables, segment.name)) {
							throw new S11tError("S11T_ARTIFACT_INVALID", "Segment references an undeclared variable", [
								"contexts",
								key,
								"locales",
								locale,
								"sections",
								sectionIndex,
								"segments",
								segmentIndex,
							]);
						}
						referencedVariables.add(segment.name);
					}
				}
			}
			const expected = hashArtifactV2({ key, locale, sections: compiledLocale.sections });
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
		const expectedDefinition = hashDefinitionV2(definitionFromCompiled(context));
		if (context.definitionHash !== expectedDefinition) {
			digestMismatch(["contexts", key, "definitionHash"], "Definition");
		}
		const expectedRelease = hashReleaseV2({
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
	for (const [alias, target] of Object.entries(artifact.aliases)) {
		if (
			alias === target ||
			Object.hasOwn(artifact.contexts, alias) ||
			!Object.hasOwn(artifact.contexts, target) ||
			Object.hasOwn(artifact.aliases, target)
		) {
			throw new S11tError("S11T_ARTIFACT_INVALID", "Invalid context alias", ["aliases", alias]);
		}
	}
	const expectedPolicy = hashPolicyV2({ releaseProfile: artifact.releaseProfile, requiredLocales });
	if (artifact.policyDigest !== expectedPolicy) digestMismatch(["policyDigest"], "Policy");
	const expectedCatalog = hashCatalogV2({
		compilerVersion: artifact.compilerVersion,
		policyDigest: expectedPolicy,
		releaseDigests,
		aliases: artifact.aliases,
	});
	if (artifact.catalogDigest !== expectedCatalog) digestMismatch(["catalogDigest"], "Catalog");
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
	section: S11tCompiledSectionV2,
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

function validateBinding(binding: CatalogBindingV2): CatalogBindingV2 {
	if (!LOCALE_PATTERN.test(binding.instructionLocale)) {
		throw new S11tError("S11T_VALUE_INVALID", "instructionLocale is invalid", ["instructionLocale"]);
	}
	const fallbackLocales = [...(binding.fallbackLocales ?? [])];
	if (
		fallbackLocales.some((locale) => !LOCALE_PATTERN.test(locale)) ||
		fallbackLocales.includes(binding.instructionLocale) ||
		new Set(fallbackLocales).size !== fallbackLocales.length
	) {
		throw new S11tError("S11T_VALUE_INVALID", "fallbackLocales must be unique valid locales", [
			"fallbackLocales",
		]);
	}
	return { instructionLocale: binding.instructionLocale, fallbackLocales };
}

function invoke(
	artifact: S11tCatalogArtifactV2,
	requestedKey: string,
	valuesInput: unknown,
	binding: CatalogBindingV2,
): SystemContextInvocationV2 {
	const resolvedKey = Object.hasOwn(artifact.contexts, requestedKey)
		? requestedKey
		: Object.hasOwn(artifact.aliases, requestedKey)
			? artifact.aliases[requestedKey]
			: undefined;
	if (resolvedKey === undefined || !Object.hasOwn(artifact.contexts, resolvedKey)) {
		throw new S11tError("S11T_CONTEXT_NOT_FOUND", `Context not found: ${requestedKey}`, [requestedKey]);
	}
	const context = artifact.contexts[resolvedKey]!;
	const candidates = [binding.instructionLocale, ...(binding.fallbackLocales ?? [])];
	const resolvedLocale = candidates.find((locale) => Object.hasOwn(context.locales, locale));
	if (resolvedLocale === undefined) {
		throw new S11tError("S11T_LOCALE_NOT_FOUND", `Locale not found: ${binding.instructionLocale}`, [
			resolvedKey,
			binding.instructionLocale,
		]);
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
	const locale = context.locales[resolvedLocale]!;
	const text = `${locale.sections.map((section) => renderSection(section, encodedValues)).join("\n")}\n`;
	return deepFreeze({
		key: requestedKey,
		content: { kind: "text", text },
		manifest: {
			requestedKey,
			resolvedKey,
			aliasUsed: requestedKey !== resolvedKey,
			catalogDigest: artifact.catalogDigest,
			releaseDigest: context.releaseDigest,
			definitionHash: context.definitionHash,
			artifactHash: locale.artifactHash,
			renderedHash: hashRendered(text),
			requestedLocale: binding.instructionLocale,
			fallbackLocales: [...(binding.fallbackLocales ?? [])],
			resolvedLocale,
			sourceLocale: context.sourceLocale,
			fallbackUsed: resolvedLocale !== binding.instructionLocale,
			sectionIds: locale.sections.map((section) => section.id),
			compilerVersion: artifact.compilerVersion,
			releaseProfile: artifact.releaseProfile,
			policyDigest: artifact.policyDigest,
		},
	});
}

function bindInvocation<C extends DefaultContract>(
	artifact: S11tCatalogArtifactV2,
	binding: CatalogBindingV2,
): ReturnType<CatalogV2<C>["bind"]> {
	const snapshot = validateBinding(binding);
	return ((key: string, values: RuntimeValues) =>
		invoke(artifact, key, values, snapshot)) as ReturnType<CatalogV2<C>["bind"]>;
}

function textRenderer<C extends DefaultContract>(
	bound: ReturnType<CatalogV2<C>["bind"]>,
): TextRenderer<C> {
	const invokeBound = bound as (
		key: string,
		values: RuntimeValues,
	) => SystemContextInvocationV2;
	return Object.freeze(((key: string, values: RuntimeValues) =>
		invokeBound(key, values).content.text) as TextRenderer<C>);
}

export function createCatalogV2<C extends DefaultContract = DefaultContract>(
	input: unknown,
	options: { expectedCatalogDigest?: string } = {},
): CatalogV2<C> {
	assertCatalogArtifactV2(input);
	assertCatalogIntegrityV2(input);
	if (
		options.expectedCatalogDigest !== undefined &&
		input.catalogDigest !== options.expectedCatalogDigest
	) {
		digestMismatch(["catalogDigest"], "Expected catalog");
	}
	const artifact = deepFreeze(
		cloneJson(input as unknown as JsonValue),
	) as unknown as S11tCatalogArtifactV2;
	const descriptions = deepFreeze(
		Object.values(artifact.contexts)
			.sort((left, right) => compareCodeUnits(left.key, right.key))
			.map((context) =>
				deepFreeze({
					key: context.key,
					owner: context.owner,
					contentKind: context.contentKind,
					sourceLocale: context.sourceLocale,
					requiredLocales: [...context.requiredLocales],
					availableLocales: Object.keys(context.locales).sort(compareCodeUnits),
					variableNames: Object.keys(context.variables).sort(compareCodeUnits),
					releaseDigest: context.releaseDigest,
				}),
			),
	);
	const aliases = deepFreeze({ ...artifact.aliases });
	const textKeys = [...Object.keys(artifact.contexts), ...Object.keys(artifact.aliases)].sort(
		compareCodeUnits,
	);
	const bind = (binding: CatalogBindingV2) => bindInvocation<C>(artifact, binding);
	const bindText = (binding: CatalogBindingV2): BoundTextCatalog<C> => {
		const p = textRenderer<C>(bind(binding));
		const renderers = Object.create(null) as Record<
			string,
			(values: RuntimeValues) => string
		>;
		for (const key of textKeys) {
			const render = Object.freeze((values: RuntimeValues) =>
				(p as (requestedKey: string, input: RuntimeValues) => string)(key, values),
			);
			Object.defineProperty(renderers, key, {
				value: render,
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return Object.freeze({
			p,
			byKey: Object.freeze(renderers) as unknown as TextRendererObject<C>,
		});
	};
	return {
		catalogDigest: artifact.catalogDigest,
		releaseProfile: artifact.releaseProfile,
		list: () => descriptions,
		describe: (key) => {
			const requested = String(key);
			const resolved = Object.hasOwn(artifact.contexts, requested)
				? requested
				: Object.hasOwn(artifact.aliases, requested)
					? artifact.aliases[requested]
					: undefined;
			const result = descriptions.find((description) => description.key === resolved);
			if (result === undefined) {
				throw new S11tError("S11T_CONTEXT_NOT_FOUND", `Context not found: ${requested}`, [requested]);
			}
			return result;
		},
		listAliases: () => aliases,
		bind,
		bindText,
		createTextRenderer: (resolveBinding) =>
			Object.freeze(((key: string, values: RuntimeValues) => {
				const bound = bind(resolveBinding());
				return (bound as (requestedKey: string, input: RuntimeValues) => SystemContextInvocationV2)(
					key,
					values,
				).content.text;
			}) as TextRenderer<C>),
	};
}
