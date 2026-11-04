/** Shared real-server fixture for Python/TypeScript interoperability tests. */
import { startServer } from "../server/main.ts";
import { configFromEnv } from "../server/config.ts";
const running = await startServer({ ...configFromEnv(), provider: "memory", seedDemo: true, port: 0, evalToken: "eval-test", adminToken: "admin-test" });
console.log(running.url);
process.on("SIGTERM", async () => { await running.close(); process.exit(0); });
