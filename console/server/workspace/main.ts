import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Authentication, authConfig, type AuthConfig } from "./auth.ts";
import { WorkspaceStore } from "./store.ts";
import { workspaceApi } from "./api.ts";
import { WorkspaceError } from "./model.ts";
import { HttpError, send } from "../http.ts";

export async function startWorkspaceServer(options: { databaseUrl: string; auth: AuthConfig; port?: number; host?: string; staticDir?: string; env?:NodeJS.ProcessEnv }) {
  const store=new WorkspaceStore(options.databaseUrl);
  try {
    await store.initialize();
    const auth=await Authentication.create(options.auth,store),api=workspaceApi(auth,store,{...(options.env??process.env)});
    const root=resolve(options.staticDir ?? fileURLToPath(new URL("../../web/dist/",import.meta.url)));
    const server=createServer(async(req,res) => {
      try {
        res.setHeader("x-content-type-options","nosniff");res.setHeader("referrer-policy","same-origin");res.setHeader("cache-control","no-store");
        if (req.url === "/health") { send(res,200,{status:"ok"});return; }
        if (await api(req,res)) return;
        if (req.method !== "GET" && req.method !== "HEAD") throw new WorkspaceError("Method not allowed",405);
        const path=new URL(req.url!,options.auth.appUrl).pathname;
        if (path === "/") { res.writeHead(302,{location:"/app/"}).end();return; }
        let decoded:string;try{decoded=decodeURIComponent(path);}catch{throw new WorkspaceError("Invalid URL encoding",400);}
        const file=resolve(root,"."+decoded);
        if (!file.startsWith(root+sep)) throw new WorkspaceError("Not found",404);
        let content: Buffer,actual=file;
        try { content=await readFile(file); } catch { if(!path.startsWith("/app"))throw new WorkspaceError("Not found",404);actual=resolve(root,"index.html");content=await readFile(actual); }
        const types: Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml"};
        res.writeHead(200,{"content-type":types[extname(actual)]??"application/octet-stream","content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});res.end(req.method === "HEAD" ? undefined : content);
      } catch (e) {
        const status=e instanceof WorkspaceError || e instanceof HttpError ? e.status : 500;
        send(res,status,{message:status===500?"The request could not be completed":(e as Error).message});
      }
    });
    await new Promise<void>((ok,fail)=>{server.once("error",fail);server.listen(options.port??18789,options.host??"127.0.0.1",ok);});
    const address=server.address();
    return {server,store,url:`http://localhost:${typeof address === "object" ? address!.port : options.port}`,close:async()=>{await new Promise<void>(ok=>server.close(()=>ok()));await store.close();}};
  } catch(e) {await store.close();throw e;}
}
if(import.meta.url===`file://${process.argv[1]}`){
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required for the workspace service");
  const running=await startWorkspaceServer({databaseUrl:process.env.DATABASE_URL,auth:authConfig(),port:Number(process.env.PORT??18789),host:process.env.OE_HOST??"127.0.0.1"});
  console.log(`Workspace service on ${running.url}/app/`);
  for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,async()=>{await running.close();process.exit(0);});
}
