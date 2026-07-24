import { utf8ToBytes } from "@noble/hashes/utils.js";

import { deepFreeze } from "./catalog-shared.js";
import { invokeContext, validateBinding } from "./catalog-rendering.js";
import type {
	BoundRequestCatalog,
	Catalog,
	CatalogBinding,
	DefaultContract,
	RequestRenderTraceEntry,
	RuntimeValues,
	PromptInvocation,
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
	let lastInvocation: PromptInvocation | undefined;
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
	): PromptInvocation => {
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
		trackedInvoke("invoke", key, values)) as unknown as ReturnType<
		Catalog<C>["bind"]
	>;
	const finalize: BoundRequestCatalog<C>["finalize"] = (
		finalInvocation,
		includedFragments = [],
	) => {
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
		let cursor = 0;
		const fragments = includedFragments.map((fragment, index) => {
			if (!requestInvocations.has(fragment) || fragment === finalInvocation) {
				throw new S11tnextError(
					"S11TNEXT_VALUE_INVALID",
					"Composition fragments must be earlier invocations from this request",
					["includedFragments", index],
				);
			}
			const start = finalInvocation.content.text.indexOf(fragment.content.text, cursor);
			if (start === -1) {
				throw new S11tnextError(
					"S11TNEXT_VALUE_INVALID",
					"Composition fragment is not included byte-for-byte in the final payload",
					["includedFragments", index],
				);
			}
			const end = start + fragment.content.text.length;
			cursor = end;
			const startByte = utf8ToBytes(
				finalInvocation.content.text.slice(0, start),
			).length;
			const endByte = startByte + utf8ToBytes(fragment.content.text).length;
			return deepFreeze({
				manifest: fragment.manifest,
				startByte,
				endByte,
			});
		});
		finalized = true;
		return deepFreeze({
			binding: snapshot,
			finalManifest: finalInvocation.manifest,
			renderTrace: [...trace],
			...(fragments.length === 0
				? {}
				: {
						composition: deepFreeze({
							payloadHash: finalInvocation.manifest.renderedHash,
							fragments,
						}),
					}),
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
