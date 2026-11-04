/** OpenEntitlement Console server: API + static UI. `node --conditions=source server/main.ts` */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { createOerep } from "./oerep.ts";
import { createApi } from "./api.ts";
import { buildRuntime, configFromEnv, type ConsoleConfig } from "./config.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

export async function startServer(cfg: ConsoleConfig): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const rt = await buildRuntime(cfg);
  const api = createApi(cfg, rt);
  const oerep = createOerep(rt, cfg.evalToken);
  const server = createServer(async (req, res) => {
    try {
      if (await oerep(req, res)) return;
      if (await api(req, res)) return;
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end();
        return;
      }
      // static UI with SPA fallback; refuse path traversal
      const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
      let file = join(cfg.staticDir, path);
      if (!file.startsWith(cfg.staticDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(cfg.staticDir, "index.html");
      if (!existsSync(file)) {
        res.writeHead(503, { "content-type": "text/plain" }).end("UI not built: run `npm run build` in console/ (the API is up under /api).");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      createReadStream(file).on("error", () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "INVALID_REQUEST", message: "invalid request" }));
      else res.destroy();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(cfg.port, cfg.host ?? "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
  } catch (error) { await rt.close(); throw error; }
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : cfg.port;
  return {
    server,
    url: `http://localhost:${port}`,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await rt.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = configFromEnv();
  const running = await startServer(cfg);
  const { url } = running;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => { await running.close(); process.exit(0); });
  console.log(`OpenEntitlement Console on ${url} (provider: ${cfg.provider})`);
}
