// Adintus Saúde · Suporte e vigilância (Supabase Edge Function "adintus-suporte") · versão 1.0
// O que faz:
//  - "pedido":  usuário logado envia um pedido de ajuda (texto + print opcional). Fica guardado e chega por e-mail ao administrador.
//  - "meus":    usuário vê os próprios pedidos e as respostas.
//  - "erro":    o aplicativo informa erros de tela (agrupados por tipo, sem conteúdo de prontuário).
//  - "lista" / "responder" / "erro_resolver": só administrador (painel Suporte).
//  - "resumo":  (agendado, x-cron-secret) resumo diário por e-mail: pedidos, erros e saúde do sistema.
//  - "ping":    (agendado, x-cron-secret) confere se o site e o banco respondem; avisa uma vez ao cair e uma vez ao voltar.
// Segredos (Supabase › Edge Functions › Secrets): RESEND_API_KEY e AGENDA_CRON_SECRET (os mesmos da agenda).
// Opcionais: SUPORTE_TO (padrão administrativo@adintus.com.br), SUPORTE_FROM (padrão "Suporte Adintus <suporte@adintus.com.br>"),
//            SUPORTE_ADMIN_EMAILS, SITE_URL (padrão https://prontuario.adintus.com.br),
//            ANTHROPIC_API_KEY (liga a triagem automática por IA, só com o TEXTO do pedido; o print nunca vai para a IA).
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-cron-secret, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const TZ = "America/Sao_Paulo";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const cut = (s: unknown, n: number) => String(s ?? "").slice(0, n);
const TIPOS: Record<string, string> = { duvida: "Dúvida de uso", erro: "Erro no sistema", sugestao: "Pedido de alteração" };
const STATUS = ["novo", "em andamento", "resolvido"];
const fmtBR = (d: string | Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

export interface Env { get(k: string): string | undefined }
export interface Deps {
  sb: any; // cliente Supabase com chave de serviço
  env: Env;
  fetchFn: typeof fetch;
  now?: () => Date;
}

export async function sendMail(d: Deps, o: { to: string; subject: string; html: string; text: string; replyTo?: string; attach?: { filename: string; content: string }[] }) {
  const key = d.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, erro: "RESEND_API_KEY não configurada" };
  const from = d.env.get("SUPORTE_FROM") || "Suporte Adintus <suporte@adintus.com.br>";
  const body: any = { from, to: [o.to], subject: o.subject, html: o.html, text: o.text };
  if (o.replyTo) body.reply_to = o.replyTo;
  if (o.attach?.length) body.attachments = o.attach;
  const r = await d.fetchFn("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, id: j.id } : { ok: false, erro: String(j.message || r.status) };
}

const shell = (title: string, inner: string) =>
  `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;color:#16302e"><h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>${inner}<p style="color:#6b7f7d;font-size:12px;margin-top:22px">Adintus Saúde · suporte automático</p></div>`;

// ---------- triagem opcional por IA (só o texto do pedido; nunca o print) ----------
async function triagem(d: Deps, tipo: string, texto: string, pagina: string) {
  const key = d.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  try {
    const r = await d.fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: d.env.get("SUPORTE_MODEL") || "claude-haiku-5-5",
        max_tokens: 500,
        system: "Você faz a triagem de pedidos de ajuda de um prontuário eletrônico de clínica (Adintus Saúde). Responda SOMENTE um JSON com as chaves: categoria (duvida|erro|alteracao|outro), urgencia (alta|media|baixa; alta só se impede atender paciente ou parece perda de dados), resumo (uma frase em português), sugestao (rascunho curto e gentil de resposta ao usuário, em português, sem inventar funcionalidades). Não repita dados pessoais.",
        messages: [{ role: "user", content: `Tipo escolhido: ${tipo}\nTela: ${pagina}\nMensagem:\n${cut(texto, 1500)}` }],
      }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const t = String(j?.content?.[0]?.text || "");
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]);
    return { categoria: cut(o.categoria, 20), urgencia: cut(o.urgencia, 10), resumo: cut(o.resumo, 240), sugestao: cut(o.sugestao, 1200) };
  } catch (_) { return null; }
}

async function whoIs(d: Deps, req: Request) {
  const tk = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tk) return null;
  const { data: u } = await d.sb.auth.getUser(tk);
  const user = u?.user;
  const email = String(user?.email || "").toLowerCase();
  if (!user?.id || !email) return null;
  const { data: acc } = await d.sb.from("docs").select("data").eq("coll", "access").eq("id", user.id).maybeSingle();
  const adm = (d.env.get("SUPORTE_ADMIN_EMAILS") || d.env.get("AGENDA_ADMIN_EMAILS") || "administrativo@adintus.com.br").toLowerCase().split(",").map((s) => s.trim());
  const ativo = acc?.data?.active !== false;
  return { id: user.id as string, email, role: String(acc?.data?.role || ""), admin: (acc?.data?.role === "admin" && ativo) || adm.includes(email), ativo: ativo || adm.includes(email) };
}

// ---------- saúde: site e banco ----------
export async function checarSaude(d: Deps) {
  const site = (d.env.get("SITE_URL") || "https://prontuario.adintus.com.br").replace(/\/$/, "");
  const out: { site: boolean; banco: boolean; versao?: string; erro?: string } = { site: false, banco: false };
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await d.fetchFn(site + "/versao.json?x=" + Date.now(), { signal: ctl.signal }); clearTimeout(t);
    if (r.ok) { out.site = true; const j: any = await r.json().catch(() => ({})); out.versao = j?.v; } else out.erro = "site respondeu " + r.status;
  } catch (e) { out.erro = "site sem resposta"; }
  try {
    const { error } = await d.sb.from("docs").select("id").limit(1);
    out.banco = !error;
    if (error) out.erro = (out.erro ? out.erro + "; " : "") + "banco: " + cut(error.message, 80);
  } catch (e) { out.erro = (out.erro ? out.erro + "; " : "") + "banco sem resposta"; }
  return out;
}

async function getEstado(d: Deps, k: string) { const { data } = await d.sb.from("suporte_estado").select("valor").eq("chave", k).maybeSingle(); return data?.valor || null; }
async function setEstado(d: Deps, k: string, v: unknown) { await d.sb.from("suporte_estado").upsert({ chave: k, valor: v, atualizado: new Date().toISOString() }); }

export async function ping(d: Deps) {
  const to = d.env.get("SUPORTE_TO") || "administrativo@adintus.com.br";
  const s = await checarSaude(d);
  const ok = s.site && s.banco;
  const est: any = (await getEstado(d, "saude")) || { ok: true, falhas: 0, avisado: false };
  if (ok) {
    if (est.avisado) await sendMail(d, { to, subject: "[Adintus Saúde] Voltou ao normal", html: shell("Voltou ao normal", `<p>O site e o banco estão respondendo de novo.</p>`), text: "O site e o banco estão respondendo de novo." });
    await setEstado(d, "saude", { ok: true, falhas: 0, avisado: false, versao: s.versao || null });
    return { ok: true, ...s };
  }
  const falhas = (est.falhas || 0) + 1;
  let avisado = !!est.avisado;
  if (falhas >= 2 && !avisado) {
    const msg = `Falhou ${falhas} conferências seguidas (a cada 10 minutos). ${s.erro || ""}`;
    await sendMail(d, { to, subject: "[Adintus Saúde] ALERTA: o sistema não está respondendo", html: shell("O sistema não está respondendo", `<p>${esc(msg)}</p><p>Site: ${s.site ? "ok" : "fora"} · Banco: ${s.banco ? "ok" : "fora"}</p>`), text: msg });
    avisado = true;
  }
  await setEstado(d, "saude", { ok: false, falhas, avisado, desde: est.desde || new Date().toISOString() });
  return { ok: false, ...s, falhas };
}

export async function resumo(d: Deps) {
  const to = d.env.get("SUPORTE_TO") || "administrativo@adintus.com.br";
  const agora = (d.now ? d.now() : new Date());
  const h24 = new Date(agora.getTime() - 864e5).toISOString();
  const h48 = new Date(agora.getTime() - 2 * 864e5).toISOString();
  const { data: novos } = await d.sb.from("suporte_pedidos").select("id,criado,tipo,email,nome,resumo,texto,urgencia,status").gte("criado", h24).order("criado", { ascending: false }).limit(30);
  const { data: abertos } = await d.sb.from("suporte_pedidos").select("id,criado,tipo,nome,texto,status").neq("status", "resolvido").lt("criado", h48).order("criado").limit(20);
  const { data: erros } = await d.sb.from("suporte_erros").select("sig,msg,pagina,ver,qtd,primeiro,ultimo,resolvido").gte("ultimo", h24).order("qtd", { ascending: false }).limit(10);
  const s = await checarSaude(d);
  const li = (a: string) => `<li style="margin:4px 0">${a}</li>`;
  const pedidos = (novos || []).map((p: any) => li(`<b>${esc(TIPOS[p.tipo] || p.tipo)}</b> · ${esc(p.nome || p.email)} · ${fmtBR(p.criado)} — ${esc(cut(p.resumo || p.texto, 140))}`)).join("");
  const velhos = (abertos || []).map((p: any) => li(`${esc(TIPOS[p.tipo] || p.tipo)} · ${esc(p.nome || "")} · ${fmtBR(p.criado)} — ${esc(cut(p.texto, 100))}`)).join("");
  const errs = (erros || []).map((e: any) => li(`<b>${e.qtd}×</b> ${esc(cut(e.msg, 120))} <span style="color:#6b7f7d">(${esc(e.pagina || "?")}, versão ${esc(e.ver || "?")}${e.resolvido ? ", marcado como resolvido" : ""})</span>`)).join("");
  const saude = `Site: ${s.site ? "ok" : "FORA"} · Banco: ${s.banco ? "ok" : "FORA"}${s.versao ? " · versão no ar: " + esc(s.versao) : ""}${s.erro ? " · " + esc(s.erro) : ""}`;
  const nN = (novos || []).length, nE = (erros || []).length, nV = (abertos || []).length;
  const html = shell("Resumo do dia", `<p><b>Saúde:</b> ${saude}</p>` +
    `<p><b>Pedidos de ajuda nas últimas 24 h:</b> ${nN || "nenhum"}</p>${nN ? `<ul style="padding-left:18px">${pedidos}</ul>` : ""}` +
    `<p><b>Erros de tela nas últimas 24 h:</b> ${nE || "nenhum"}</p>${nE ? `<ul style="padding-left:18px">${errs}</ul>` : ""}` +
    (nV ? `<p><b>Pedidos sem resolver há mais de 2 dias:</b> ${nV}</p><ul style="padding-left:18px">${velhos}</ul>` : "") +
    `<p style="color:#6b7f7d">Responda e acompanhe pelo menu <b>Suporte</b> do sistema.</p>`);
  const text = `Resumo do dia\nSaúde: ${saude.replace(/<[^>]+>/g, "")}\nPedidos (24h): ${nN}\nErros (24h): ${nE}\nSem resolver há +2 dias: ${nV}`;
  const subj = `[Adintus Saúde] Resumo do dia: ${nN} pedido(s), ${nE} erro(s)${s.site && s.banco ? "" : " · ATENÇÃO: sistema fora"}`;
  const m = await sendMail(d, { to, subject: subj, html, text });
  return { enviado: m.ok, erro: m.erro, pedidos: nN, erros: nE, saude: s };
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  try {
    const body: any = await req.json().catch(() => ({}));
    const secret = d.env.get("AGENDA_CRON_SECRET");
    const cron = !!secret && req.headers.get("x-cron-secret") === secret;
    const acao = String(body.acao || "");
    if (cron) {
      if (acao === "resumo") return json(await resumo(d));
      if (acao === "ping") return json(await ping(d));
      return json({ erro: "Ação agendada desconhecida." }, 400);
    }
    const me = await whoIs(d, req);
    if (!me) return json({ erro: "Entre no sistema." }, 401);
    if (!me.ativo) return json({ erro: "Acesso inativo." }, 403);
    const to = d.env.get("SUPORTE_TO") || "administrativo@adintus.com.br";

    if (acao === "pedido") {
      const tipo = TIPOS[body.tipo] ? String(body.tipo) : "duvida";
      const texto = cut(body.texto, 4000).trim();
      if (texto.length < 5) return json({ erro: "Escreva o que aconteceu, com pelo menos uma frase." }, 400);
      const h1 = new Date((d.now ? d.now() : new Date()).getTime() - 36e5).toISOString();
      const { count } = await d.sb.from("suporte_pedidos").select("id", { count: "exact", head: true }).eq("user_id", me.id).gte("criado", h1);
      if ((count || 0) >= 10) return json({ erro: "Muitos pedidos em pouco tempo. Aguarde um pouco e tente de novo." }, 429);
      let print = String(body.print || "");
      if (print && (!/^data:image\/(jpeg|png|webp);base64,/.test(print) || print.length > 1_400_000)) print = "";
      const ctx = { pagina: cut(body.ctx?.pagina, 40), ver: cut(body.ctx?.ver, 30), nav: cut(body.ctx?.nav, 200), tela: cut(body.ctx?.tela, 20), papel: me.role };
      const nome = cut(body.nome, 80);
      const tri = await triagem(d, tipo, texto, ctx.pagina);
      const row: any = { user_id: me.id, email: me.email, nome, tipo, texto, ctx, print: print || null, status: "novo", categoria: tri?.categoria || null, urgencia: tri?.urgencia || null, resumo: tri?.resumo || null, sugestao: tri?.sugestao || null };
      const { data: ins, error } = await d.sb.from("suporte_pedidos").insert(row).select("id,criado").single();
      if (error) { console.error(error); return json({ erro: "Não foi possível guardar o pedido." }, 500); }
      const urg = tri?.urgencia === "alta" ? " · URGENTE" : "";
      const inner =
        `<p><b>${esc(TIPOS[tipo])}</b>${urg} · ${esc(nome || me.email)} (${esc(me.email)})</p>` +
        (tri?.resumo ? `<p style="background:#eef6f5;padding:8px 10px;border-radius:8px"><b>Resumo da triagem:</b> ${esc(tri.resumo)}</p>` : "") +
        `<p style="white-space:pre-wrap;border-left:3px solid #c8d8d6;padding-left:10px">${esc(texto)}</p>` +
        `<p style="color:#6b7f7d;font-size:13px">Tela: ${esc(ctx.pagina || "?")} · versão ${esc(ctx.ver || "?")} · ${esc(ctx.nav)}${print ? "<br>Print em anexo." : ""}</p>` +
        (tri?.sugestao ? `<p><b>Rascunho de resposta:</b></p><p style="white-space:pre-wrap;color:#34504d">${esc(tri.sugestao)}</p>` : "") +
        `<p>Para responder e marcar como resolvido, use o menu <b>Suporte</b> no sistema.</p>`;
      const att = print ? [{ filename: "print.jpg", content: print.replace(/^data:[^,]+,/, "") }] : undefined;
      const m = await sendMail(d, { to, subject: `[Suporte] ${TIPOS[tipo]}${urg}: ${cut(tri?.resumo || texto, 70)}`, html: shell("Novo pedido de ajuda", inner), text: `${TIPOS[tipo]} de ${nome || me.email}\n\n${texto}`, replyTo: me.email, attach: att });
      return json({ ok: true, id: ins.id, aviso: m.ok ? "" : "Pedido guardado. O aviso por e-mail ao administrador falhou, mas ele verá no menu Suporte." });
    }

    if (acao === "meus") {
      const { data } = await d.sb.from("suporte_pedidos").select("id,criado,tipo,texto,status,resposta,respondido").eq("user_id", me.id).order("criado", { ascending: false }).limit(30);
      return json({ pedidos: data || [] });
    }

    if (acao === "erro") {
      const lista: any[] = Array.isArray(body.erros) ? body.erros.slice(0, 10) : [];
      let novos = 0;
      for (const e of lista) {
        const sig = cut(e.sig, 40); if (!/^[a-z0-9]{4,40}$/.test(sig)) continue;
        const msg = cut(e.msg, 300), stack = cut(e.stack, 700), pagina = cut(e.pagina, 40), ver = cut(e.ver, 30);
        const { data: ex } = await d.sb.from("suporte_erros").select("sig,qtd,avisado,usuarios").eq("sig", sig).maybeSingle();
        const agora = new Date().toISOString();
        if (ex) {
          const us: string[] = Array.isArray(ex.usuarios) ? ex.usuarios : [];
          if (!us.includes(me.email) && us.length < 20) us.push(me.email);
          await d.sb.from("suporte_erros").update({ qtd: (ex.qtd || 0) + Math.max(1, Math.min(50, +e.n || 1)), ultimo: agora, ver, pagina, usuarios: us }).eq("sig", sig);
        } else {
          await d.sb.from("suporte_erros").insert({ sig, msg, stack, pagina, ver, qtd: Math.max(1, Math.min(50, +e.n || 1)), primeiro: agora, ultimo: agora, usuarios: [me.email], avisado: false });
          novos++;
        }
      }
      if (novos) {
        const h1 = new Date(Date.now() - 36e5).toISOString();
        const { count } = await d.sb.from("suporte_erros").select("sig", { count: "exact", head: true }).eq("avisado", true).gte("primeiro", h1);
        if ((count || 0) < 5) {
          const { data: pend } = await d.sb.from("suporte_erros").select("sig,msg,pagina,ver,stack").eq("avisado", false).order("primeiro", { ascending: false }).limit(3);
          for (const p of pend || []) {
            await sendMail(d, { to, subject: `[Adintus Saúde] Erro novo na tela: ${cut(p.msg, 70)}`, html: shell("Erro novo detectado", `<p><b>${esc(p.msg)}</b></p><p style="color:#6b7f7d;font-size:13px">Tela: ${esc(p.pagina || "?")} · versão ${esc(p.ver || "?")}</p><pre style="white-space:pre-wrap;font-size:12px;background:#f3f6f6;padding:8px;border-radius:8px">${esc(p.stack)}</pre>`), text: `Erro novo: ${p.msg}\n${p.stack}` });
            await d.sb.from("suporte_erros").update({ avisado: true }).eq("sig", p.sig);
          }
        }
      }
      return json({ ok: true });
    }

    // ---- daqui em diante, só administrador ----
    if (!me.admin) return json({ erro: "Só o administrador acessa isto." }, 403);

    if (acao === "lista") {
      const { data: ped } = await d.sb.from("suporte_pedidos").select("id,criado,email,nome,tipo,texto,ctx,status,categoria,urgencia,resumo,sugestao,resposta,respondido,print").order("criado", { ascending: false }).limit(60);
      const { data: err } = await d.sb.from("suporte_erros").select("sig,msg,stack,pagina,ver,qtd,primeiro,ultimo,usuarios,resolvido").order("ultimo", { ascending: false }).limit(40);
      const saude = await getEstado(d, "saude");
      return json({ pedidos: ped || [], erros: err || [], saude });
    }

    if (acao === "responder") {
      const id = String(body.id || "");
      const status = STATUS.includes(body.status) ? body.status : "em andamento";
      const resposta = cut(body.resposta, 3000).trim();
      const { data: p } = await d.sb.from("suporte_pedidos").select("id,email,nome,texto,tipo").eq("id", id).maybeSingle();
      if (!p) return json({ erro: "Pedido não encontrado." }, 404);
      const upd: any = { status };
      if (resposta) { upd.resposta = resposta; upd.respondido = new Date().toISOString(); }
      await d.sb.from("suporte_pedidos").update(upd).eq("id", id);
      let mailed = false;
      if (resposta && body.avisar !== false) {
        const m = await sendMail(d, { to: p.email, subject: "Sobre o seu pedido de ajuda no Adintus Saúde", html: shell("Resposta ao seu pedido", `<p style="white-space:pre-wrap">${esc(resposta)}</p><p style="color:#6b7f7d;font-size:13px">Seu pedido: ${esc(cut(p.texto, 200))}</p>`), text: resposta, replyTo: to });
        mailed = m.ok;
      }
      return json({ ok: true, emailEnviado: mailed });
    }

    if (acao === "erro_resolver") {
      await d.sb.from("suporte_erros").update({ resolvido: body.resolvido !== false }).eq("sig", cut(body.sig, 40));
      return json({ ok: true });
    }

    return json({ erro: "Ação desconhecida." }, 400);
  } catch (e) { console.error(e); return json({ erro: "Erro inesperado." }, 500); }
}

if (typeof Deno !== "undefined" && Deno.serve) {
  // @ts-ignore (módulo remoto do Deno)
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  Deno.serve((req: Request) => handle(req, { sb, env: { get: (k: string) => Deno.env.get(k) }, fetchFn: fetch }));
}
