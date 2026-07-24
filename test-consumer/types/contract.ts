import {
	createCatalog,
	type CatalogContract,
	type PromptInvocation,
} from "../../packages/runtime/src/index.js";

type Key = "context.with-values" | "context.without-values";
type Values = {
	"context.with-values": { value: string };
	"context.without-values": Record<string, never>;
};
type Outputs = {
	"context.with-values": "text";
	"context.without-values": "text";
};
type Contract = CatalogContract<Key, Values, Outputs>;

const catalog = createCatalog<Contract>({});
const bound = catalog.bindText({ instructionLocale: "ja-JP" });
const request = catalog.bindRequest({ instructionLocale: "ja-JP" });
const live = catalog.createTextRenderer(() => ({ instructionLocale: "ja-JP" }));

bound.p("context.with-values", { value: "ok" });
bound.byKey["context.with-values"]({ value: "ok" });
bound.p("context.without-values", {});
bound.byKey["context.without-values"]({});
request.invoke("context.with-values", { value: "ok" });
const systemInvocation: PromptInvocation<"context.with-values", "system"> =
	request.invoke("context.with-values", { value: "ok" });
live("context.with-values", { value: "ok" });

type MixedRoleContract = CatalogContract<
	"context.user",
	{ "context.user": { value: string } },
	{ "context.user": "text" },
	{ "context.user": "user" }
>;
const mixed = createCatalog<MixedRoleContract>({});
const userInvocation = mixed.bind({ instructionLocale: "ja-JP" })(
	"context.user",
	{ value: "ok" },
);
const typedUserInvocation: PromptInvocation<"context.user", "user"> =
	userInvocation;

void systemInvocation;
void typedUserInvocation;

// @ts-expect-error user invocation cannot be treated as a system invocation
const invalidSystemInvocation: PromptInvocation<"context.user", "system"> =
	userInvocation;

// @ts-expect-error missing required runtime value
bound.p("context.with-values", {});

// @ts-expect-error extra runtime value on an exact empty context
bound.p("context.without-values", { extra: true });

// @ts-expect-error extra runtime value through byKey
bound.byKey["context.without-values"]({ extra: true });

// @ts-expect-error unknown canonical key
bound.p("unknown.context", {});

// @ts-expect-error removed colon key syntax
live("context:with-values", { value: "invalid" });

// @ts-expect-error unknown byKey property
bound.byKey["unknown.context"]({});
