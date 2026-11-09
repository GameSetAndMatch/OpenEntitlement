import type { IncomingMessage, ServerResponse } from "node:http";
import * as oidc from "openid-client";
import { timingSafeEqual } from "node:crypto";
import { WorkspaceStore, token, type Session } from "./store.ts";
import { WorkspaceError } from "./model.ts";

export interface AuthConfig { appUrl: string; issuer: string; clientId: string; clientSecret?: string; bootstrapSubject?: string; allowedDomains: string[]; allowLocalHttp: boolean }
const loopback = (host: string) => ["localhost","127.0.0.1","[::1]"].includes(host);
export function authConfig(env = process.env): AuthConfig {
  const app = new URL(env.OE_APP_URL ?? "http://localhost:18789");
  const issuer = new URL(env.OE_OIDC_ISSUER ?? "http://localhost:18790");
  const allowLocalHttp = env.OE_OIDC_LOCAL_HTTP === "true";
  if (app.pathname !== "/" || app.search || app.hash || app.username || app.password) throw new Error("OE_APP_URL must be an origin without a path or credentials");
  for (const url of [app,issuer]) if (url.protocol !== "https:" && !(allowLocalHttp && url.protocol === "http:" && loopback(url.hostname))) throw new Error("OIDC and app URLs require HTTPS; explicit local HTTP is loopback-only");
  return { appUrl: app.origin,issuer: issuer.href.replace(/\/$/,""),clientId: env.OE_OIDC_CLIENT_ID ?? "openentitlement",...(env.OE_OIDC_CLIENT_SECRET ? { clientSecret: env.OE_OIDC_CLIENT_SECRET } : {}),...(env.OE_PLATFORM_ADMIN_SUBJECT ? { bootstrapSubject: env.OE_PLATFORM_ADMIN_SUBJECT } : {}),allowedDomains: (env.OE_SIGNUP_DOMAINS ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean),allowLocalHttp };
}
export function cookie(req: IncomingMessage,name: string) {
  const value = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(name+"="))?.slice(name.length+1) ?? "";
  return /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : "";
}
const equal = (a: string,b: string) => { const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right); };
export class Authentication {
  config: AuthConfig;
  store: WorkspaceStore;
  private oidc: oidc.Configuration;
  private constructor(config: AuthConfig,store: WorkspaceStore,client: oidc.Configuration) { this.config=config;this.store=store;this.oidc=client; }
  static async create(config: AuthConfig,store: WorkspaceStore) {
    const client = await oidc.discovery(new URL(config.issuer),config.clientId,config.clientSecret ?? { token_endpoint_auth_method: "none" },config.clientSecret ? undefined : oidc.None(),{ execute: config.allowLocalHttp ? [oidc.allowInsecureRequests,oidc.enableNonRepudiationChecks] : [oidc.enableNonRepudiationChecks] });
    return new Authentication(config,store,client);
  }
  private setCookie(name: string,value: string,age: number) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${this.config.appUrl.startsWith("https:") ? "; Secure" : ""}`; }
  async login(res: ServerResponse) {
    const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce(),flow=token();
    await this.store.saveFlow(flow,{ verifier,state,nonce });
    const url=oidc.buildAuthorizationUrl(this.oidc,{ redirect_uri: this.config.appUrl+"/auth/callback",scope:"openid email profile",code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:"S256",state,nonce });
    res.writeHead(302,{location:url.href,"set-cookie":this.setCookie("oe_flow",flow,600),"cache-control":"no-store"}).end();
  }
  async callback(req: IncomingMessage,res: ServerResponse) {
    const flow=await this.store.takeFlow(cookie(req,"oe_flow"));
    if (!flow) throw new WorkspaceError("Sign-in expired. Start again.",401);
    const url=new URL(req.url!,this.config.appUrl);
    let claims: oidc.UserInfoResponse;
    try {
      const result=await oidc.authorizationCodeGrant(this.oidc,url,{ pkceCodeVerifier:flow.verifier,expectedState:flow.state,expectedNonce:flow.nonce,idTokenExpected:true });
      const identity=result.claims();
      if (!identity || typeof identity.sub !== "string") throw new Error("Missing identity");
      claims=await oidc.fetchUserInfo(this.oidc,result.access_token,identity.sub);
    } catch { throw new WorkspaceError("Sign-in failed. Start again.",401); }
    if (!claims || typeof claims.sub !== "string" || typeof claims.email !== "string" || claims.email_verified !== true) throw new WorkspaceError("Sign-in requires a verified email address",403);
    const domain=claims.email.slice(claims.email.lastIndexOf("@")+1).toLowerCase();
    if (this.config.allowedDomains.length && !this.config.allowedDomains.includes(domain)) throw new WorkspaceError("Your email domain cannot sign up here",403);
    const account=await this.store.account(this.config.issuer,claims.sub,claims.email,this.config.bootstrapSubject === claims.sub);
    const session=await this.store.createSession(account);
    res.writeHead(302,{location:"/app/","set-cookie":[this.setCookie("oe_session",session,43200),this.setCookie("oe_flow","",0)],"cache-control":"no-store"}).end();
  }
  async session(req: IncomingMessage): Promise<Session> {
    const session=await this.store.session(cookie(req,"oe_session"));
    if (!session) throw new WorkspaceError("Sign in to continue",401);
    return session;
  }
  csrf(req: IncomingMessage,session: Session) {
    if (req.headers.origin !== this.config.appUrl || !equal(String(req.headers["x-oe-csrf"] ?? ""),session.csrf)) throw new WorkspaceError("Invalid request origin or CSRF token",403);
  }
  async logout(req: IncomingMessage,res: ServerResponse,session: Session) {
    this.csrf(req,session); await this.store.logout(cookie(req,"oe_session"));
    res.writeHead(204,{"set-cookie":this.setCookie("oe_session","",0),"cache-control":"no-store"}).end();
  }
}
