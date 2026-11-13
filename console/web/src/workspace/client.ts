let csrf="";
export const setCsrf=(value: string)=>{csrf=value;};
export async function request<T=any>(path: string,method="GET",body?: unknown): Promise<T> {
  const response=await fetch(path,{method,credentials:"same-origin",signal:AbortSignal.timeout(15000),headers:{"content-type":"application/json",...(method!=="GET"?{"x-oe-csrf":csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(response.status===204)return undefined as T;
  const data=await response.json();
  // The Python service answers with RFC 9457 Problem Details (detail, type); the Node service with {message}.
  if(!response.ok)throw Object.assign(new Error(data.detail??data.message??"Request failed"),{status:response.status,type:data.type});
  return data;
}
