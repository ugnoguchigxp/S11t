import { deepFreeze } from "./catalog-shared.js";
import { invokeContext, validateBinding } from "./catalog-rendering.js";
import type {
	BoundRequestCatalog,
	Catalog,
	CatalogBinding,
	DefaultContract,
	RequestRenderTraceEntry,
	RuntimeValues,
	SystemContextInvocation,
	TextRenderer,
	TextRendererObject,
} from "./catalog-types.js";
import { S11tnextError } from "./diagnostics.js";
import type { S11tnextCatalogArtifact } from "./types.js";

export function createRequestCatalog<C extends DefaultContract>(
	artifact: S11tnextCatalogArtifact,
	binding: CatalogBinding,
	textKeys: readonly string[],
): BoundRequestCatalog<C> {
	const snapshot = deepFreeze(validateBinding(binding)) as Readonly<
		Required<CatalogBinding>
	>;
	const trace: RequestRenderTraceEntry[] = [];
	const requestInvocations = new WeakSet<object>();
	let lastInvocation: SystemContextInvocation | undefined;
	let finalized = false;
	const assertOpen = (): void => {
		if (finalized) {
			throw new S11tnextError(
				"S11TNEXT_VALUE_INVALID",
				"Request binding is already finalized",
				["request"],
			);
		}
	};
	const trackedInvoke = (
		via: RequestRenderTraceEntry["via"],
		key: string,
		values: RuntimeValues,
	): SystemContextInvocation => {
		assertOpen();
		const invocation = invokeContext(artifact, key, values, snapshot);
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
	const requestP = Object.freeze(
		((key: string, values: RuntimeValues) =>
			trackedInvoke("p", key, values).content.text) as TextRenderer<C>,
	);
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
	const finalize: BoundRequestCatalog<C>["finalize"] = (finalInvocation) => {
		assertOpen();
		if (
			!requestInvocations.has(finalInvocation) ||
			lastInvocation !== finalInvocation
		) {
			throw new S11tnextError(
				"S11TNEXT_VALUE_INVALID",
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
}
