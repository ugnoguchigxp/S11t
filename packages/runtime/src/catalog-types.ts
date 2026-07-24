import type { PromptMessageRole } from "./types.js";

export type RuntimeValues = Record<string, unknown>;

export type CatalogContract<
	K extends string,
	ValueMap extends Record<K, RuntimeValues>,
	OutputMap extends Record<K, "text">,
	RoleMap extends Record<K, PromptMessageRole> = Record<K, "system">,
> = {
	readonly key: K;
	readonly values: ValueMap;
	readonly outputs: OutputMap;
	readonly roles: RoleMap;
};

export type DefaultContract = CatalogContract<
	string,
	Record<string, RuntimeValues>,
	Record<string, "text">,
	Record<string, PromptMessageRole>
>;
export type ContractKey<C> =
	C extends CatalogContract<infer K, infer _V, infer _O, infer _R> ? K : never;
export type ContractValues<C> =
	C extends CatalogContract<infer _K, infer V, infer _O, infer _R> ? V : never;
export type ContractRoles<C> =
	C extends CatalogContract<infer _K, infer _V, infer _O, infer R> ? R : never;

export type CatalogBinding = {
	instructionLocale: string;
	fallbackLocales?: readonly string[];
	trailingNewline?: boolean;
};

export type TextRenderer<C extends DefaultContract = DefaultContract> = <
	K extends ContractKey<C>,
>(
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
	readonly manifest: PromptInvocation["manifest"];
};

export type CompositionReceipt = {
	readonly payloadHash: string;
	readonly fragments: readonly {
		readonly manifest: PromptInvocation["manifest"];
		readonly startByte: number;
		readonly endByte: number;
	}[];
};

export type RequestAudit = {
	readonly binding: Readonly<Required<CatalogBinding>>;
	readonly finalManifest: PromptInvocation["manifest"];
	/**
	 * Successful renders performed by this request in call order.
	 *
	 * This is a render trace, not proof that every returned text was included
	 * byte-for-byte in the final provider prompt.
	 */
	readonly renderTrace: readonly RequestRenderTraceEntry[];
	/**
	 * Byte ranges proving that the explicitly claimed request-local fragments
	 * occur in order in the final S11tnext payload.
	 */
	readonly composition?: CompositionReceipt;
};

export type BoundRequestCatalog<C extends DefaultContract = DefaultContract> = {
	readonly binding: Readonly<Required<CatalogBinding>>;
	readonly p: TextRenderer<C>;
	readonly byKey: TextRendererObject<C>;
	readonly invoke: ReturnType<Catalog<C>["bind"]>;
	readonly finalize: <K extends ContractKey<C>>(
		finalInvocation: PromptInvocation<K, ContractRoles<C>[K]>,
		includedFragments?: readonly PromptInvocation[],
	) => RequestAudit;
};

export type CatalogBindingResolver = () => CatalogBinding;

export type PromptInvocation<
	K extends string = string,
	R extends PromptMessageRole = PromptMessageRole,
> = {
	readonly key: K;
	readonly role: R;
	readonly content: {
		readonly kind: "text";
		readonly text: string;
	};
	readonly manifest: {
		readonly key: string;
		readonly messageRole: R;
		readonly messageHash: string;
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
		readonly trailingNewline: boolean;
		readonly sectionIds: readonly string[];
		readonly compilerVersion: string;
		readonly releaseProfile: string;
		readonly policyDigest: string;
	};
};

/**
 * @deprecated Use PromptInvocation.
 */
export type SystemContextInvocation<K extends string = string> =
	PromptInvocation<K, "system">;

export type PromptDescription = {
	readonly key: string;
	readonly owner: string;
	readonly contentKind: "text";
	readonly messageRole: PromptMessageRole;
	readonly sourceLocale: string;
	readonly requiredLocales: readonly string[];
	readonly availableLocales: readonly string[];
	readonly variableNames: readonly string[];
	readonly releaseDigest: string;
};

/**
 * @deprecated Use PromptDescription.
 */
export type SystemContextDescription = PromptDescription;

export type Catalog<C extends DefaultContract = DefaultContract> = {
	readonly catalogDigest: string;
	readonly releaseProfile: string;
	list(): readonly PromptDescription[];
	describe<K extends ContractKey<C>>(key: K): PromptDescription;
	bind(binding: CatalogBinding): <K extends ContractKey<C>>(
		key: K,
		values: ContractValues<C>[K],
	) => PromptInvocation<K, ContractRoles<C>[K]>;
	bindText(binding: CatalogBinding): BoundTextCatalog<C>;
	bindRequest(binding: CatalogBinding): BoundRequestCatalog<C>;
	createTextRenderer(resolveBinding: CatalogBindingResolver): TextRenderer<C>;
};
