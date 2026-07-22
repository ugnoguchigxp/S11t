export {
	assertCatalogArtifactV1,
	assertCatalogArtifactV2,
	isCatalogArtifactV1,
	isCatalogArtifactV2,
} from "./artifact-schema.js";
export { createCatalog } from "./catalog.js";
export { assertCatalogIntegrityV2, createCatalogV2 } from "./catalog-v2.js";
export type {
	BoundTextCatalog,
	CatalogBindingV2,
	CatalogBindingResolverV2,
	CatalogV2,
	SystemContextDescriptionV2,
	SystemContextInvocationV2,
	TextRenderer,
	TextRendererObject,
} from "./catalog-v2.js";
export type {
	Catalog,
	CatalogBinding,
	CatalogContract,
	RuntimeValues,
	SystemContextDescription,
	SystemContextInvocation,
} from "./catalog.js";
export { S11tError } from "./diagnostics.js";
export type { S11tErrorCode } from "./diagnostics.js";
export type {
	JsonValue,
	S11tCatalogArtifactV1,
	S11tCatalogArtifactV2,
	S11tCompiledContextV1,
	S11tCompiledContextV2,
	S11tCompiledLocaleV1,
	S11tCompiledLocaleV2,
	S11tCompiledSectionV1,
	S11tCompiledSectionV2,
	S11tCompiledVariableV1,
	S11tCompiledVariableV2,
	TemplateSegment,
} from "./types.js";
