// Adintus Saúde · e-mail noturno da agenda (Supabase Edge Function "adintus-agenda-email") · versão 1.0
// Todo dia (horário combinado) envia a cada profissional a agenda do DIA SEGUINTE, no e-mail cadastrado dele.
// - Só vai nome do paciente, horário, procedimento e sala. Nunca prontuário, valores, CPF ou telefone.
// - Só recebe quem tem paciente agendado no dia seguinte. Sem paciente agendado, não envia nada.
// - Sem cópia para recepção/administração.
// - Chamadas: (1) agendada, com o cabeçalho x-cron-secret; (2) botão "Enviar teste agora" do sistema,
//   com o login do administrador: {"teste":true,"prof":"<id>"} envia SÓ para o e-mail do próprio administrador.
// Segredos necessários (Supabase › Edge Functions › Secrets): RESEND_API_KEY, AGENDA_CRON_SECRET.
// Opcionais: AGENDA_FROM (padrão "Agenda Adintus <agenda@adintus.com.br>"), AGENDA_ADMIN_EMAILS (e-mails que podem testar, separados por vírgula).
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-cron-secret, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const TZ = "America/Sao_Paulo";
const OFF: Record<number, number> = { 11: 1, 22: 1, 15: 1 }; // desmarcado, cancelado, remarcado
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const hm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
function todayBR(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p; // AAAA-MM-DD
}
const addDays = (s: string, n: number) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const longDate = (s: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "long" }).format(new Date(s + "T12:00:00Z"));
const validMail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

type Row = { id: string; data: any };
const easterOf = (y: number) => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451); return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1)); };
const holIso = (d: Date, n = 0) => new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);
function holOf(cfg: any, date: string): string | null {
  const y = +date.slice(0, 4), E = easterOf(y), f = (m: number, d: number) => y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  const base: [string, string, boolean][] = [[f(1, 1), "Confraternização Universal", true], [holIso(E, -48), "Carnaval", false], [holIso(E, -47), "Carnaval", false], [holIso(E, -2), "Sexta-feira Santa", true], [f(4, 21), "Tiradentes e aniversário de Brasília", true], [f(5, 1), "Dia do Trabalho", true], [holIso(E, 60), "Corpus Christi", false], [f(9, 7), "Independência do Brasil", true], [f(10, 12), "Nossa Senhora Aparecida", true], [f(11, 2), "Finados", true], [f(11, 15), "Proclamação da República", true], [f(11, 20), "Dia da Consciência Negra", true], [f(11, 30), "Dia do Evangélico", true], [f(12, 25), "Natal", true]];
  const off = cfg?.off || {}, on = cfg?.on || {};
  for (const [d, n, def] of base) if (d === date && (def ? !off[d] : !!on[d])) return n;
  for (const c of (cfg?.custom || []) as any[]) if (c?.date === date) return String(c.name || "Dia fechado");
  return null;
}
const dow = (s: string) => new Date(s + "T12:00:00Z").getUTCDay();
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
// o profissional atende nesse dia? (grade semanal + horários extras abertos, menos feriado/dia fechado)
function works(p: any, date: string, blocks: Row[], closed: Set<string>, hol: any): boolean {
  if (closed.has(date) || holOf(hol, date)) return false;
  let s: any[] = [];
  if (p.sched) s = p.sched[dow(date)] || [];
  else if ((p.days || []).includes(dow(date))) s = [[p.from, p.to]];
  if (s.length) return true;
  return blocks.some((b) => b.data.open && b.data.prof === p.__id && b.data.date <= date && (b.data.dateEnd || b.data.date) >= date);
}

export interface Store {
  rows(coll: string, f?: { eq?: [string, string] }): Promise<Row[]>;
  get(coll: string, id: string): Promise<Row | null>;
}
export interface Mailer { send(to: string, subject: string, html: string, text: string): Promise<{ ok: boolean; id?: string; erro?: string }>; }

export function buildMail(prof: string, date: string, list: any[]) {
  const first = (prof || "").split(" ").slice(0, 2).join(" ");
  const n = list.length;
  const title = `Agenda de ${longDate(date)}`;
  if (!n) {
    const sub = `Sua agenda de amanhã (${date.slice(8)}/${date.slice(5, 7)}): sem pacientes`;
    const html0 = `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,Helvetica,sans-serif;color:#1f2a27"><div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #dfe5e2;border-radius:12px;padding:22px"><p style="margin:0 0 4px;font-size:13px;color:#5b6b66">Adintus Saúde</p><h1 style="margin:0 0 6px;font-size:20px">${esc(title)}</h1><p style="margin:0;font-size:15px">Olá, ${esc(first)}. Você <b>não tem pacientes agendados</b> amanhã.</p><p style="margin:18px 0 0;font-size:12px;color:#7a8883">Mensagem automática com a agenda do dia seguinte, enviada só para você. Se alguém agendar depois, aparece no sistema.</p></div></div></body></html>`;
    return { subject: sub, html: html0, text: `${title}\nOlá, ${first}. Você não tem pacientes agendados amanhã.\n\nMensagem automática do Adintus Saúde.` };
  }
  const rows = list.map((a) => {
    const det = [a.data.proc || (a.data.retorno ? "Retorno" : "Consulta"), a.data.local].filter(Boolean).join(" · ");
    return { h: `${hm(a.data.start)}–${hm(a.data.start + (a.data.dur || 0))}`, nome: a.data.pac || "Paciente", det, obs: a.data.encaixe ? "encaixe" : "" };
  });
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,Helvetica,sans-serif;color:#1f2a27">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border:1px solid #dfe5e2;border-radius:12px;padding:22px">
<p style="margin:0 0 4px;font-size:13px;color:#5b6b66">Adintus Saúde</p>
<h1 style="margin:0 0 6px;font-size:20px">${esc(title)}</h1>
<p style="margin:0 0 16px;font-size:15px">Olá, ${esc(first)}. Você tem <b>${n} ${n === 1 ? "paciente agendado" : "pacientes agendados"}</b> amanhã.</p>
<table style="width:100%;border-collapse:collapse;font-size:15px">
${rows.map((r) => `<tr><td style="padding:10px 8px;border-top:1px solid #e8eeeb;white-space:nowrap;vertical-align:top;font-weight:bold">${esc(r.h)}</td><td style="padding:10px 8px;border-top:1px solid #e8eeeb"><b>${esc(r.nome)}</b>${r.obs ? ` <span style="color:#8a6d00">(${esc(r.obs)})</span>` : ""}<br><span style="color:#5b6b66;font-size:13px">${esc(r.det)}</span></td></tr>`).join("")}
</table>
<p style="margin:18px 0 0;font-size:12px;color:#7a8883">Mensagem automática com a agenda do dia seguinte, enviada só para você. Alterações feitas depois do envio aparecem no sistema.</p>
</div></div></body></html>`;
  const text = `${title}\nOlá, ${first}. Você tem ${n} ${n === 1 ? "paciente agendado" : "pacientes agendados"} amanhã.\n\n` + rows.map((r) => `${r.h}  ${r.nome}${r.obs ? " (" + r.obs + ")" : ""} — ${r.det}`).join("\n") + "\n\nMensagem automática do Adintus Saúde.";
  return { subject: `Sua agenda de amanhã (${date.slice(8)}/${date.slice(5, 7)}): ${n} ${n === 1 ? "paciente" : "pacientes"}`, html, text };
}

// Monta (e envia) a agenda de um dia. toOverride = e-mail de teste. force = ignora o "desligado" do cadastro.
export async function run(store: Store, mailer: Mailer, opts: { date: string; onlyProf?: string; toOverride?: string; dry?: boolean; force?: boolean; teste?: boolean }) {
  const [profs, pdata, appts, blocks, closedDoc, holDoc] = await Promise.all([store.rows("professionals"), store.rows("profdata"), store.rows("appointments", { eq: ["date", opts.date] }), store.rows("blocks"), store.get("config", "closed"), store.get("config", "holidays")]);
  const closed = new Set<string>(); ((closedDoc?.data?.list || closedDoc?.data?.dates || []) as any[]).forEach((x) => { const d = typeof x === "string" ? x : x?.date; if (isDate(d)) closed.add(d); });
  const out: any[] = [];
  for (const p of profs) {
    if (opts.onlyProf && p.id !== opts.onlyProf) continue;
    if (p.data.active === false) continue;
    const pd = pdata.find((x) => x.id === p.id)?.data || {};
    const mail = String(pd.mail || "").trim();
    if (!opts.toOverride && !opts.force && pd.agendaMail === false) { out.push({ prof: p.data.name, enviado: false, motivo: "desligado no cadastro" }); continue; }
    const list = appts.filter((a) => a.data.prof === p.id && !OFF[a.data.status]).sort((a, b) => a.data.start - b.data.start);
    // só envia quando há paciente agendado no dia
    if (!list.length) { out.push({ prof: p.data.name, enviado: false, motivo: "sem pacientes" }); continue; }
    const to = opts.toOverride || mail;
    if (!validMail(to)) { out.push({ prof: p.data.name, enviado: false, motivo: "sem e-mail cadastrado" }); continue; }
    const m = buildMail(p.data.name, opts.date, list);
    if (opts.dry) { out.push({ prof: p.data.name, enviado: false, motivo: "simulação", pacientes: list.length, para: to }); continue; }
    const r = await mailer.send(to, (opts.toOverride || opts.teste ? "[TESTE] " : "") + m.subject, m.html, m.text);
    out.push({ prof: p.data.name, enviado: r.ok, pacientes: list.length, para: to, ...(r.ok ? {} : { erro: r.erro }) });
  }
  return out;
}

if (typeof Deno !== "undefined" && Deno.serve) {
  // @ts-ignore (módulo remoto do Deno)
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const store: Store = {
    async rows(coll, f) {
      const out: Row[] = [];
      for (let o = 0; o < 20000; o += 1000) {
        let q = sb.from("docs").select("id,data").eq("coll", coll);
        if (f?.eq) q = q.eq("data->>" + f.eq[0], f.eq[1]);
        const { data, error } = await q.order("id").range(o, o + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
    async get(coll, id) { const { data, error } = await sb.from("docs").select("id,data").eq("coll", coll).eq("id", id).maybeSingle(); if (error) throw error; return data || null; },
  };
  const FROM = Deno.env.get("AGENDA_FROM") || "Agenda Adintus <agenda@adintus.com.br>";
  const mailer: Mailer = {
    async send(to, subject, html, text) {
      const key = Deno.env.get("RESEND_API_KEY");
      if (!key) return { ok: false, erro: "RESEND_API_KEY não configurada" };
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify({ from: FROM, to: [to], subject, html, text }) });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, id: j.id } : { ok: false, erro: String(j.message || r.status) };
    },
  };
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
    try {
      const body = await req.json().catch(() => ({}));
      const secret = Deno.env.get("AGENDA_CRON_SECRET");
      const cron = !!secret && req.headers.get("x-cron-secret") === secret;
      if (cron) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(body.data || "") ? body.data : addDays(todayBR(), 1);
        const res = await run(store, mailer, { date, dry: body.simular === true });
        return json({ data: date, enviados: res.filter((x) => x.enviado).length, resultado: res });
      }
      // teste pelo sistema: precisa do login de um administrador; envia só para ele mesmo
      const tk = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(tk);
      const email = (u?.user?.email || "").toLowerCase();
      if (!email) return json({ erro: "Entre no sistema para testar." }, 401);
      const acc = u!.user!.id ? await store.get("access", u!.user!.id) : null;
      const adm = (Deno.env.get("AGENDA_ADMIN_EMAILS") || "administrativo@adintus.com.br").toLowerCase().split(",").map((s) => s.trim());
      if (!(acc?.data?.role === "admin" || adm.includes(email))) return json({ erro: "Só o administrador pode enviar o teste." }, 403);
      if (body.teste !== true || !body.prof) return json({ erro: "Informe teste:true e prof." }, 400);
      // teste usa o próximo dia com pacientes (hoje + até 7 dias) para o profissional escolhido
      let res: any[] = [], d = addDays(todayBR(), 1);
      for (let i = 0; i < 8; i++, d = addDays(d, 1)) {
        res = await run(store, mailer, { date: d, onlyProf: String(body.prof), toOverride: body.paraProf === true ? undefined : email, force: true, teste: true });
        if (!res.length || res[0].motivo !== "sem pacientes") break;
      }
      const r = res[0];
      if (!r) return json({ erro: "Profissional não encontrado." }, 404);
      if (r.motivo === "sem pacientes") return json({ enviado: false, aviso: "Nenhum paciente agendado nos próximos 8 dias para este profissional, então não há o que enviar." });
      if (r.motivo === "sem e-mail cadastrado") return json({ enviado: false, aviso: "Este profissional não tem e-mail válido cadastrado." });
      return json({ enviado: !!r.enviado, data: d, para: r.para || email, pacientes: r.pacientes, erro: r.erro });
    } catch (e) { console.error(e); return json({ erro: "Erro inesperado." }, 500); }
  });
}
