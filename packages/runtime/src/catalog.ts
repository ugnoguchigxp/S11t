import { assertCatalogArtifact } from "./artifact-schema.js";
import {
	cloneJson,
	compareCodeUnits,
	deepFreeze,
	digestMismatch,
	renderSection,
	templateFromSegments,
	valuesRecord,
} from "./catalog-shared.js";
import type {
	CanonicalContextDefinition,
	CanonicalSectionDefinition,
} from "./canonical-definition.js";
import { S11tError } from "./diagnostics.js";
import { encodeValue } from "./encoding.js";
import {
	hashArtifact,
	hashCatalog,
	hashDefinition,
	hashPolicy,
	hashRelease,
	hashRendered,
} from "./hash.js";
import type { JsonValue, S11tCatalogArtifact, S11tCompiledContext } from "./types.js";

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

export type CatalogBinding = {
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

export type RequestRenderTraceEntry = {
	readonly index: number;
	readonly via: "p" | "byKey" | "invoke";
	readonly manifest: SystemContextInvocation["manifest"];
};

export type RequestAudit = {
	readonly binding: Readonly<Required<CatalogBinding>>;
	readonly finalManifest: SystemContextInvocation["manifest"];
	/**
	 * Successful renders performed by this request in call order.
	 *
	 * This is a render trace, not proof that every returned text was included
	 * byte-for-byte in the final provider prompt.
	 */
	readonly renderTrace: readonly RequestRenderTraceEntry[];
};

export type BoundRequestCatalog<C extends DefaultContract = DefaultContract> = {
	readonly binding: Readonly<Required<CatalogBinding>>;
	readonly p: TextRenderer<C>;
	readonly byKey: TextRendererObject<C>;
	readonly invoke: ReturnType<Catalog<C>["bind"]>;
	readonly finalize: <K extends ContractKey<C>>(
		finalInvocation: SystemContextInvocation<K>,
	) => RequestAudit;
};

export type CatalogBindingResolver = () => CatalogBinding;

export type SystemContextInvocation<K extends string = string> = {
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
		readonly artifactSchemaVersion: 1;
		readonly renderingContract: "delimited-context";
	};
};

export type SystemContextDescription = {
	readonly key: string;
	readonly owner: string;
	readonly contentKind: "text";
	readonly sourceLocale: string;
	readonly requiredLocales: readonly string[];
	readonly availableLocales: readonly string[];
	readonly variableNames: readonly string[];
	readonly releaseDigest: string;
};

export type Catalog<C extends DefaultContract = DefaultContract> = {
	readonly catalogDigest: string;
	readonly releaseProfile: string;
	list(): readonly SystemContextDescription[];
	describe<K extends ContractKey<C>>(key: K): SystemContextDescription;
	listAliases(): Readonly<Record<string, string>>;
	bind(binding: CatalogBinding): <K extends ContractKey<C>>(
		key: K,
		values: ContractValues<C>[K],
	) => SystemContextInvocation<K>;
	bindText(binding: CatalogBinding): BoundTextCatalog<C>;
	bindRequest(binding: CatalogBinding): BoundRequestCatalog<C>;
	createTextRenderer(resolveBinding: CatalogBindingResolver): TextRenderer<C>;
};

const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

export function definitionFromCompiled(
	context: S11tCompiledContext,
): CanonicalContextDefinition {
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
	const sections: CanonicalSectionDefinition[] = firstSections.map((section, sectionIndex) => {
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

export function assertCatalogIntegrity(artifact: S11tCatalogArtifact): void {
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
			const expected = hashArtifact({
				key,
				locale,
				sections: compiledLocale.sections,
				renderingContract: artifact.renderingContract,
			});
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
		const expectedDefinition = hashDefinition(
			definitionFromCompiled(context),
			artifact.renderingContract,
		);
		if (context.definitionHash !== expectedDefinition) {
			digestMismatch(["contexts", key, "definitionHash"], "Definition");
		}
		const expectedRelease = hashRelease({
			key,
			compilerVersion: artifact.compilerVersion,
			definitionHash: expectedDefinition,
			artifactHashes,
			renderingContract: artifact.renderingContract,
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
	const expectedPolicy = hashPolicy({
		releaseProfile: artifact.releaseProfile,
		requiredLocales,
		renderingContract: artifact.renderingContract,
	});
	if (artifact.policyDigest !== expectedPolicy) digestMismatch(["policyDigest"], "Policy");
	const expectedCatalog = hashCatalog({
		compilerVersion: artifact.compilerVersion,
		policyDigest: expectedPolicy,
		releaseDigests,
		aliases: artifact.aliases,
		renderingContract: artifact.renderingContract,
	});
	if (artifact.catalogDigest !== expectedCatalog) digestMismatch(["catalogDigest"], "Catalog");
}

function validateBinding(binding: CatalogBinding): Required<CatalogBinding> {
	if (binding === null || typeof binding !== "object" || Array.isArray(binding)) {
		throw new S11tError("S11T_VALUE_INVALID", "Binding must be an object", ["binding"]);
	}
	const source = binding as unknown as Record<string, unknown>;
	for (const key of Reflect.ownKeys(source)) {
		if (
			typeof key !== "string" ||
			!["instructionLocale", "fallbackLocales"].includes(key)
		) {
			throw new S11tError("S11T_VALUE_INVALID", "Binding contains an unsupported field", [
				typeof key === "string" ? key : "binding",
			]);
		}
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			throw new S11tError("S11T_VALUE_INVALID", "Binding must use data properties", [key]);
		}
	}
	const instructionDescriptor = Object.getOwnPropertyDescriptor(source, "instructionLocale");
	const instructionLocale =
		instructionDescriptor !== undefined && "value" in instructionDescriptor
			? instructionDescriptor.value
			: undefined;
	if (typeof instructionLocale !== "string" || !LOCALE_PATTERN.test(instructionLocale)) {
		throw new S11tError("S11T_VALUE_INVALID", "instructionLocale is invalid", ["instructionLocale"]);
	}
	const fallbackDescriptor = Object.getOwnPropertyDescriptor(source, "fallbackLocales");
	const fallbackInput =
		fallbackDescriptor !== undefined && "value" in fallbackDescriptor
			? fallbackDescriptor.value
			: [];
	if (!Array.isArray(fallbackInput)) {
		throw new S11tError("S11T_VALUE_INVALID", "fallbackLocales must be an array", [
			"fallbackLocales",
		]);
	}
	const fallbackLocales: unknown[] = [];
	for (const key of Reflect.ownKeys(fallbackInput)) {
		if (key === "length") continue;
		if (
			typeof key !== "string" ||
			!/^(?:0|[1-9]\d*)$/.test(key) ||
			Number(key) >= fallbackInput.length
		) {
			throw new S11tError("S11T_VALUE_INVALID", "fallbackLocales contains an unsupported field", [
				"fallbackLocales",
			]);
		}
		const descriptor = Object.getOwnPropertyDescriptor(fallbackInput, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			throw new S11tError("S11T_VALUE_INVALID", "fallbackLocales must use data properties", [
				"fallbackLocales",
				Number(key),
			]);
		}
	}
	for (let index = 0; index < fallbackInput.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(fallbackInput, String(index));
		if (descriptor === undefined || !("value" in descriptor)) {
			throw new S11tError("S11T_VALUE_INVALID", "fallbackLocales cannot be sparse", [
				"fallbackLocales",
				index,
			]);
		}
		fallbackLocales.push(descriptor.value);
	}
	if (
		fallbackLocales.some(
			(locale) => typeof locale !== "string" || !LOCALE_PATTERN.test(locale),
		) ||
		fallbackLocales.includes(instructionLocale) ||
		new Set(fallbackLocales).size !== fallbackLocales.length
	) {
		throw new S11tError("S11T_VALUE_INVALID", "fallbackLocales must be unique valid locales", [
			"fallbackLocales",
		]);
	}
	return { instructionLocale, fallbackLocales: fallbackLocales as string[] };
}

function delimitEncodedValue(name: string, value: string): string {
	return `<S11T_DELIMITED_CONTEXT variable="${name}">\n${value}\n</S11T_DELIMITED_CONTEXT>`;
}

function invoke(
	artifact: S11tCatalogArtifact,
	requestedKey: string,
	valuesInput: unknown,
	binding: CatalogBinding,
): SystemContextInvocation {
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
		const encoded = encodeValue(values[name], definition, [name], {
			escapeBoundaryCharacters: definition.trust === "untrusted",
		});
		encodedValues[name] =
			definition.placement === "delimited-context"
				? delimitEncodedValue(name, encoded)
				: encoded;
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
			artifactSchemaVersion: artifact.schemaVersion,
			renderingContract: artifact.renderingContract,
		},
	});
}

function bindInvocation<C extends DefaultContract>(
	artifact: S11tCatalogArtifact,
	binding: CatalogBinding,
): ReturnType<Catalog<C>["bind"]> {
	const snapshot = validateBinding(binding);
	return ((key: string, values: RuntimeValues) =>
		invoke(artifact, key, values, snapshot)) as ReturnType<Catalog<C>["bind"]>;
}

function textRenderer<C extends DefaultContract>(
	bound: ReturnType<Catalog<C>["bind"]>,
): TextRenderer<C> {
	const invokeBound = bound as (
		key: string,
		values: RuntimeValues,
	) => SystemContextInvocation;
	return Object.freeze(((key: string, values: RuntimeValues) =>
		invokeBound(key, values).content.text) as TextRenderer<C>);
}

function createCatalogBase<C extends DefaultContract = DefaultContract>(
	input: S11tCatalogArtifact,
	options: { expectedCatalogDigest?: string } = {},
): Catalog<C> {
	assertCatalogIntegrity(input);
	if (
		options.expectedCatalogDigest !== undefined &&
		input.catalogDigest !== options.expectedCatalogDigest
	) {
		digestMismatch(["catalogDigest"], "Expected catalog");
	}
	const artifact = deepFreeze(
		cloneJson(input as unknown as JsonValue),
	) as unknown as S11tCatalogArtifact;
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
	const bind = (binding: CatalogBinding) => bindInvocation<C>(artifact, binding);
	const bindText = (binding: CatalogBinding): BoundTextCatalog<C> => {
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
	const bindRequest = (binding: CatalogBinding): BoundRequestCatalog<C> => {
		const snapshot = deepFreeze(validateBinding(binding)) as Readonly<
			Required<CatalogBinding>
		>;
		const trace: RequestRenderTraceEntry[] = [];
		const requestInvocations = new WeakSet<object>();
		let lastInvocation: SystemContextInvocation | undefined;
		let finalized = false;
		const assertOpen = (): void => {
			if (finalized) {
				throw new S11tError("S11T_VALUE_INVALID", "Request binding is already finalized", [
					"request",
				]);
			}
		};
		const trackedInvoke = (
			via: RequestRenderTraceEntry["via"],
			key: string,
			values: RuntimeValues,
		): SystemContextInvocation => {
			assertOpen();
			const invocation = invoke(artifact, key, values, snapshot);
			requestInvocations.add(invocation);
			lastInvocation = invocation;
			trace.push(
				deepFreeze({
					index: trace.length,
					via,
					manifest: invocation.manifest,
				}),
			);
			return invocation;
		};
		const requestP = Object.freeze(((key: string, values: RuntimeValues) =>
			trackedInvoke("p", key, values).content.text) as TextRenderer<C>);
		const requestByKey = Object.create(null) as Record<
			string,
			(values: RuntimeValues) => string
		>;
		for (const key of textKeys) {
			const render = Object.freeze((values: RuntimeValues) =>
				trackedInvoke("byKey", key, values).content.text,
			);
			Object.defineProperty(requestByKey, key, {
				value: render,
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		const requestInvoke = ((key: string, values: RuntimeValues) =>
			trackedInvoke("invoke", key, values)) as ReturnType<Catalog<C>["bind"]>;
		const finalize: BoundRequestCatalog<C>["finalize"] = (
			finalInvocation,
		) => {
			assertOpen();
			if (
				!requestInvocations.has(finalInvocation) ||
				lastInvocation !== finalInvocation
			) {
				throw new S11tError(
					"S11T_VALUE_INVALID",
					"Final invocation must be the latest invocation produced by this request",
					["finalInvocation"],
				);
			}
			finalized = true;
			return deepFreeze({
				binding: snapshot,
				finalManifest: finalInvocation.manifest,
				renderTrace: [...trace],
			});
		};
		return Object.freeze({
			binding: snapshot,
			p: requestP,
			byKey: Object.freeze(requestByKey) as unknown as TextRendererObject<C>,
			invoke: Object.freeze(requestInvoke),
			finalize: Object.freeze(finalize),
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
		bindRequest,
		createTextRenderer: (resolveBinding) =>
			Object.freeze(((key: string, values: RuntimeValues) => {
				const bound = bind(resolveBinding());
				return (bound as (requestedKey: string, input: RuntimeValues) => SystemContextInvocation)(
					key,
					values,
				).content.text;
			}) as TextRenderer<C>),
	};
}

export function createCatalog<C extends DefaultContract = DefaultContract>(
	input: unknown,
	options: { expectedCatalogDigest?: string } = {},
): Catalog<C> {
	assertCatalogArtifact(input);
	return createCatalogBase<C>(input, options);
}
