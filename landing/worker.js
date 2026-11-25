// Worker do site adplus.app.br: serve a página, a demonstração e o vídeo direto do GitHub (pasta landing/).
const RAW = "https://raw.githubusercontent.com/admadintus/adplus-saude-base/main/landing/";
const ROTAS = { "/": ["index.html", "text/html; charset=utf-8"], "/index.html": ["index.html", "text/html; charset=utf-8"], "/demo": ["demo/index.html", "text/html; charset=utf-8"], "/demo/": ["demo/index.html", "text/html; charset=utf-8"], "/media/adplus-demonstracao.mp4": ["media/adplus-demonstracao.mp4", "video/mp4"], "/media/capa-video.jpg": ["media/capa-video.jpg", "image/jpeg"] };
export default { async fetch(q) {
  const u = new URL(q.url), r = ROTAS[u.pathname];
  if (!r) return Response.redirect(u.origin + "/", 301);
  const h = {}; const rg = q.headers.get("range"); if (rg) h.range = rg;
  const o = await fetch(RAW + r[0], { headers: h, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!o.ok && o.status !== 206) return new Response("Temporariamente indisponível.", { status: 503 });
  const out = new Headers({ "content-type": r[1], "cache-control": "public, max-age=300", "accept-ranges": "bytes" });
  ["content-length", "content-range"].forEach(k => { const v = o.headers.get(k); if (v) out.set(k, v); });
  return new Response(o.body, { status: o.status, headers: out });
} };
