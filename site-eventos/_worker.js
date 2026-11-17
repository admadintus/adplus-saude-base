// Página pública de inscrição (eventos.adintus.com.br).
// Serve os arquivos estáticos e, para qualquer outro caminho, a página de inscrição (o endereço curto vira o código do evento).
// Só para robôs de prévia de link (WhatsApp, Telegram etc.) troca título e descrição pelos dados públicos do evento.
const API = 'https://umkrepbjtnjwzgpujgxi.supabase.co/functions/v1/adintus-inscricao';
const BOT = /WhatsApp|facebookexternalhit|Facebot|Telegram|Twitterbot|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|Googlebot|bingbot|Applebot/i;
const SEGURANCA = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https://umkrepbjtnjwzgpujgxi.supabase.co; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-robots-tag': 'noindex, nofollow',
};
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function descricao(ev) {
  let d = '';
  if (ev.data) {
    const p = ev.data.split('-');
    const dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
    d = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  }
  const l = [d + (ev.hora ? ' às ' + ev.hora : '')];
  if (ev.local) l.push(ev.local);
  l.push(ev.valor > 0 ? brl(ev.valor) : 'Gratuito');
  if (ev.livres === 0) l.push('Lista de espera'); else if (ev.livres) l.push(ev.livres === 1 ? 'Última vaga' : ev.livres + ' vagas');
  return l.filter(Boolean).join(' · ');
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!['GET', 'HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
      if (/\.[a-z0-9]{2,5}$/i.test(url.pathname)) return env.ASSETS.fetch(request); // arquivo estático
      const seg = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
      const tok = (url.searchParams.get('e') || '').trim() || (/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(seg) ? seg : '');
      const base = await env.ASSETS.fetch(new Request(url.origin + '/', { headers: request.headers }));
      let resp = new Response(base.body, base);
      let ev = null;
      if (tok && BOT.test(request.headers.get('user-agent') || '')) {
        try {
          const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 2500);
          const r = await fetch(API + '?e=' + encodeURIComponent(tok), { signal: ac.signal }); clearTimeout(t);
          const j = await r.json(); if (j && j.ok && j.evento && j.evento.aberto) ev = j.evento;
        } catch (_) { ev = null; }
      }
      if (ev) {
        const titulo = ev.nome + ' · Inscrição', desc = descricao(ev) + '. Garanta a sua vaga pelo link.';
        const img = url.origin + '/og-evento.jpg';
        const meta = (k, v, attr) => ({ element(e) { e.setAttribute('content', v); } });
        resp = new HTMLRewriter()
          .on('title', { element(e) { e.setInnerContent(titulo); } })
          .on('meta[property="og:title"]', meta('', titulo))
          .on('meta[property="og:description"]', meta('', desc))
          .on('meta[name="description"]', meta('', desc))
          .on('meta[property="og:image"]', meta('', img))
          .transform(resp);
      }
      const h = new Headers(resp.headers);
      for (const k in SEGURANCA) h.set(k, SEGURANCA[k]);
      h.set('cache-control', 'no-cache');
      return new Response(request.method === 'HEAD' ? null : resp.body, { status: 200, headers: h });
    } catch (e) {
      return env.ASSETS.fetch(request);
    }
  },
};
