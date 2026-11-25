// Worker "adplus-site" no Cloudflare: serve a landing page do Ad+ (landing/index.html deste repositório).
const ORIGEM = "https://raw.githubusercontent.com/admadintus/adplus-saude-base/main/landing/index.html";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      return Response.redirect(url.origin + "/", 301);
    }
    const r = await fetch(ORIGEM, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return new Response("Site temporariamente indisponível.", { status: 503 });
    return new Response(r.body, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  },
};
