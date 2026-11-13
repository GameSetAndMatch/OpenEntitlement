/** Shared real-server fixture for Python/TypeScript interoperability tests. */
import { startServer } from "../server/main.ts";
import { configFromEnv } from "../server/config.ts";
const running = await startServer({ ...configFromEnv(), provider: "memory", seedDemo: true, port: 0, evalToken: "eval-test", adminToken: "admin-test" });
// Only historical interoperability fixtures use this bridge; production routes are unchanged.
const { createServer } = await import("node:http");
const { legacyOerepFetch } = await import("./legacy-oerep-adapter.ts");
const bridge = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const response = await legacyOerepFetch(running.url + req.url, {
    method: req.method, headers: req.headers as Record<string, string>, body: Buffer.concat(chunks),
  });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
console.log(`http://localhost:${(bridge.address() as import("node:net").AddressInfo).port}`);
process.on("SIGTERM", async () => { await running.close(); process.exit(0); });
