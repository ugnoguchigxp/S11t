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

export type DefaultContract = CatalogContract<
	string,
	Record<string, RuntimeValues>,
	Record<string, "text">
>;
export type ContractKey<C> =
	C extends CatalogContract<infer K, infer _V, infer _O> ? K : never;
export type ContractValues<C> =
	C extends CatalogContract<infer _K, infer V, infer _O> ? V : never;

export type CatalogBinding = {
	instructionLocale: string;
	fallbackLocales?: readonly string[];
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
		readonly key: string;
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
	bind(binding: CatalogBinding): <K extends ContractKey<C>>(
		key: K,
		values: ContractValues<C>[K],
	) => SystemContextInvocation<K>;
	bindText(binding: CatalogBinding): BoundTextCatalog<C>;
	bindRequest(binding: CatalogBinding): BoundRequestCatalog<C>;
	createTextRenderer(resolveBinding: CatalogBindingResolver): TextRenderer<C>;
};
