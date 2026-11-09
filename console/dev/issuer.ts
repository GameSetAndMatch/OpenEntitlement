/** Loopback-only OpenID Connect development provider. Never used by production startup. */
import { Provider } from "oidc-provider";

export async function startDevIssuer(port = 18790, appUrl = "http://localhost:18789", adminEmail = "admin@example.test") {
  const provider=new Provider(`http://localhost:${port}`,{
    clients:[{client_id:"openentitlement",redirect_uris:[appUrl+"/auth/callback"],response_types:["code"],grant_types:["authorization_code"],token_endpoint_auth_method:"none"}],
    claims:{openid:["sub"],email:["email","email_verified"],profile:["name"]},
    pkce:{required:()=>true},
    features:{devInteractions:{enabled:true}},
    async findAccount(_ctx,id){
      const emails: Record<string,string>={"local-admin":adminEmail,"local-user":"user@example.test"};
      if(!emails[id])return undefined;
      return {accountId:id,async claims(){return{sub:id,email:emails[id],email_verified:true,name:id==="local-admin"?"Local administrator":"Local user"};}};
    },
    cookies:{keys:["local-development-only-cookie-signing-key-1","local-development-only-cookie-signing-key-2"]},
  });
  const server=provider.listen(port,"127.0.0.1");
  await new Promise<void>((ok,fail)=>{server.once("listening",ok);server.once("error",fail);});
  return {provider,url:`http://localhost:${port}`,close:()=>new Promise<void>(ok=>server.close(()=>ok()))};
}
if(import.meta.url===`file://${process.argv[1]}`){
  await startDevIssuer(Number(process.env.OE_DEV_ISSUER_PORT??18790),process.env.OE_APP_URL??"http://localhost:18789",process.env.OE_DEV_ADMIN_EMAIL??"admin@example.test");
  console.log("Development OIDC provider on loopback. Sign in as local-admin or local-user. Do not expose this provider to the internet.");
}
