/** Invoked by the Python service's shared Gherkin runner against its real HTTP listener. */
import { Catalog, RemoteProvider } from "@openentitlement/core";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { url, product, token, action, key = "seats", organization = "acme", subject, cache = false } = JSON.parse(input);
const p = Catalog.fromJSON({ features: [{ code: "test", name: "Test", privileges: [{ key, valueType: "integer", default: 0 }] }] }).privilege(key)!;
const provider = new RemoteProvider({ baseUrl: url, product, token, cacheTtlMs: cache ? 10000 : undefined });
const context = { organizationId: organization, subjectId: subject ?? undefined, now: new Date() };
try {
  let result: unknown;
  if (action === "bulk") result = [...(await provider.resolveAll([p], { organizationId: organization })).values()];
  else if (action === "upgrade") result = await provider.suggestPlan(p, 50, context) ?? null;
  else {
    result = await provider.resolve(p, context, { explicitTime: false });
    if (cache) result = await provider.resolve(p, context, { explicitTime: false });
  }
  console.log(JSON.stringify({ status: 200, result }));
} catch (error: any) { console.log(JSON.stringify({ status: error.status, type: error.type })); }
