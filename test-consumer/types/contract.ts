import { createAppCatalog } from "../../examples/node-basic/.s11t/catalog.generated.js";

const catalog = createAppCatalog({});
const p = catalog.bind({ instructionLocale: "ja-JP" });

p("codingAgent:identity", { taskGoal: "valid" });

// @ts-expect-error unknown SystemContext key
p("unknown:key", { taskGoal: "invalid" });

// @ts-expect-error missing required runtime value
p("codingAgent:identity", {});

// @ts-expect-error wrong runtime value type
p("codingAgent:identity", { taskGoal: 42 });
