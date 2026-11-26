// Adintus Saúde · função "adintus-link" (Supabase Edge Function)
// Link do paciente: o profissional libera documentos/curvas/evolução, o paciente abre por um link
// protegido (data de nascimento + 4 primeiros dígitos do CPF). Validade 30 dias, revogável.
// Ações: criar, listar, revogar, reenviar, url (equipe, com login) e abrir (paciente, sem login).
// Secrets: RESEND_API_KEY (já existe). Opcionais: LINK_FROM, LINK_BASE, AGENDA_ADMIN_EMAILS, GOOGLE_REVIEW_URL, AVALIACAO_MIMO, EMAIL_LOGO_URL.
// "Verify JWT with legacy secret" precisa ficar DESLIGADO: o paciente abre sem login; a equipe é conferida aqui.

export const DIAS = 30, MAX_TENT = 5, BLOQ_MIN = 30;
// proteções contra excesso (invisíveis no uso normal): repetição, ritmo e tamanho
export const MAX_HORA = 30, MAX_BYTES = 3_000_000, DEDUP_MIN = 10;
export type Row = Record<string, any>;
export interface Db {
  insert(r: Row): Promise<Row>;
  byId(id: string): Promise<Row | null>;
  byToken(t: string): Promise<Row | null>;
  list(pid: string): Promise<Row[]>;
  update(id: string, patch: Row): Promise<void>;
  recent(pid: string, hash: string, desde: string): Promise<Row | null>;
  contar(staffId: string, desde: string): Promise<number>;
  ativo(pid: string, agoraIso: string): Promise<Row | null>;
}
export interface Mailer { send(to: string, subject: string, html: string, text: string, from: string): Promise<{ ok: boolean; erro?: string }>; }
export interface Staff { id: string; nome: string; role: string; }

const onlyDigits = (s: any) => String(s || "").replace(/\D/g, "");
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
export const emailOk = (v: any) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(v || "").trim());
const brDate = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }); };
const cleanName = (s: any) => String(s || "").replace(/[<>"\r\n]/g, "").trim().slice(0, 80);

async function sha(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function novoToken(): string {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function statusDe(r: Row, agora = Date.now()): string {
  if (r.revoked_at) return "revogado";
  if (new Date(r.expires_at).getTime() < agora) return "vencido";
  return "ativo";
}
// Bloco opcional de avaliação no Google (aparece só no 1º envio do link, se GOOGLE_REVIEW_URL estiver configurado).
// Todas as estrelas levam ao Google, qualquer nota: o Google proíbe filtrar quem avalia ou dar algo em troca da avaliação.
// O "mimo" (AVALIACAO_MIMO) é um presente para TODOS os pacientes, sem depender de avaliar.
export interface Extra { review?: string; mimo?: string; logo?: string; }
function blocoAvaliacao(clinic: string, x: Extra) {
  const rv = String(x.review || "").trim();
  if (!/^https:\/\//i.test(rv)) return { html: "", text: "" };
  const mimo = String(x.mimo || "").replace(/[<>\r\n]/g, "").trim().slice(0, 200);
  const est = [1, 2, 3, 4, 5].map((n) => `<td style="padding:0 3px"><a href="${esc(rv)}" title="${n} estrela${n > 1 ? "s" : ""}" style="text-decoration:none;font-size:34px;line-height:38px;color:#f5b301">&#9733;</a></td>`).join("");
  const html = `<div style="margin:24px 0 0;padding:18px 16px;border:1px solid #e3ecee;border-radius:14px;background:#f7fbfb;text-align:center">
<div style="font-size:16px;font-weight:700;color:#004346;margin-bottom:4px">Como foi sua experiência?</div>
<div style="font-size:13px;color:#4b6468;margin-bottom:10px">Toque nas estrelas e conte no Google. Leva menos de 1 minuto e ajuda outras famílias a conhecerem a ${esc(clinic)}.</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 12px"><tr>${est}</tr></table>
<a href="${esc(rv)}" style="background:#ffffff;color:#2f7f8f;border:1px solid #2f7f8f;text-decoration:none;padding:9px 16px;border-radius:10px;font-weight:700;font-size:14px;display:inline-block">Avaliar no Google</a>
${mimo ? `<div style="margin:16px 0 0;padding:12px;border-radius:10px;background:#fff7e0;color:#6b4e00;font-size:13px"><b>&#127873; Um presente para você:</b> ${esc(mimo)}</div>` : ""}
<div style="margin-top:10px;font-size:12px;color:#8aa0a4">Sua opinião sincera, seja qual for, é muito bem-vinda.</div></div>`;
  const text = `\n\nComo foi sua experiência? Conte no Google (menos de 1 minuto): ${rv}${mimo ? "\n\nUm presente para você: " + mimo : ""}`;
  return { html, text };
}
export function mailLink(clinic: string, pname: string, prof: string, url: string, ate: string, itens: string, extra: Extra = {}) {
  const subject = "Seus documentos da consulta";
  const av = blocoAvaliacao(clinic, extra);
  const text = `Olá! Os documentos de ${pname}${prof ? " (" + prof + ")" : ""} já estão disponíveis (${itens}).\n\nAbrir: ${url}\n\nPara sua segurança, você vai confirmar a data de nascimento e os 4 primeiros dígitos do CPF. O link vale até ${ate}.${av.text}\n\n${clinic}`;
  const logo = String(extra.logo || "").trim();
  const topo = /^https:\/\//i.test(logo)
    ? `<img src="${esc(logo)}" alt="${esc(clinic)}" width="180" style="display:block;margin:0 auto;width:180px;max-width:70%;height:auto;border:0">`
    : `<div style="font-size:20px;font-weight:700;color:#ffffff;text-align:center">${esc(clinic)}</div>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1b2b2d;border:1px solid #e3ecee;border-radius:14px;overflow:hidden">
<div style="background:#004346;padding:18px 20px">${topo}</div><div style="padding:20px">
<p style="margin:0 0 10px">Olá! Os documentos de <b>${esc(pname)}</b>${prof ? " com " + esc(prof) : ""} já estão disponíveis.</p><p style="margin:0 0 16px;color:#4b6468">${esc(itens)}</p>
<p style="margin:0 0 18px"><a href="${esc(url)}" style="background:#2f7f8f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;display:inline-block">Abrir meus documentos</a></p>
<p style="margin:0;color:#5b7377;font-size:13px">Para sua segurança, você vai confirmar a data de nascimento e os 4 primeiros dígitos do CPF. O link vale até ${esc(ate)}.</p>${av.html}
<p style="margin:18px 0 0;color:#8aa0a4;font-size:12px">Se você não esperava este e-mail, ignore-o.</p></div></div>`;
  return { subject, html, text };
}

export async function handle(body: any, db: Db, mailer: Mailer, staff: Staff | null, cfg: { base: string; from: string; review?: string; mimo?: string; logo?: string }, agora = Date.now()) {
  const acao = String(body?.acao || "");
  // ---------- paciente (sem login) ----------
  if (acao === "abrir") {
    const r = await db.byToken(String(body.token || ""));
    if (!r) return { st: 404, j: { erro: "invalido" } };
    if (r.revoked_at) return { st: 410, j: { erro: "revogado" } };
    if (new Date(r.expires_at).getTime() < agora) return { st: 410, j: { erro: "vencido" } };
    if (r.locked_until && new Date(r.locked_until).getTime() > agora) return { st: 429, j: { erro: "bloqueado", ate: r.locked_until } };
    const nasc = String(body.nasc || ""), c4 = onlyDigits(body.cpf4).slice(0, 4);
    const okN = !!r.v_nasc && nasc === r.v_nasc, okC = !r.v_cpf4 || c4 === r.v_cpf4;
    if (!(okN && okC)) {
      const t = (r.tries || 0) + 1;
      if (t >= MAX_TENT) { await db.update(r.id, { tries: 0, locked_until: new Date(agora + BLOQ_MIN * 60000).toISOString() }); return { st: 429, j: { erro: "bloqueado" } }; }
      await db.update(r.id, { tries: t });
      return { st: 401, j: { erro: "dados", restam: MAX_TENT - t } };
    }
    await db.update(r.id, { tries: 0, ...(r.opened_at ? {} : { opened_at: new Date(agora).toISOString() }) });
    return { st: 200, j: { pname: r.pname, clinic: r.clinic, ate: r.expires_at, docs: r.docs || [], exigeCpf: !!r.v_cpf4 } };
  }
  // ---------- equipe (com login) ----------
  if (!staff) return { st: 401, j: { erro: "Entre no sistema." } };
  const pode = (role: string) => role === "profissional" || role === "recepcao" || role === "admin";
  if (!pode(staff.role)) return { st: 403, j: { erro: "Sem permissão." } };
  if (acao === "listar") {
    const rows = await db.list(String(body.pid || ""));
    return { st: 200, j: { links: rows.map((r) => ({ id: r.id, itens: r.itens, por: r.created_by_name, criado: r.created_at, expira: r.expires_at, aberto: !!r.opened_at, revogado: !!r.revoked_at, vencido: statusDe(r, agora) === "vencido", email: r.email })) } };
  }
  if (acao === "revogar") {
    const r = await db.byId(String(body.id || "")); if (!r) return { st: 404, j: { erro: "Link não encontrado." } };
    await db.update(r.id, { revoked_at: new Date(agora).toISOString() }); return { st: 200, j: { ok: true } };
  }
  if (acao === "url") {
    const r = await db.byId(String(body.id || "")); if (!r) return { st: 404, j: { erro: "Link não encontrado." } };
    if (statusDe(r, agora) !== "ativo") return { st: 409, j: { erro: "Este link não está mais ativo." } };
    await db.update(r.id, { wa_at: new Date(agora).toISOString() });
    return { st: 200, j: { url: cfg.base + r.token, expira: r.expires_at } };
  }
  if (acao === "reenviar") {
    const r = await db.byId(String(body.id || "")); if (!r) return { st: 404, j: { erro: "Link não encontrado." } };
    if (statusDe(r, agora) !== "ativo") return { st: 409, j: { erro: "Este link não está mais ativo." } };
    const to = String(body.email || r.email || "").trim(); if (!emailOk(to)) return { st: 400, j: { erro: "E-mail inválido." } };
    const clinic = cleanName(body.clinic || r.clinic) || "Adintus Saúde";
    const m = mailLink(clinic, r.pname, "", cfg.base + r.token, brDate(r.expires_at), r.itens || "Documentos", { logo: cfg.logo });
    const e = await mailer.send(to, m.subject, m.html, m.text, `${clinic} via Adintus <${cfg.from}>`);
    if (e.ok) await db.update(r.id, { sent_at: new Date(agora).toISOString(), email: to });
    return { st: 200, j: { enviado: e.ok, erroEmail: e.erro } };
  }
  if (acao === "criar") {
    const docs = Array.isArray(body.docs) ? body.docs.filter((d: any) => d && typeof d.h === "string" && d.h.length > 20).slice(0, 40).map((d: any) => ({ t: String(d.t || "Documento").slice(0, 120), d: String(d.d || "").slice(0, 10), h: d.h })) : [];
    if (!docs.length) return { st: 400, j: { erro: "Nada para enviar." } };
    const pid = String(body.pid || ""), nasc = String(body.nasc || "");
    if (!pid || !/^\d{4}-\d{2}-\d{2}$/.test(nasc)) return { st: 400, j: { erro: "O paciente precisa ter data de nascimento na ficha." } };
    const bytes = new TextEncoder().encode(JSON.stringify(docs)).length;
    if (bytes > MAX_BYTES) return { st: 413, j: { erro: "Os documentos ficaram grandes demais para um link. Envie menos itens por vez." } };
    const hash = await sha(pid + "|" + docs.map((d: any) => d.t + "\u0000" + d.h).join("\u0001"));
    const igual = await db.recent(pid, hash, new Date(agora - DEDUP_MIN * 60000).toISOString());
    if (igual) return { st: 200, j: { id: igual.id, enviado: false, reaproveitado: true, expira: igual.expires_at } };
    // um único link por paciente: se já existe um ativo, os documentos novos entram nele e o endereço continua o mesmo
    const ex = await db.ativo(pid, new Date(agora).toISOString());
    if (ex) {
      const unicos = new Set(["Curvas de crescimento", "Evolução nutricional"]);
      const novosT = new Set(docs.map((d: any) => d.t));
      const antigos = (Array.isArray(ex.docs) ? ex.docs : []).filter((o: any) => !docs.some((d: any) => d.t === o.t && d.d === o.d) && !(unicos.has(o.t) && novosT.has(o.t)));
      const juntos = antigos.concat(docs).slice(-40);
      if (new TextEncoder().encode(JSON.stringify(juntos)).length > MAX_BYTES) return { st: 413, j: { erro: "Os documentos ficaram grandes demais para um link. Revogue o link atual e envie menos itens." } };
      const cpfx = onlyDigits(body.cpf);
      const itensx = juntos.map((d: any) => d.t).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ").slice(0, 300);
      const expx = new Date(agora + DIAS * 86400000).toISOString();
      await db.update(ex.id, { docs: juntos, itens: itensx, dedupe: hash, expires_at: expx, v_nasc: nasc, ...(cpfx.length >= 4 ? { v_cpf4: cpfx.slice(0, 4) } : {}) });
      let enviadoX = false, erroX: string | undefined;
      if (body.enviar === true) {
        if (!emailOk(body.email)) erroX = "O paciente não tem e-mail válido na ficha.";
        else {
          const clinicX = cleanName(body.clinic) || ex.clinic || "Adintus Saúde";
          const m = mailLink(clinicX, cleanName(body.pname) || ex.pname, cleanName(body.prof), cfg.base + ex.token, brDate(expx), itensx, { logo: cfg.logo });
          const e = await mailer.send(String(body.email).trim(), m.subject, m.html, m.text, `${clinicX} via Adintus <${cfg.from}>`);
          enviadoX = e.ok; erroX = e.erro;
          if (e.ok) await db.update(ex.id, { sent_at: new Date(agora).toISOString() });
        }
      }
      return { st: 200, j: { id: ex.id, enviado: enviadoX, erroEmail: erroX, expira: expx, mesmoLink: true } };
    }
    if ((await db.contar(staff.id, new Date(agora - 3600000).toISOString())) >= MAX_HORA) return { st: 429, j: { erro: "Muitos links gerados na última hora. Aguarde um pouco e tente de novo." } };
    const cpf = onlyDigits(body.cpf);
    const token = novoToken(), exp = new Date(agora + DIAS * 86400000).toISOString();
    const clinic = cleanName(body.clinic) || "Adintus Saúde", pname = cleanName(body.pname), prof = cleanName(body.prof);
    const itens = docs.map((d: any) => d.t).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ").slice(0, 300);
    const row = await db.insert({ token, pid, pname, clinic, itens, docs, dedupe: hash, email: String(body.email || "").trim().toLowerCase() || null, v_nasc: nasc, v_cpf4: cpf.length >= 4 ? cpf.slice(0, 4) : null, expires_at: exp, created_by: staff.id, created_by_name: staff.nome || prof });
    let enviado = false, erroEmail: string | undefined;
    if (body.enviar === true) {
      if (!emailOk(body.email)) erroEmail = "O paciente não tem e-mail válido na ficha.";
      else {
        const m = mailLink(clinic, pname, prof, cfg.base + token, brDate(exp), itens, { review: cfg.review, mimo: cfg.mimo, logo: cfg.logo });
        const e = await mailer.send(String(body.email).trim(), m.subject, m.html, m.text, `${clinic} via Adintus <${cfg.from}>`);
        enviado = e.ok; erroEmail = e.erro;
        if (e.ok) await db.update(row.id, { sent_at: new Date(agora).toISOString() });
      }
    }
    return { st: 200, j: { id: row.id, enviado, erroEmail, expira: exp } };
  }
  return { st: 400, j: { erro: "Ação desconhecida." } };
}

// ---------- Supabase ----------
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...CORS, "content-type": "application/json" } });
// @ts-ignore
if (typeof Deno !== "undefined" && Deno.serve) {
  // @ts-ignore
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  // @ts-ignore
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const T = "patient_links";
  const db: Db = {
    async insert(r) { const { data, error } = await sb.from(T).insert(r).select("id").single(); if (error) throw error; return data; },
    async byId(id) { const { data } = await sb.from(T).select("*").eq("id", id).maybeSingle(); return data; },
    async byToken(t) { if (!t || t.length < 20) return null; const { data } = await sb.from(T).select("*").eq("token", t).maybeSingle(); return data; },
    async list(pid) { const { data, error } = await sb.from(T).select("id,itens,created_by_name,created_at,expires_at,opened_at,revoked_at,email").eq("pid", pid).order("created_at", { ascending: false }).limit(30); if (error) throw error; return data || []; },
    async recent(pid, hash, desde) { const { data } = await sb.from(T).select("id,expires_at").eq("pid", pid).eq("dedupe", hash).gte("created_at", desde).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(); return data; },
    async ativo(pid, agoraIso) { const { data } = await sb.from(T).select("id,token,docs,clinic,pname,expires_at").eq("pid", pid).is("revoked_at", null).gt("expires_at", agoraIso).order("created_at", { ascending: false }).limit(1).maybeSingle(); return data; },
    async contar(staffId, desde) { const { count } = await sb.from(T).select("id", { count: "exact", head: true }).eq("created_by", staffId).gte("created_at", desde); return count || 0; },
    async update(id, patch) { const { error } = await sb.from(T).update(patch).eq("id", id); if (error) throw error; },
  };
  const mailer: Mailer = {
    async send(to, subject, html, text, from) {
      // @ts-ignore
      const key = Deno.env.get("RESEND_API_KEY"); if (!key) return { ok: false, erro: "RESEND_API_KEY não configurada" };
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html, text }) });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true } : { ok: false, erro: String(j.message || r.status) };
    },
  };
  // @ts-ignore
  const cfg = { base: Deno.env.get("LINK_BASE") || "https://prontuario.adintus.com.br/p.html#", from: (Deno.env.get("LINK_FROM") || "agenda@adintus.com.br"), review: Deno.env.get("GOOGLE_REVIEW_URL") || "", mimo: Deno.env.get("AVALIACAO_MIMO") || "", logo: Deno.env.get("EMAIL_LOGO_URL") ?? "https://prontuario.adintus.com.br/logo-email.png" };
  // @ts-ignore
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
    try {
      const body = await req.json().catch(() => ({}));
      let staff: Staff | null = null;
      if (body.acao !== "abrir") {
        const tk = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        const { data: u } = await sb.auth.getUser(tk);
        if (u?.user?.id) {
          // o perfil do usuário fica na tabela profiles (não em docs)
          const { data: pr } = await sb.from("profiles").select("name,role,active").eq("id", u.user.id).maybeSingle();
          const acc = pr ? { data: { role: pr.role === "pendente" ? "" : pr.role, active: pr.active, name: pr.name } } : null;
          // @ts-ignore
          const adm = (Deno.env.get("AGENDA_ADMIN_EMAILS") || "administrativo@adintus.com.br").toLowerCase().split(",").map((s: string) => s.trim());
          const role = acc?.data?.active === false ? "none" : (acc?.data?.role || (adm.includes((u.user.email || "").toLowerCase()) ? "admin" : "none"));
          staff = { id: u.user.id, nome: String(acc?.data?.name || acc?.data?.nome || u.user.email || ""), role };
        }
      }
      const r = await handle(body, db, mailer, staff, cfg);
      return json(r.j, r.st);
    } catch (e) { console.error(e); return json({ erro: "Erro inesperado." }, 500); }
  });
}
