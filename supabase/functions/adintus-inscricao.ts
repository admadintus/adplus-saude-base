// Adintus Saúde · função "adintus-inscricao" (Supabase Edge Function)
// Inscrição pública em eventos pelo link (página em eventos.adintus.com.br). Sem login.
// - GET  ?e=CODIGO (ou o link curto do evento)  → dados públicos do evento (nome, data, local, valor, vagas livres). Nunca devolve a lista de inscritos nem o Pix.
// - POST {e, nome, tel, gest, sem, motivo, acomp, acNome, acPar, lgpd, site} → cria a inscrição (aguardando pagamento ou lista de espera).
//   O Pix só volta na resposta de quem acabou de se inscrever com vaga.
// "Verify JWT with legacy secret" precisa ficar DESLIGADO (a pessoa não tem login).
// Secrets opcionais: INSCRICAO_ORIGINS (padrão https://eventos.adintus.com.br, separar por vírgula).
export type Row = { id: string; data: any };
export interface Store {
  eventByTok(tok: string): Promise<Row | null>;
  eventBySlug(slug: string): Promise<Row | null>;
  regsOf(evId: string): Promise<Row[]>;
  insert(coll: string, id: string, data: any): Promise<boolean>;
  update(coll: string, id: string, patch: any): Promise<void>;
}
export const TZ = "America/Sao_Paulo";
export const MAX_POST_IP = 6, MAX_GET_IP = 60, JANELA_MS = 10 * 60 * 1000, MAX_POR_HORA_EVENTO = 40;
const RL = new Map<string, { w: number; n: number }>();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export function phoneKey(s: unknown) {
  let d = digits(s);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length >= 10) return d.slice(0, 2) + d.slice(-8);
  if (d.length >= 8) return d.slice(-8);
  return "";
}
const hojeBR = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const OCUPA = (s: string) => s === "aguardando" || s === "confirmada";
const ATIVA = (s: string) => s !== "cancelada";

function limite(ip: string, tipo: "g" | "p", max: number, now: number) {
  const k = tipo + ":" + ip, r = RL.get(k);
  if (!r || now - r.w > JANELA_MS) { RL.set(k, { w: now, n: 1 }); return false; }
  r.n++;
  if (RL.size > 5000) { for (const [kk, v] of RL) if (now - v.w > JANELA_MS) RL.delete(kk); }
  return r.n > max;
}

export function allowedOrigins(env?: string) {
  return (env || "https://eventos.adintus.com.br").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function handle(req: Request, store: Store, opts: { origins?: string[]; clock?: () => Date; ip?: string } = {}): Promise<Response> {
  const clock = opts.clock || (() => new Date());
  const origins = opts.origins || allowedOrigins();
  const origin = req.headers.get("origin") || "";
  const okOrigin = !origin || origins.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  const cors: Record<string, string> = {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "origin",
    "cache-control": "no-store",
  };
  if (origin && okOrigin) cors["access-control-allow-origin"] = origin;
  const J = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
  const E = (status: number, codigo: string, msg: string, extra: Record<string, unknown> = {}) => J({ ok: false, codigo, erro: msg, ...extra }, status);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!okOrigin) return E(403, "ORIGEM_NAO_PERMITIDA", "Origem não permitida.");
  const ip = opts.ip || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const now = clock(), today = hojeBR(now), nowMs = now.getTime();
  const url = new URL(req.url);

  const evOut = async (ev: Row) => {
    const regs = await store.regsOf(ev.id);
    const total = Math.max(0, Math.floor(+ev.data.spots || 0));
    const oc = regs.filter((r) => OCUPA(r.data.status)).length;
    let fechado: string | null = null;
    if (ev.data.open === false || ev.data.pubOff === true) fechado = "pausado";
    else if (ev.data.date && ev.data.date < today) fechado = "encerrado";
    return {
      regs, total, oc, livres: Math.max(0, total - oc), fechado,
      info: {
        nome: String(ev.data.name || ""), data: ev.data.date || null, hora: ev.data.time || null, local: ev.data.place || null,
        ministrante: ev.data.speaker || null, valor: Math.round((+ev.data.price || 0) * 100) / 100, livres: Math.max(0, total - oc),
        acompanhante: ev.data.companion !== false, aberto: !fechado, motivo_fechado: fechado,
      },
    };
  };
  const findEv = async (tok: string) => {
    let ev: Row | null = null;
    if (/^[A-Za-z0-9_-]{10,40}$/.test(tok)) ev = await store.eventByTok(tok);
    if (!ev && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(tok)) ev = await store.eventBySlug(tok);
    return ev && ev.data.active !== false ? ev : null;
  };

  if (req.method === "GET") {
    if (limite(ip, "g", MAX_GET_IP, nowMs)) return E(429, "MUITAS_TENTATIVAS", "Muitas tentativas. Aguarde alguns minutos.");
    const ev = await findEv(url.searchParams.get("e") || "");
    if (!ev) return E(404, "EVENTO_NAO_ENCONTRADO", "Este link não é válido ou o evento não está mais disponível.");
    const o = await evOut(ev);
    return J({ ok: true, evento: o.info });
  }
  if (req.method !== "POST") return E(405, "METODO", "Use GET ou POST.");
  if (limite(ip, "p", MAX_POST_IP, nowMs)) return E(429, "MUITAS_TENTATIVAS", "Muitas tentativas. Aguarde alguns minutos e tente de novo.");
  let b: any;
  try { b = await req.json(); } catch { return E(400, "DADO_INVALIDO", "Dados inválidos."); }
  if (!b || typeof b !== "object") return E(400, "DADO_INVALIDO", "Dados inválidos.");
  // campo escondido que só robôs preenchem: responde como se tivesse dado certo, sem gravar
  if (String(b.site || "").trim() !== "") return J({ ok: true, status: "aguardando", ja: false, simulado: true });
  const ev = await findEv(String(b.e || ""));
  if (!ev) return E(404, "EVENTO_NAO_ENCONTRADO", "Este link não é válido ou o evento não está mais disponível.");
  const o = await evOut(ev);
  if (o.fechado === "encerrado") return E(409, "EVENTO_ENCERRADO", "Este evento já aconteceu.");
  if (o.fechado) return E(409, "INSCRICOES_PAUSADAS", "As inscrições deste evento estão encerradas no momento.");
  const F = (campo: string, msg: string) => E(400, "DADO_INVALIDO", msg, { campo });
  const nome = String(b.nome ?? "").trim().replace(/\s+/g, " ").replace(/[<>"\r\n]/g, "");
  if (nome.length < 3 || nome.length > 120 || nome.split(" ").length < 2) return F("nome", "Informe seu nome completo (nome e sobrenome).");
  const tdig = digits(b.tel), tk = phoneKey(b.tel);
  if (!tk || tdig.length < 10 || tdig.length > 13) return F("tel", "Informe o WhatsApp com DDD, por exemplo (61) 99999-8888.");
  if (b.gest !== true && b.gest !== false) return F("gest", "Informe se você está gestante.");
  let sem = "", motivo = "";
  if (b.gest) { sem = String(b.sem ?? "").trim().replace(/[<>"\r\n]/g, ""); if (!sem) return F("sem", "Informe o tempo de gestação (ex.: 32 semanas)."); if (sem.length > 40) return F("sem", "Tempo de gestação: no máximo 40 caracteres."); }
  else { motivo = String(b.motivo ?? "").trim().replace(/[<>"]/g, ""); if (!motivo) return F("motivo", "Conte o motivo da sua participação."); if (motivo.length > 500) return F("motivo", "Motivo: no máximo 500 caracteres."); }
  const acomp = b.acomp === true;
  if (b.acomp !== undefined && typeof b.acomp !== "boolean") return F("acomp", "Informe se vai com acompanhante.");
  if (acomp && ev.data.companion === false) return F("acomp", "Este evento não permite acompanhante.");
  let acNome = "", acPar = "";
  if (acomp) {
    acNome = String(b.acNome ?? "").trim().replace(/\s+/g, " ").replace(/[<>"\r\n]/g, "");
    if (acNome.length < 3 || acNome.length > 120) return F("acNome", "Informe o nome do acompanhante.");
    const pr = norm(b.acPar);
    acPar = /^(conjuge|marido|esposa|esposo|companheiro|companheira|parceiro|parceira|namorado|namorada)$/.test(pr) ? "conjuge" : pr === "pai" ? "pai" : pr === "mae" ? "mae" : pr.startsWith("outro") ? "outro_familiar" : "";
    if (!acPar) return F("acPar", "Informe o parentesco do acompanhante.");
  }
  if (b.lgpd !== true) return F("lgpd", "É preciso concordar com o uso dos dados para se inscrever.");
  // proteção contra excesso de inscrições seguidas pelo link
  const umaHora = nowMs - 3600_000;
  if (o.regs.filter((r) => r.data.canal === "link" && +r.data.at > umaHora).length >= MAX_POR_HORA_EVENTO) return E(429, "MUITAS_TENTATIVAS", "Muitas inscrições em pouco tempo. Tente novamente em alguns minutos.");

  const pagamento = (status: string) => status === "aguardando" ? { valor: Math.round((+ev.data.price || 0) * 100) / 100, pix: ev.data.pix || null, wa: digits(ev.data.wa) || null } : {};
  const primeiro = nome.split(" ")[0];
  // mesma pessoa (telefone) já inscrita: devolve a situação, sem criar de novo
  const dup = o.regs.find((r) => phoneKey(r.data.tel) === tk && ATIVA(r.data.status));
  if (dup) return J({ ok: true, ja: true, status: dup.data.status, nome: primeiro, ...pagamento(dup.data.status === "aguardando" ? "aguardando" : "") });
  const total = o.total;
  const base = { ev: ev.id, nome, tel: tdig, tk, canal: "link", gest: b.gest === true, sem, motivo, acomp, acNome, acPar, obs: "", at: nowMs, by: "link", lgpd: true };
  const id = "i_" + ev.id + "_" + tk;
  let status = o.oc >= total ? "espera" : "aguardando";
  const antiga = o.regs.find((r) => r.id === id);
  let ok = await store.insert("evregs", id, { ...base, status });
  if (!ok) {
    if (antiga && !ATIVA(antiga.data.status)) {
      await store.update("evregs", id, { ...base, status, hist: [...(antiga.data.hist || []), { at: antiga.data.at, status: antiga.data.status }] });
      ok = true;
    } else {
      const again = (await store.regsOf(ev.id)).find((r) => r.id === id);
      if (again) return J({ ok: true, ja: true, status: again.data.status, nome: primeiro, ...pagamento(again.data.status === "aguardando" ? "aguardando" : "") });
      return E(500, "ERRO_INTERNO", "Não foi possível registrar. Tente de novo.");
    }
  }
  // duas pessoas ao mesmo tempo: quem chegou depois vai para a lista de espera
  if (status === "aguardando") {
    const agora = (await store.regsOf(ev.id)).filter((r) => OCUPA(r.data.status)).sort((a, b) => (+a.data.at || 0) - (+b.data.at || 0) || (a.id < b.id ? -1 : 1));
    const pos = agora.findIndex((r) => r.id === id);
    if (pos >= total) { status = "espera"; await store.update("evregs", id, { status }); }
  }
  return J({ ok: true, ja: false, status, nome: primeiro, ...pagamento(status) }, 201);
}

// ---------- Supabase ----------
// @ts-ignore
if (typeof Deno !== "undefined" && Deno.serve) {
  // @ts-ignore
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  // @ts-ignore
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const store: Store = {
    async eventByTok(tok) {
      const { data, error } = await sb.from("docs").select("id,data").eq("coll", "events").eq("data->>pubTok", tok).limit(1);
      if (error) throw error;
      return (data && data[0]) || null;
    },
    async eventBySlug(slug) {
      const { data, error } = await sb.from("docs").select("id,data").eq("coll", "events").eq("data->>pubSlug", slug).limit(1);
      if (error) throw error;
      return (data && data[0]) || null;
    },
    async regsOf(evId) {
      const { data, error } = await sb.from("docs").select("id,data").eq("coll", "evregs").eq("data->>ev", evId).limit(5000);
      if (error) throw error;
      return data || [];
    },
    async insert(coll, id, data) {
      const { error } = await sb.from("docs").insert({ coll, id, data });
      if (error) { if (String(error.code) === "23505") return false; throw error; }
      return true;
    },
    async update(coll, id, patch) { const { error } = await sb.rpc("doc_merge", { p_coll: coll, p_id: id, p_patch: patch }); if (error) throw error; },
  };
  // @ts-ignore
  const origins = allowedOrigins(Deno.env.get("INSCRICAO_ORIGINS"));
  // @ts-ignore
  Deno.serve((req: Request) => handle(req, store, { origins }).catch((e) => { console.error(e); return new Response(JSON.stringify({ ok: false, codigo: "ERRO_INTERNO", erro: "Erro inesperado. Tente de novo." }), { status: 500, headers: { "content-type": "application/json" } }); }));
}
