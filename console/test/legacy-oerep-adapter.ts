/** Test-only bridge for historical Node fixtures while service/python replaces the server. */
export const legacyOerepFetch: typeof globalThis.fetch = (input, init) => {
  const url = new URL(String(input));
  url.pathname = url.pathname.replace(/^\/oerep\/v1\/products\/demo\/privileges\/([^/]+)\/(resolve|upgrade)$/, (_, key, action) => `/oerep/v1/${action === "upgrade" ? "suggest" : "resolve"}/${key}`)
    .replace("/oerep/v1/products/demo/privileges/resolve", "/oerep/v1/resolve");
  return fetch(url, init);
};
