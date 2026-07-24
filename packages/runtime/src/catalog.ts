import { assertCatalogArtifact } from "./artifact-schema.js";
import { assertCatalogIntegrity } from "./artifact-integrity.js";
import {
	cloneJson,
	compareCodeUnits,
	deepFreeze,
	digestMismatch,
} from "./catalog-shared.js";
import { invokeContext, validateBinding } from "./catalog-rendering.js";
import type {
	BoundTextCatalog,
	Catalog,
	CatalogBinding,
	DefaultContract,
	PromptInvocation,
	RuntimeValues,
	TextRenderer,
	TextRendererObject,
} from "./catalog-types.js";
import { S11tnextError } from "./diagnostics.js";
import { createRequestCatalog } from "./request-audit.js";
import type { JsonValue, S11tnextCatalogArtifact } from "./types.js";

export { assertCatalogIntegrity };
export type {
	BoundRequestCatalog,
	BoundTextCatalog,
	Catalog,
	CatalogBinding,
	CatalogBindingResolver,
	CatalogContract,
	CompositionReceipt,
	ContractRoles,
	PromptDescription,
	PromptInvocation,
	RequestAudit,
	RequestRenderTraceEntry,
	RuntimeValues,
	SystemContextDescription,
	SystemContextInvocation,
	TextRenderer,
	TextRendererObject,
} from "./catalog-types.js";

function bindInvocation<C extends DefaultContract>(
	artifact: S11tnextCatalogArtifact,
	binding: CatalogBinding,
): ReturnType<Catalog<C>["bind"]> {
	const snapshot = validateBinding(binding);
	return ((key: string, values: RuntimeValues) =>
		invokeContext(artifact, key, values, snapshot)) as unknown as ReturnType<
		Catalog<C>["bind"]
	>;
}

function textRenderer<C extends DefaultContract>(
	bound: ReturnType<Catalog<C>["bind"]>,
): TextRenderer<C> {
	const invokeBound = bound as unknown as (
		key: string,
		values: RuntimeValues,
	) => PromptInvocation;
	return Object.freeze(
		((key: string, values: RuntimeValues) =>
			invokeBound(key, values).content.text) as TextRenderer<C>,
	);
}

function createCatalogBase<C extends DefaultContract = DefaultContract>(
	input: S11tnextCatalogArtifact,
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
	) as unknown as S11tnextCatalogArtifact;
	const descriptions = deepFreeze(
		Object.values(artifact.contexts)
			.sort((left, right) => compareCodeUnits(left.key, right.key))
			.map((context) =>
				deepFreeze({
					key: context.key,
					owner: context.owner,
					contentKind: context.contentKind,
					messageRole: context.messageRole,
					sourceLocale: context.sourceLocale,
					requiredLocales: [...context.requiredLocales],
					availableLocales: Object.keys(context.locales).sort(compareCodeUnits),
					variableNames: Object.keys(context.variables).sort(compareCodeUnits),
					releaseDigest: context.releaseDigest,
				}),
			),
	);
	const textKeys = Object.keys(artifact.contexts).sort(compareCodeUnits);
	const bind = (binding: CatalogBinding) => bindInvocation<C>(artifact, binding);
	const bindText = (binding: CatalogBinding): BoundTextCatalog<C> => {
		const p = textRenderer<C>(bind(binding));
		const renderers = Object.create(null) as Record<
			string,
			(values: RuntimeValues) => string
		>;
		for (const key of textKeys) {
			const render = Object.freeze((values: RuntimeValues) =>
				(p as (contextKey: string, input: RuntimeValues) => string)(
					key,
					values,
				),
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
			const contextKey = String(key);
			const result = descriptions.find(
				(description) => description.key === contextKey,
			);
			if (result === undefined) {
				throw new S11tnextError(
					"S11TNEXT_CONTEXT_NOT_FOUND",
					`Context not found: ${contextKey}`,
					[contextKey],
				);
			}
			return result;
		},
		bind,
		bindText,
		bindRequest: (binding) =>
			createRequestCatalog<C>(artifact, binding, textKeys),
		createTextRenderer: (resolveBinding) =>
			Object.freeze(
				((key: string, values: RuntimeValues) => {
					const bound = bind(resolveBinding());
					return (
						bound as unknown as (
							contextKey: string,
							input: RuntimeValues,
						) => PromptInvocation
					)(key, values).content.text;
				}) as TextRenderer<C>,
			),
	};
}

export function createCatalog<C extends DefaultContract = DefaultContract>(
	input: unknown,
	options: { expectedCatalogDigest?: string } = {},
): Catalog<C> {
	assertCatalogArtifact(input);
	return createCatalogBase<C>(input, options);
}
