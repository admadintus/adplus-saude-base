// Adintus Saúde · API para outros aplicativos (Supabase Edge Function "adintus-api")  · versão 2.4
// Leitura + escrita de agenda e pacientes (para a Lia agendar pelo WhatsApp).
// Nunca expõe prontuário, prescrições, atestados, exames. CPF, e-mail, valores e WhatsApp dos profissionais só vão
// para chaves com as permissões de escrita ("Agenda – escrita" e "Pacientes – escrita").
// As chaves são criadas em Cadastros › Integrações e ficam guardadas apenas como "hash" (não dá para recuperar o texto).
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-api-key, content-type, idempotency-key",
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
};
const ST: Record<number, string> = {
  1: "marcado", 7: "confirmado", 4: "aguardando", 5: "chamando", 2: "em_atendimento", 3: "atendido",
  6: "nao_compareceu", 11: "desmarcado", 22: "cancelado", 15: "remarcado", 208: "pagamento",
};
// nomes combinados com a Lia (campo "status"); o campo antigo "situacao" continua igual
const ST_NEW: Record<number, string> = { 1: "agendado", 7: "confirmado", 3: "atendido", 6: "faltou", 11: "cancelado", 22: "cancelado" };
const FREE: Record<number, number> = { 11: 1, 22: 1, 15: 1 };
const SCOPES = ["agenda", "pacientes", "profissionais", "pacotes", "agenda_escrita", "pacientes_escrita", "ag_marcar", "ag_confirmar", "ag_cancelar", "ag_remarcar", "ag_convenio", "pac_cadastrar", "ev_vagas", "ev_ler", "ev_criar", "ev_obs", "ev_listar", "ver_valores", "ver_convenio", "ver_whatsapp", "ver_cpf", "ver_email", "ver_responsavel"];
const RL = new Map<string, { w: number; n: number }>();
const TZ = "America/Sao_Paulo";
const ORIGEM = "Lia (WhatsApp)";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
}
// Erro no formato combinado ({erro, codigo}) e, por compatibilidade, no formato antigo ({error:{code,message}})
function err(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  const codigo = code.toUpperCase();
  return json({ erro: message, codigo, ...extra, error: { code: codigo.toLowerCase(), message } }, status);
}
async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const isDate = (s: string | null | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
const isHora = (s: string | null | undefined) => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const hm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const toMin = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
function addDays(s: string, n: number) { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function days(a: string, b: string) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5); }
function dow(s: string) { return new Date(s + "T12:00:00Z").getUTCDay(); }
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
// horário de Brasília
function nowBR(now: Date) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, min: +g("hour") * 60 + +g("minute") };
}
function stampBR(now: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).replace(",", "");
}
// telefone: ignora o 55 e o 9º dígito (compara DDD + últimos 8 números)
function phoneKey(s: unknown) {
  let d = digits(s);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length >= 10) return d.slice(0, 2) + d.slice(-8);
  if (d.length >= 8) return d.slice(-8);
  return "";
}
function samePhone(a: unknown, b: unknown) {
  const x = phoneKey(a), y = phoneKey(b);
  if (!x || !y) return false;
  return x.length === y.length ? x === y : x.slice(-8) === y.slice(-8);
}
function cpfOk(c: string) {
  c = digits(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const d = ((s * 10) % 11) % 10; if (d !== +c[n]) return false; }
  return true;
}
function relDate(v: string | null, today: string, base: string): string | null {
  if (!v) return null;
  if (v === "hoje") return today;
  const m = /^([+-])(\d{1,4})d$/.exec(v);
  if (m) return addDays(base, (m[1] === "-" ? -1 : 1) * +m[2]);
  return isDate(v) ? v : null;
}

export interface Store {
  rows(coll: string, f?: { gte?: [string, string]; lte?: [string, string] }): Promise<{ id: string; data: any }[]>;
  get(coll: string, id: string): Promise<{ id: string; data: any } | null>;
  insert(coll: string, id: string, data: any): Promise<boolean>; // false se o id já existe
  update(coll: string, id: string, patch: Record<string, unknown>): Promise<void>;
  remove(coll: string, id: string): Promise<void>;
  touch(id: string, patch: Record<string, unknown>): Promise<void>;
}

type Row = { id: string; data: any };
const rid = () => { const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", b = new Uint8Array(20); crypto.getRandomValues(b); return [...b].map((x) => c[x % c.length]).join(""); };
const maskTel = (d: string) => d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;
const maskCpf = (d: string) => d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
const wa55 = (s: unknown) => { const d = digits(s); return d.length === 10 || d.length === 11 ? "55" + d : d; };
const ageOn = (nasc: string, date: string) => { const y = +date.slice(0, 4) - +nasc.slice(0, 4); return (date.slice(5) < nasc.slice(5)) ? y - 1 : y; };

// ---- agenda: regras iguais às do aplicativo (grade, bloqueios, salas, consultas já marcadas) ----
// ---- feriados do DF (mesma regra da agenda do sistema) ----
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
// ---- planos e clubes (Interlife) ----
const DEF_INTERLIFE = { id: "interlife", name: "Interlife", active: true, price: "tabela", desc: 0, tab: {}, cart: { ask: true, req: false }, profs: null as string[] | null };
const interlifeOf = (plansDoc: Row | null) => { const l = (plansDoc?.data?.list || null) as any[] | null; const pl = l ? l.find((x) => /interlife/i.test(x?.name || "")) : DEF_INTERLIFE; return pl && pl.active !== false ? pl : null; };
const aceitaInterlife = (pl: any, p: Row) => !!pl && (Array.isArray(pl.profs) ? pl.profs.includes(p.id) : false) || p.data.interlife === true;
const planPrice = (pl: any, p: Row, ix: number, base: number) => { if (!pl) return base; if (pl.price === "desc") return Math.round(base * (1 - (+pl.desc || 0) / 100) * 100) / 100; if (pl.price === "tabela") { const t = pl.tab && pl.tab[p.data.spec + ":" + ix]; return t != null && t !== "" && !isNaN(+t) ? +t : base; } return base; };

interface Ctx { hol: any; rooms: any[]; blocks: Row[]; appts: Row[]; closed: Set<string>; profs: Row[]; }
const schedOf = (p: any) => {
  if (p.sched) return p.sched;
  const s: any = {}; (p.days || []).forEach((d: number) => { s[d] = p.lunch && p.lunch.length === 2 ? [[p.from, p.lunch[0]], [p.lunch[1], p.to]] : [[p.from, p.to]]; }); return s;
};
const segsOf = (p: any, date: string, c?: { blocks: Row[] }, pid?: string): number[][] => {
  let s = ((schedOf(p)[dow(date)] || []) as number[][]).slice();
  if (c && pid) for (const b of c.blocks) {
    if (!b.data.open || b.data.prof !== pid || b.data.date > date || (b.data.dateEnd || b.data.date) < date) continue;
    let parts: number[][] = [[b.data.start, b.data.end]];
    for (const q of s) { const n: number[][] = []; for (const r of parts) { if (q[1] <= r[0] || q[0] >= r[1]) { n.push(r); continue; } if (r[0] < q[0]) n.push([r[0], q[0]]); if (r[1] > q[1]) n.push([q[1], r[1]]); } parts = n; }
    s = s.concat(parts);
  }
  return s.sort((a, b) => a[0] - b[0]);
};
const slotOf = (p: any) => [15, 30, 60].includes(p.slot) ? p.slot : 15;
const procsOf = (spec: Row | undefined) => (spec && (spec.data.procs || []).length ? spec.data.procs : [{ n: "Consulta", d: 30, v: 0 }]) as { n: string; d: number; v: number }[];
async function loadCtx(store: Store, profs: Row[], from: string, to: string): Promise<Ctx> {
  const [r, blocks, appts, closed, hol] = await Promise.all([
    store.get("config", "rooms"), store.rows("blocks"),
    store.rows("appointments", { gte: ["date", from], lte: ["date", to] }), store.get("config", "closed"), store.get("config", "holidays"),
  ]);
  const cl = new Set<string>(); ((closed?.data?.list || closed?.data?.dates || []) as any[]).forEach((x) => { const d = typeof x === "string" ? x : x?.date; if (isDate(d)) cl.add(d); });
  return { hol: hol?.data || null, rooms: r?.data?.list || [], blocks: blocks.filter((b) => (b.data.dateEnd || b.data.date) >= from && b.data.date <= to), appts, closed: cl, profs };
}
type Chk = { ok: true; roomId: string; room: string } | { ok: false; codigo: string; msg: string };
function slotCheck(c: Ctx, p: Row, date: string, start: number, dur: number, exceptId?: string): Chk {
  const hn = holOf(c.hol, date);
  // feriado: só libera o que a clínica abriu de propósito (Agenda aberta) para este profissional
  const aberto = c.blocks.some((b) => b.data.open && b.data.prof === p.id && b.data.date <= date && (b.data.dateEnd || b.data.date) >= date && start >= b.data.start && start + dur <= b.data.end);
  if (hn && !aberto) return { ok: false, codigo: "HORARIO_INDISPONIVEL", msg: "Feriado: " + hn + ". A clínica está fechada." };
  if (c.closed.has(date)) return { ok: false, codigo: "HORARIO_INDISPONIVEL", msg: "A clínica está fechada neste dia." };
  const sg = segsOf(p.data, date, c, p.id).find((s) => start >= s[0] && start + dur <= s[1]);
  if (!sg) return { ok: false, codigo: "HORARIO_INDISPONIVEL", msg: "Horário fora da grade de atendimento do profissional." };
  if ((start - sg[0]) % slotOf(p.data) !== 0) return { ok: false, codigo: "HORARIO_INDISPONIVEL", msg: "O profissional atende em intervalos de " + slotOf(p.data) + " min a partir de " + hm(sg[0]) + "." };
  const bl = c.blocks.find((b) => !b.data.open && b.data.prof === p.id && b.data.date <= date && (b.data.dateEnd || b.data.date) >= date && (() => { const r = b.data.allDay ? [0, 1440] : [b.data.start, b.data.end]; return start < r[1] && start + dur > r[0]; })());
  if (bl) return { ok: false, codigo: "HORARIO_INDISPONIVEL", msg: "Horário bloqueado na agenda" + (bl.data.reason ? " (" + bl.data.reason + ")" : "") + "." };
  if (c.appts.some((a) => a.id !== exceptId && a.data.prof === p.id && a.data.date === date && !FREE[a.data.status] && a.data.start < start + dur && a.data.start + a.data.dur > start))
    return { ok: false, codigo: "HORARIO_OCUPADO", msg: "Já existe consulta neste horário." };
  let roomId = "", room = p.data.local || "";
  if (c.rooms.length) {
    const free = c.rooms.filter((r: any) =>
      !c.profs.some((o) => o.id !== p.id && o.data.active !== false && segsOf(o.data, date, c, o.id).some((x) => x[2] === r.id && start < x[1] && x[0] < start + dur)) &&
      !c.appts.some((a) => a.id !== exceptId && a.data.date === date && a.data.prof !== p.id && !FREE[a.data.status] && a.data.roomId === r.id && start < a.data.start + a.data.dur && a.data.start < start + dur));
    if (!free.length) return { ok: false, codigo: "HORARIO_OCUPADO", msg: "Nenhuma sala livre neste horário." };
    const r = free.find((x: any) => x.id === sg[2]) || free[0]; roomId = r.id; room = r.name;
  }
  return { ok: true, roomId, room };
}

export async function handle(req: Request, store: Store, clock: () => Date = () => new Date()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/adintus-api/, "").replace(/\/+$/, "") || "/";
  if (path === "/health" && req.method === "GET") return json({ status: "ok" });
  if (!["GET", "POST", "PATCH"].includes(req.method)) return err(405, "metodo_nao_permitido", "Use GET, POST ou PATCH.");

  const auth = req.headers.get("authorization") || "";
  const key = (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : req.headers.get("x-api-key") || "").trim();
  if (!key) return err(401, "chave_ausente", "Envie a chave no cabeçalho Authorization: Bearer <chave>.");
  const hash = await sha256(key);
  const keys = await store.rows("apikeys");
  const k = keys.find((x) => x.data && x.data.hash === hash);
  if (!k || k.data.active === false) return err(401, "chave_invalida", "Chave inválida ou revogada.");
  if (k.data.expiresAt && clock().getTime() > +k.data.expiresAt) return err(401, "chave_expirada", "Esta chave expirou. Peça uma nova ao administrador.");
  const rpm = +k.data.rpm || 0;
  if (rpm > 0) {
    const w = Math.floor(clock().getTime() / 60000), r = RL.get(k.id);
    if (!r || r.w !== w) RL.set(k.id, { w, n: 1 }); else if (++r.n > rpm) return new Response(JSON.stringify({ erro: "Limite de " + rpm + " chamadas por minuto excedido.", codigo: "LIMITE_EXCEDIDO", error: { code: "limite_excedido", message: "Limite de " + rpm + " chamadas por minuto excedido." } }), { status: 429, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "retry-after": "30" } });
  }
  const K: Row = k;
  const scopes: string[] = (k.data.scopes || []).filter((s: string) => SCOPES.includes(s));
  const add = (...l: string[]) => l.forEach((x) => { if (!scopes.includes(x)) scopes.push(x); });
  if (scopes.includes("agenda_escrita")) add("agenda", "ag_marcar", "ag_confirmar", "ag_cancelar", "ag_remarcar", "ag_convenio", "ver_valores", "ver_convenio", "ver_whatsapp");
  if (scopes.includes("pacientes_escrita")) add("pacientes", "pac_cadastrar", "ver_cpf", "ver_email", "ver_responsavel", "ver_convenio");
  if (["ag_marcar", "ag_confirmar", "ag_cancelar", "ag_remarcar", "ag_convenio"].some((x) => scopes.includes(x))) add("agenda");
  if (scopes.includes("pac_cadastrar")) add("pacientes");
  if (["ev_ler", "ev_criar", "ev_obs", "ev_listar"].some((x) => scopes.includes(x))) add("ev_vagas");
  const profSet: Set<string> | null = Array.isArray(k.data.profs) ? new Set<string>(k.data.profs) : null;
  const profOk = (id: string) => !profSet || profSet.has(id);
  const need = (s: string) => scopes.includes(s) ? null : err(403, "sem_permissao", "Esta chave não tem a permissão “" + s + "”.");
  const rVal = scopes.includes("ver_valores"), rConv = scopes.includes("ver_convenio"), rWa = scopes.includes("ver_whatsapp"), pCpf = scopes.includes("ver_cpf"), pMail = scopes.includes("ver_email"), pResp = scopes.includes("ver_responsavel");
  store.touch(k.id, { lastUsed: Date.now() }).catch(() => {});

  // idempotência: o mesmo Idempotency-Key em até 24 h devolve o mesmo resultado, sem criar de novo
  const idem = req.method !== "GET" ? (req.headers.get("idempotency-key") || "").trim() : "";
  let idemId = "";
  if (idem) {
    idemId = await sha256([k.id, req.method, path, idem].join("|"));
    const old = await store.get("apiidem", idemId);
    const age = old ? clock().getTime() - (old.data.at || 0) : 0;
    if (old && age < 864e5) {
      if (old.data.body === undefined) { if (age < 60000) return err(409, "em_processamento", "Este pedido ainda está sendo processado. Tente de novo em instantes."); }
      else return new Response(old.data.body, { status: old.data.status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "idempotent-replayed": "true" } });
    }
    const mine = { at: clock().getTime(), status: 0 };
    if (!(await store.insert("apiidem", idemId, mine))) await store.update("apiidem", idemId, { at: mine.at, status: 0, body: null as any });
  }
  const res = await route();
  if (idemId) {
    if (res.status >= 500) await store.remove("apiidem", idemId).catch(() => {});
    else await store.update("apiidem", idemId, { status: res.status, body: await res.clone().text(), at: clock().getTime() }).catch(() => {});
  }
  return res;

  async function route(): Promise<Response> {
  const q = url.searchParams;
  const now = nowBR(clock()), today = now.date;
  const limit = Math.max(1, Math.min(500, +(q.get("limit") || 200) || 200));
  const offset = Math.max(0, +(q.get("offset") || 0) || 0);
  const page = (l: any[]) => json({ data: l.slice(offset, offset + limit), count: l.length, next_offset: offset + limit < l.length ? offset + limit : null });
  let body: any = {};
  if (req.method !== "GET") {
    try { const t = await req.text(); body = t ? JSON.parse(t) : {}; } catch { return err(400, "json_invalido", "O corpo do pedido não é um JSON válido."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "json_invalido", "O corpo do pedido precisa ser um objeto JSON.");
  }

  // ---- eventos: inscrições (para a Lia) ----
  if (path === "/eventos" || path.startsWith("/eventos/")) {
    const parts = path.split("/").filter(Boolean); // eventos, {eid}, vagas|inscricoes, {rid}
    const eid = parts[1] || "", sub = parts[2] || "", rid = parts[3] || "";
    const SIT: Record<string, string> = { aguardando: "aguardando_pagamento", confirmada: "confirmada", espera: "lista_de_espera", cancelada: "cancelada" };
    const OCUPA = (s: string) => s === "aguardando" || s === "confirmada";
    const ATIVA = (s: string) => s !== "cancelada";
    const loadEv = async (id: string) => { const ev = await store.get("events", id); return ev && ev.data.active !== false ? ev : null; };
    const regsOf = async (id: string) => (await store.rows("evregs")).filter((r) => r.data.ev === id);
    const vagasOf = (ev: Row, regs: Row[]) => { const total = Math.max(0, Math.floor(+ev.data.spots || 0)); const oc = regs.filter((r) => OCUPA(r.data.status)).length; return { total, ocupadas: oc, livres: Math.max(0, total - oc) }; };
    const evOut = (ev: Row, regs: Row[]) => { const v = vagasOf(ev, regs); return { id: ev.id, nome: ev.data.name, data: ev.data.date, hora: ev.data.time || null, local: ev.data.place || null, ministrante: ev.data.speaker || null, valor_centavos: Math.round((+ev.data.price || 0) * 100), pix: ev.data.pix || null, vagas_total: v.total, vagas_disponiveis: v.livres, acompanhantes_por_inscrita: ev.data.companion === false ? 0 : 1, inscricoes_abertas: ev.data.open !== false }; };
    const regOut = (r: Row, full: boolean) => {
      const d = r.data;
      const o: any = { id: r.id, nome: d.nome, telefone: maskTel(digits(d.tel)), canal: d.canal || null, situacao: SIT[d.status] || d.status, cadastrado_em: new Date(+d.at || 0).toISOString() };
      if (full) Object.assign(o, { gestante: !!d.gest, tempo_gestacao: d.gest ? d.sem || null : null, motivo: d.gest ? null : d.motivo || null, acompanhante: !!d.acomp, acompanhante_nome: d.acomp ? d.acNome || null : null, acompanhante_parentesco: d.acomp ? d.acPar || null : null });
      return o;
    };
    const asBool = (v: unknown): boolean | undefined => { if (typeof v === "boolean") return v; const s = norm(v); if (["sim", "s", "true", "1", "yes"].includes(s)) return true; if (["nao", "n", "false", "0", "no"].includes(s)) return false; return undefined; };
    if (!eid) {
      if (req.method !== "GET") return err(405, "metodo_nao_permitido", "Use GET.");
      const d = need("ev_vagas"); if (d) return d;
      const evs = (await store.rows("events")).filter((e) => e.data.active !== false), all = await store.rows("evregs");
      return page(evs.map((e) => evOut(e, all.filter((r) => r.data.ev === e.id))).sort((a, b) => String(a.data).localeCompare(String(b.data))));
    }
    const got = await loadEv(eid);
    if (!got) return err(404, "evento_nao_encontrado", "Evento não encontrado ou encerrado.");
    const ev: Row = got, regs = await regsOf(eid);
    if (!sub) { if (req.method !== "GET") return err(405, "metodo_nao_permitido", "Use GET."); const d = need("ev_vagas"); if (d) return d; return json(evOut(ev, regs)); }
    if (sub === "vagas") {
      if (req.method !== "GET") return err(405, "metodo_nao_permitido", "Use GET.");
      const d = need("ev_vagas"); if (d) return d;
      const v = vagasOf(ev, regs);
      return json({ evento_id: ev.id, vagas_total: v.total, vagas_ocupadas: v.ocupadas, vagas_disponiveis: v.livres, lista_de_espera: regs.filter((r) => r.data.status === "espera").length, inscricoes_abertas: ev.data.open !== false });
    }
    if (sub !== "inscricoes" || parts.length > 4) return err(404, "nao_encontrado", "Rota não encontrada.");
    // consultas
    if (req.method === "GET") {
      if (rid) {
        const d = need("ev_ler"); if (d) return d;
        const r = regs.find((x) => x.id === rid);
        if (!r) return err(404, "inscricao_nao_encontrada", "Inscrição não encontrada.");
        return json(regOut(r, true));
      }
      const tel = q.get("telefone");
      if (tel != null) {
        const d = need("ev_ler"); if (d) return d;
        const tk = phoneKey(tel);
        if (!tk) return err(400, "dado_invalido", "Informe um telefone válido (com DDD).");
        const m = regs.filter((r) => phoneKey(r.data.tel) === tk).sort((a, b) => (ATIVA(b.data.status) ? 1 : 0) - (ATIVA(a.data.status) ? 1 : 0) || (+b.data.at || 0) - (+a.data.at || 0));
        if (!m.length) return err(404, "inscricao_nao_encontrada", "Não há inscrição com este telefone neste evento.");
        return json(regOut(m[0], true));
      }
      const d = need("ev_listar"); if (d) return d;
      const sit = q.get("situacao");
      let l = regs.slice();
      if (sit) { const k = Object.keys(SIT).find((x) => SIT[x] === sit); if (!k) return err(400, "dado_invalido", "situacao inválida. Use: aguardando_pagamento, confirmada, lista_de_espera ou cancelada."); l = l.filter((r) => r.data.status === k); }
      l.sort((a, b) => (+a.data.at || 0) - (+b.data.at || 0));
      return page(l.map((r) => regOut(r, false)));
    }
    // alterar observações
    if (req.method === "PATCH") {
      if (!rid) return err(405, "metodo_nao_permitido", "Use PATCH em /eventos/{id}/inscricoes/{id_da_inscricao}.");
      if ("situacao" in body || "status" in body) return err(403, "SITUACAO_SOMENTE_EQUIPE", "Só a equipe altera a situação da inscrição (a confirmação depende de conferir o PIX).");
      const d = need("ev_obs"); if (d) return d;
      const bad = Object.keys(body).filter((x) => x !== "observacoes"); if (bad.length) return err(400, "campo_desconhecido", "Campo não aceito: " + bad.join(", ") + ". Só “observacoes” pode ser alterado.");
      const r = regs.find((x) => x.id === rid); if (!r) return err(404, "inscricao_nao_encontrada", "Inscrição não encontrada.");
      const t = String(body.observacoes ?? "").trim();
      if (t.length > 500) return err(400, "dado_invalido", "observacoes: no máximo 500 caracteres.");
      await store.update("evregs", r.id, { obsIa: t, obsIaAt: clock().getTime() });
      return json({ ...regOut({ id: r.id, data: { ...r.data, obsIa: t } }, false), observacoes: t });
    }
    // criar inscrição
    if (req.method !== "POST" || rid) return err(405, "metodo_nao_permitido", "Use POST em /eventos/{id}/inscricoes.");
    if ("situacao" in body || "status" in body) return err(403, "SITUACAO_SOMENTE_EQUIPE", "A situação é definida pelo sistema: a inscrição nasce como aguardando pagamento (ou lista de espera, se não houver vagas).");
    const dd = need("ev_criar"); if (dd) return dd;
    const CAMPOS = ["nome", "telefone", "canal", "gestante", "tempo_gestacao", "motivo", "acompanhante", "acompanhante_nome", "acompanhante_parentesco", "consentimento"];
    const desconhecidos = Object.keys(body).filter((x) => !CAMPOS.includes(x));
    if (desconhecidos.length) return err(400, "campo_desconhecido", "Campo não aceito: " + desconhecidos.join(", ") + ". Campos válidos: " + CAMPOS.join(", ") + ".", { campos: desconhecidos });
    if (ev.data.open === false) return err(409, "inscricoes_encerradas", "As inscrições deste evento estão encerradas.");
    if (ev.data.date && ev.data.date < today) return err(409, "evento_encerrado", "Este evento já aconteceu.");
    const F = (campo: string, msg: string) => err(400, "dado_invalido", msg, { campo });
    const nome = String(body.nome ?? "").trim().replace(/\s+/g, " ");
    if (nome.length < 3 || nome.length > 120 || nome.split(" ").length < 2) return F("nome", "Informe o nome completo (nome e sobrenome).");
    const tdig = digits(body.telefone), tk = phoneKey(body.telefone);
    if (!tk || tdig.length < 10 || tdig.length > 13) return F("telefone", "Informe o telefone com DDD, por exemplo 61981827845.");
    const canal = norm(body.canal);
    if (!["whatsapp", "instagram"].includes(canal)) return F("canal", "canal deve ser “whatsapp” ou “instagram”.");
    const gest = asBool(body.gestante);
    if (gest === undefined) return F("gestante", "Informe gestante: sim ou não.");
    let sem = "", motivo = "";
    if (gest) { sem = String(body.tempo_gestacao ?? "").trim(); if (!sem) return F("tempo_gestacao", "Informe o tempo de gestação (ex.: 32 semanas)."); if (sem.length > 40) return F("tempo_gestacao", "tempo_gestacao: no máximo 40 caracteres."); }
    else { motivo = String(body.motivo ?? "").trim(); if (!motivo) return F("motivo", "Informe o motivo da participação (obrigatório para quem não é gestante)."); if (motivo.length > 1000) return F("motivo", "motivo: no máximo 1000 caracteres."); }
    const acomp = body.acompanhante === undefined ? false : asBool(body.acompanhante);
    if (acomp === undefined) return F("acompanhante", "acompanhante deve ser sim ou não.");
    if (acomp && ev.data.companion === false) return F("acompanhante", "Este evento não permite acompanhante.");
    let acNome = "", acPar = "";
    if (acomp) {
      acNome = String(body.acompanhante_nome ?? "").trim().replace(/\s+/g, " ");
      if (acNome.length < 3 || acNome.length > 120) return F("acompanhante_nome", "Informe o nome do acompanhante.");
      const pr = norm(body.acompanhante_parentesco);
      acPar = /^(conjuge|marido|esposa|esposo|companheiro|companheira|parceiro|parceira|namorado|namorada)$/.test(pr) ? "conjuge" : pr === "pai" ? "pai" : pr === "mae" ? "mae" : pr.startsWith("outro") ? "outro_familiar" : "";
      if (!acPar) return F("acompanhante_parentesco", "acompanhante_parentesco deve ser “conjuge”, “pai”, “mae” ou “outro_familiar”.");
    }
    // duplicidade: mesma pessoa (telefone) com inscrição ativa → devolve a existente
    const dup = regs.find((r) => phoneKey(r.data.tel) === tk && ATIVA(r.data.status));
    if (dup) return json({ ...regOut(dup, true), ja_existia: true, vagas_disponiveis: vagasOf(ev, regs).livres, ...(dup.data.status === "aguardando" ? { pagamento: { valor_centavos: Math.round((+ev.data.price || 0) * 100), pix: ev.data.pix || null } } : {}) }, 200);
    const total = vagasOf(ev, regs).total;
    const base = { ev: eid, nome, tel: tdig, tk, canal, gest, sem, motivo, acomp, acNome, acPar, obs: "", at: clock().getTime(), by: "api:" + K.id, lgpd: body.consentimento === true ? true : null };
    const id = "i_" + eid + "_" + tk;
    let status = vagasOf(ev, regs).ocupadas >= total ? "espera" : "aguardando";
    const antiga = regs.find((r) => r.id === id);
    let ok = await store.insert("evregs", id, { ...base, status });
    if (!ok) { // já existe um registro com este telefone (cancelado): reaproveita
      if (antiga && !ATIVA(antiga.data.status)) { await store.update("evregs", id, { ...base, status, hist: [...(antiga.data.hist || []), { at: antiga.data.at, status: antiga.data.status }] }); ok = true; }
      else { const cur = await store.get("evregs", id); if (cur) return json({ ...regOut(cur, true), ja_existia: true }, 200); return err(500, "erro_interno", "Não foi possível registrar. Tente de novo."); }
    }
    // corrida entre duas inscrições ao mesmo tempo: quem chegou depois vai para a lista de espera
    if (status === "aguardando") {
      const now2 = (await regsOf(eid)).filter((r) => OCUPA(r.data.status)).sort((a, b) => (+a.data.at || 0) - (+b.data.at || 0) || (a.id < b.id ? -1 : 1));
      const pos = now2.findIndex((r) => r.id === id);
      if (pos >= total) { status = "espera"; await store.update("evregs", id, { status }); }
    }
    const fresh = (await regsOf(eid));
    return json({ ...regOut({ id, data: { ...base, status } }, true), vagas_disponiveis: vagasOf(ev, fresh).livres, ...(status === "aguardando" ? { pagamento: { valor_centavos: Math.round((+ev.data.price || 0) * 100), pix: ev.data.pix || null } } : { aviso: "Sem vagas no momento: a inscrição entrou na lista de espera." }) }, 201);
  }

  const [specs, profs, plansDoc] = await Promise.all([store.rows("specialties"), store.rows("professionals"), store.get("config", "plans")]);
  const ilPlan = interlifeOf(plansDoc);
  const specOfP = (p: Row) => specs.find((s) => s.id === p.data.spec);
  const specName = (id: string) => (specs.find((s) => s.id === id)?.data.name) || null;
  const pdata = rWa && (path === "/profissionais") ? await store.rows("profdata") : [];
  const profOut = (p: Row) => {
    const sp = specOfP(p), pr = procsOf(sp);
    const o: any = {
      id: p.id, nome: p.data.name, especialidade: specName(p.data.spec), especialidades: p.data.spec ? [{ id: p.data.spec, nome: specName(p.data.spec) }] : [],
      registro: p.data.reg || null, tipo: p.data.kind === "medico" ? "medico" : "profissional", ativo: p.data.active !== false,
      duracao_padrao_min: +p.data.dur || pr[0].d || 30, aceita_interlife: aceitaInterlife(ilPlan, p),
      idade_minima: Number.isFinite(+p.data.ageMin) && p.data.ageMin !== "" && p.data.ageMin != null ? +p.data.ageMin : null,
      idade_maxima: Number.isFinite(+p.data.ageMax) && p.data.ageMax !== "" && p.data.ageMax != null ? +p.data.ageMax : null,
    };
    if (rWa) {
      const d = pdata.find((x) => x.id === p.id)?.data || {};
      const nums = [d.tel, ...String(d.wa || "").split(/[,;\n]/)].map(wa55).filter((x) => x.length >= 12);
      const u = [...new Set(nums)];
      o.whatsapp = u[0] || null; o.whatsapps = u;
    }
    return o;
  };
  const procOut = (s: Row) => procsOf(s).map((p, i) => ({ id: s.id + ":" + i, nome: p.n, duracao_min: p.d, ...(rVal ? { valor_centavos: Math.round((+p.v || 0) * 100) } : {}) }));

  if (path === "/") {
    return json({ aplicativo: "Adintus Saúde", versao: 2, chave: K.data.name, permissoes: scopes,
      endpoints: ["/health", "/agenda", "/agendamentos (POST)", "/agendamentos/{id} (PATCH)", "/disponibilidade", "/pacientes", "/pacientes (POST)", "/pacientes/{id}", "/profissionais", "/especialidades", "/pacotes", "/eventos", "/eventos/{id}/vagas", "/eventos/{id}/inscricoes (GET, POST)", "/eventos/{id}/inscricoes/{id} (GET, PATCH)"] });
  }

  if (path === "/profissionais" || path === "/especialidades") {
    if (req.method !== "GET") return err(405, "metodo_nao_permitido", "Use GET.");
    const d = need("profissionais"); if (d) return d;
    if (path === "/especialidades") return page(specs.filter((s) => !profSet || profs.some((p) => p.data.spec === s.id && profOk(p.id))).map((s) => ({ id: s.id, nome: s.data.name, procedimentos: procOut(s) })));
    return page(profs.filter((p) => profOk(p.id)).map(profOut).sort((a, b) => String(a.nome).localeCompare(String(b.nome))));
  }

  // ---- horários livres ----
  if (path === "/disponibilidade") {
    if (req.method !== "GET") return err(405, "metodo_nao_permitido", "Use GET.");
    const d = need("agenda"); if (d) return d;
    const p = profs.find((x) => x.id === q.get("profissional_id"));
    if (!q.get("profissional_id")) return err(400, "dado_invalido", "Informe profissional_id.");
    if (!p || !profOk(p.id)) return err(404, "nao_encontrado", "Profissional não encontrado.");
    const from = relDate(q.get("de"), today, today) || today, to = relDate(q.get("ate"), today, from) || addDays(from, 13);
    if (days(from, to) < 0 || days(from, to) > 31) return err(400, "periodo_invalido", "Use ?de=AAAA-MM-DD&ate=AAAA-MM-DD com no máximo 31 dias.");
    if (q.get("especialidade_id") && q.get("especialidade_id") !== p.data.spec) return err(400, "especialidade_invalida", "Este profissional não atende essa especialidade.");
    const pr = procsOf(specOfP(p));
    let dur = +(q.get("duracao_min") || 0);
    if (q.get("procedimento_id")) {
      const ix = +String(q.get("procedimento_id")).split(":").pop()!, px = pr[ix];
      if (!String(q.get("procedimento_id")).startsWith(String(p.data.spec) + ":") || !px) return err(400, "procedimento_invalido", "Procedimento não encontrado para este profissional.");
      if (!dur) dur = px.d;
    }
    if (!dur) dur = +p.data.dur || pr[0].d || 30;
    if (!(dur >= 5 && dur <= 480)) return err(400, "dado_invalido", "duracao_min inválida.");
    const ctx = await loadCtx(store, profs, from, to), out: any[] = [];
    if (p.data.active !== false) for (let dt = from; dt <= to; dt = addDays(dt, 1)) {
      if (dt < today) continue;
      const hs: string[] = [];
      segsOf(p.data, dt, ctx, p.id).forEach((s) => { for (let st = s[0]; st + dur <= s[1]; st += slotOf(p.data)) {
        if (dt === today && st < now.min + 60) continue;
        if (slotCheck(ctx, p, dt, st, dur).ok) hs.push(hm(st));
      } });
      if (hs.length) out.push({ data: dt, horarios: [...new Set(hs)].sort() });
    }
    return json({ profissional_id: p.id, duracao_min: dur, dias: out });
  }

  // ---- consultas ----
  const apptOut = (a: Row, pts: Row[] | null) => {
    const p = profs.find((x) => x.id === a.data.prof), pt = pts && pts.find((x) => x.id === a.data.pid);
    const o: any = {
      id: a.id, data: a.data.date, hora: hm(a.data.start), inicio: hm(a.data.start), fim: hm(a.data.start + (a.data.dur || 0)), duracao_min: a.data.dur || 0,
      status: ST_NEW[a.data.status] || ST[a.data.status] || String(a.data.status), situacao: ST[a.data.status] || String(a.data.status),
      tipo: a.data.tipo || (a.data.retorno ? "retorno" : "consulta"), procedimento: a.data.proc || null, sala: a.data.local || null,
      especialidade: p ? specName(p.data.spec) : null,
      profissional: p ? { id: p.id, nome: p.data.name } : { id: a.data.prof, nome: null },
      paciente: { id: a.data.pid || null, nome: a.data.pac || null, ...(pts && pt ? { celular: pt.data.cel || null } : {}) },
      retorno: !!a.data.retorno, encaixe: !!a.data.encaixe, pacote: a.data.pkg ? { id: a.data.pkg, sessao: a.data.pkgN, total: a.data.pkgT } : null,
      cancelamento: a.data.cancelReason || null, origem: a.data.origem || null,
    };
    if (rVal) o.valor_centavos = Math.round((+a.data.val || 0) * 100);
    if (rConv) o.convenio = /interlife/i.test(a.data.conv || "") ? "interlife" : "particular";
    return o;
  };

  if (path === "/agenda") {
    if (req.method !== "GET") return err(405, "metodo_nao_permitido", "Use GET.");
    const d = need("agenda"); if (d) return d;
    const from = relDate(q.get("de"), today, today) || today, to = relDate(q.get("ate"), today, from) || addDays(from, 7);
    if (days(from, to) < 0 || days(from, to) > 92) return err(400, "periodo_invalido", "Use ?de=AAAA-MM-DD&ate=AAAA-MM-DD com no máximo 92 dias.");
    const withPt = scopes.includes("pacientes");
    const pts = withPt ? await store.rows("patients") : [];
    let l = (await store.rows("appointments", { gte: ["date", from], lte: ["date", to] })).filter((a) => profOk(a.data.prof));
    const pf = q.get("profissional_id") || q.get("profissional"), pc = q.get("paciente_id") || q.get("paciente"), st = q.get("status");
    if (pf) l = l.filter((a) => a.data.prof === pf);
    if (pc) l = l.filter((a) => a.data.pid === pc);
    if (q.get("telefone")) {
      if (!withPt) return need("pacientes")!;
      const ids = new Set(pts.filter((x) => samePhone(x.data.cel, q.get("telefone"))).map((x) => x.id));
      l = l.filter((a) => ids.has(a.data.pid));
    }
    if (st) l = l.filter((a) => ST[a.data.status] === st || ST_NEW[a.data.status] === st);
    l.sort((a, b) => (a.data.date + hm(a.data.start)).localeCompare(b.data.date + hm(b.data.start)));
    return page(l.map((a) => apptOut(a, withPt ? pts : null)));
  }

  if (path === "/agendamentos" || path.startsWith("/agendamentos/")) {
    const aid = decodeURIComponent(path.split("/")[2] || "");
    if (req.method === "GET") {
      const d = need("agenda"); if (d) return d;
      const a = aid ? await store.get("appointments", aid) : null;
      return a && profOk(a.data.prof) ? json({ data: apptOut(a, scopes.includes("pacientes") ? await store.rows("patients") : null) }) : err(404, "nao_encontrado", "Consulta não encontrada.");
    }
    if (!["ag_marcar", "ag_confirmar", "ag_cancelar", "ag_remarcar", "ag_convenio"].some((x) => scopes.includes(x))) return need("ag_marcar")!;
    const by = "api:" + (K.data.name || "chave"), stamp = stampBR(clock());

    if (req.method === "POST" && path === "/agendamentos") {
      const dm = need("ag_marcar"); if (dm) return dm;
      for (const f of ["paciente_id", "profissional_id", "data", "hora"]) if (!body[f]) return err(400, "dado_invalido", "Campo obrigatório ausente: " + f + ".");
      if (!isDate(body.data)) return err(400, "dado_invalido", "data precisa estar no formato AAAA-MM-DD.");
      if (!isHora(body.hora)) return err(400, "dado_invalido", "hora precisa estar no formato HH:MM.");
      const tipo = body.tipo || "consulta", conv = body.convenio || "particular";
      if (!["consulta", "retorno", "sessao"].includes(tipo)) return err(400, "dado_invalido", "tipo aceita consulta, retorno ou sessao.");
      if (!["particular", "interlife"].includes(conv)) return err(400, "dado_invalido", "convenio aceita particular ou interlife.");
      if (body.valor_centavos != null && !(Number.isInteger(body.valor_centavos) && body.valor_centavos >= 0)) return err(400, "dado_invalido", "valor_centavos precisa ser um número inteiro, em centavos.");
      const pt = await store.get("patients", String(body.paciente_id));
      if (!pt) return err(404, "paciente_nao_encontrado", "Paciente não encontrado.");
      const p = profs.find((x) => x.id === body.profissional_id);
      if (!p || !profOk(p.id)) return err(404, "profissional_nao_encontrado", "Profissional não encontrado.");
      if (p.data.active === false) return err(400, "profissional_inativo", "Este profissional está inativo.");
      if (body.especialidade_id && body.especialidade_id !== p.data.spec) return err(400, "especialidade_invalida", "Este profissional não atende essa especialidade.");
      const pr = procsOf(specOfP(p));
      let px = pr[0];
      if (body.procedimento_id) {
        const sid = String(body.procedimento_id), ix = +sid.split(":").pop()!;
        if (!sid.startsWith(String(p.data.spec) + ":") || !pr[ix]) return err(400, "procedimento_invalido", "Procedimento não encontrado para este profissional.");
        px = pr[ix];
      }
      const dur = body.duracao_min != null ? +body.duracao_min : (+p.data.dur && !body.procedimento_id ? +p.data.dur : px.d) || 30;
      if (!(Number.isInteger(dur) && dur >= 5 && dur <= 480)) return err(400, "dado_invalido", "duracao_min inválida.");
      const ilP = conv === "interlife" ? interlifeOf(await store.get("config", "plans")) : null;
      if (conv === "interlife" && !aceitaInterlife(ilP, p)) return err(400, "convenio_nao_aceito", "Este profissional não atende pelo convênio Interlife.");
      const nasc = pt.data.nasc;
      if (isDate(nasc)) {
        const idade = ageOn(nasc, body.data), mn = p.data.ageMin, mx = p.data.ageMax;
        if ((mn !== "" && mn != null && idade < +mn) || (mx !== "" && mx != null && idade > +mx))
          return err(400, "idade_nao_atendida", "Este profissional atende " + (mn !== "" && mn != null ? "a partir de " + mn + " anos" : "") + (mn !== "" && mn != null && mx !== "" && mx != null ? " e " : "") + (mx !== "" && mx != null ? "até " + mx + " anos" : "") + ".");
      }
      const start = toMin(body.hora);
      if (body.data < today || (body.data === today && start <= now.min)) return err(400, "data_passada", "Não é possível agendar em data ou horário que já passou.");
      const ctx = await loadCtx(store, profs, body.data, body.data);
      const dup = ctx.appts.find((a) => a.data.prof === p.id && a.data.pid === pt.id && a.data.start === start && !FREE[a.data.status]);
      if (dup) return err(409, "agendamento_duplicado", "Este paciente já tem consulta neste horário com este profissional.", { id: dup.id });
      const chk = slotCheck(ctx, p, body.data, start, dur);
      if (!chk.ok) { const c = chk as { codigo: string; msg: string }; return err(409, c.codigo, c.msg); }
      let pk: Row | null = null, pkN = 0;
      if (body.pacote_id) {
        pk = await store.get("packages", String(body.pacote_id));
        if (!pk || pk.data.pid !== pt.id || pk.data.status === "cancelado") return err(404, "pacote_nao_encontrado", "Pacote não encontrado para este paciente.");
        const used = (await store.rows("appointments", { gte: ["date", addDays(today, -400)] })).filter((a) => a.data.pkg === pk!.id && !FREE[a.data.status]).length;
        if (used >= pk.data.n) return err(409, "pacote_completo", "Todas as sessões deste pacote já estão marcadas.");
        pkN = used + 1;
      }
      const cartN = body.carteirinha != null ? String(body.carteirinha).trim().slice(0, 40) : "";
      if (conv === "interlife" && ilP?.cart?.req && !cartN) return err(400, "dado_invalido", "carteirinha é obrigatória para o Interlife.");
      const pxIx = Math.max(0, pr.indexOf(px));
      const val = pk ? 0 : body.valor_centavos != null ? body.valor_centavos / 100 : tipo === "retorno" ? 0 : conv === "interlife" ? planPrice(ilP, p, pxIx, +px.v || 0) : (+px.v || 0);
      const d: any = {
        roomId: chk.roomId, local: chk.room, prof: p.id, date: body.data, start, dur, proc: px.n, val,
        conv: conv === "interlife" ? (ilP?.name || "Interlife") : "Particular", status: 1, obs: String(body.observacao || "").slice(0, 500),
        encaixe: false, retorno: tipo === "retorno", retOf: "", tipo, pid: pt.id, pac: pt.data.name, paid: !!pk, forma: pk ? "Pacote" : "",
        log: [{ s: 1, t: stamp }], by, ...(cartN ? { cart: cartN } : {}), at: clock().getTime(), origem: String(body.origem || ORIGEM).slice(0, 60),
        ...(pk ? { pkg: pk.id, pkgN: pkN, pkgT: pk.data.n } : {}),
      };
      const id = rid();
      if (!(await store.insert("appointments", id, d))) return err(500, "erro_interno", "Não foi possível gravar. Tente de novo.");
      // conferência final: se outra pessoa gravou o mesmo horário no mesmo instante, quem chegou primeiro fica
      const again = await store.rows("appointments", { gte: ["date", body.data], lte: ["date", body.data] });
      const rival = again.find((a) => a.id !== id && a.data.prof === p.id && !FREE[a.data.status] && a.data.start < start + dur && a.data.start + a.data.dur > start && ((a.data.at || 0) < d.at || ((a.data.at || 0) === d.at && a.id < id)));
      if (rival) { await store.remove("appointments", id); return err(409, "horario_ocupado", "Este horário acabou de ser ocupado por outra pessoa."); }
      return json({ ...apptOut({ id, data: d }, null), id }, 201);
    }

    if (req.method === "PATCH" && aid) {
      const a = await store.get("appointments", aid);
      if (!a || !profOk(a.data.prof)) return err(404, "nao_encontrado", "Consulta não encontrada.");
      const p = profs.find((x) => x.id === a.data.prof);
      const unk = Object.keys(body || {}).filter((f) => !["status", "motivo", "data", "hora", "convenio", "valor_centavos", "carteirinha", "origem"].includes(f));
      if (unk.length) return err(400, "dado_invalido", "Campo desconhecido: " + unk.join(", ") + ". Aceitos: status, motivo, data, hora, convenio, valor_centavos, carteirinha, origem.");
      const wantsMove = body.data != null || body.hora != null, wantsStatus = body.status != null;
      const wantsConv = body.convenio != null || body.valor_centavos != null || body.carteirinha != null;
      if (wantsMove) { const dr = need("ag_remarcar"); if (dr) return dr; }
      if (wantsStatus) { const ds = need(body.status === "cancelado" ? "ag_cancelar" : "ag_confirmar"); if (ds) return ds; }
      if (wantsConv) { const dc = need("ag_convenio"); if (dc) return dc; }
      if (!wantsMove && !wantsStatus && !wantsConv) return err(400, "dado_invalido", "Envie status, data e hora para remarcar, ou convenio para trocar o plano.");
      if (wantsConv && (wantsMove || body.status === "cancelado")) return err(400, "dado_invalido", "Trocar o convênio é um pedido separado de cancelar ou remarcar.");
      let convPatch: any = {};
      if (wantsConv) {
        if (a.data.status === 3 || a.data.status === 2 || a.data.status === 6 || FREE[a.data.status]) return err(409, "status_nao_permite", "Esta consulta não pode ser alterada no estado atual (" + (ST_NEW[a.data.status] || ST[a.data.status] || a.data.status) + ").");
        if (a.data.paid || a.data.pkg) return err(409, "troca_nao_permitida", "Esta consulta já tem pagamento registrado ou é de pacote. A troca precisa ser feita pela recepção.");
        if (body.convenio != null && !["particular", "interlife"].includes(body.convenio)) return err(400, "dado_invalido", "convenio aceita particular ou interlife.");
        if (body.valor_centavos != null && !(Number.isInteger(body.valor_centavos) && body.valor_centavos >= 0)) return err(400, "dado_invalido", "valor_centavos precisa ser um número inteiro, em centavos.");
        const atual = /interlife/i.test(a.data.conv || "") ? "interlife" : "particular", novo = body.convenio != null ? body.convenio : atual;
        const ilC = novo === "interlife" ? interlifeOf(await store.get("config", "plans")) : null;
        if (novo === "interlife" && (!p || !aceitaInterlife(ilC, p))) return err(400, "convenio_nao_aceito", "Este profissional não atende pelo convênio Interlife.");
        const cartC = body.carteirinha != null ? String(body.carteirinha).trim().slice(0, 40) : "";
        if (body.carteirinha != null && novo !== "interlife") return err(400, "dado_invalido", "carteirinha só vale para o convênio Interlife.");
        if (novo === "interlife" && ilC?.cart?.req && !(cartC || a.data.cart)) return err(400, "dado_invalido", "carteirinha é obrigatória para o Interlife.");
        let novoVal = +a.data.val || 0;
        if (body.valor_centavos != null) novoVal = body.valor_centavos / 100;
        else if (body.convenio != null) {
          const prs = procsOf(specs.find((x) => x.id === p?.data.spec)), ixc = Math.max(0, prs.findIndex((x) => x.n === a.data.proc)), basec = +(prs[ixc]?.v) || 0;
          novoVal = novo === "interlife" ? planPrice(ilC, p!, ixc, basec) : basec;
        }
        const nomeNovo = novo === "interlife" ? (ilC?.name || "Interlife") : "Particular";
        convPatch = { conv: nomeNovo, val: novoVal, ...(cartC ? { cart: cartC } : {}), convHist: (a.data.convHist || []).concat([{ at: clock().getTime(), by, origem: String(body.origem || ORIGEM).slice(0, 60), de: { conv: a.data.conv || "Particular", val: +a.data.val || 0 }, para: { conv: nomeNovo, val: novoVal }, ...(cartC ? { cart: cartC } : {}) }]) };
      }
      const patch: any = {}, st0 = a.data.status;
      let log = (a.data.log || []).slice();
      if (wantsStatus && !["confirmado", "cancelado", "agendado"].includes(body.status))
        return err(400, "status_invalido", "Por aqui só dá para confirmar, cancelar ou voltar para agendado. Os demais status são feitos pela clínica.");
      if (wantsStatus && body.status === "cancelado" && wantsMove) return err(400, "dado_invalido", "Cancelar e remarcar são pedidos separados.");
      if (wantsStatus && body.status === "cancelado") {
        if (CANC(st0)) return json({ ...apptOut(a, null), id: a.id }, 200);
        if (st0 === 3 || st0 === 2 || st0 === 6) return err(409, "status_nao_permite", "Esta consulta já foi atendida ou iniciada e não pode ser cancelada por aqui.");
        patch.status = 22; patch.cancelReason = String(body.motivo || "").slice(0, 300); patch.canceledAt = clock().getTime(); patch.canceledBy = by;
        log.push({ s: 22, t: stamp });
      } else {
        if (st0 === 3 || st0 === 2 || st0 === 6 || FREE[st0]) return err(409, "status_nao_permite", "Esta consulta não pode ser alterada no estado atual (" + (ST_NEW[st0] || ST[st0] || st0) + ").");
        if (wantsMove) {
          const nd = body.data != null ? body.data : a.data.date, nh = body.hora != null ? body.hora : hm(a.data.start);
          if (!isDate(nd) || !isHora(nh)) return err(400, "dado_invalido", "Use data AAAA-MM-DD e hora HH:MM.");
          const ns = toMin(nh);
          if (nd < today || (nd === today && ns <= now.min)) return err(400, "data_passada", "Não é possível remarcar para data ou horário que já passou.");
          if (!p) return err(404, "profissional_nao_encontrado", "Profissional da consulta não encontrado.");
          const ctx = await loadCtx(store, profs, nd, nd), chk = slotCheck(ctx, p, nd, ns, a.data.dur, a.id);
          if (!chk.ok) { const c = chk as { codigo: string; msg: string }; return err(409, c.codigo, c.msg); }
          patch.date = nd; patch.start = ns; patch.roomId = chk.roomId; patch.local = chk.room;
          patch.hist = (a.data.hist || []).concat([{ date: a.data.date, start: a.data.start, local: a.data.local || "", at: clock().getTime(), by }]);
          patch.status = 1; patch.waAt = null; patch.movedAt = clock().getTime();
          log.push({ s: 15, t: stamp }); log.push({ s: 1, t: stamp });
        }
        if (wantsStatus) {
          const ns = body.status === "confirmado" ? 7 : 1;
          if (!(wantsMove && ns === 1)) { patch.status = ns; log.push({ s: ns, t: stamp }); }
        }
      }
      patch.log = log;
      Object.assign(patch, convPatch);
      await store.update("appointments", a.id, patch);
      if (patch.date) {
        const again = await store.rows("appointments", { gte: ["date", patch.date], lte: ["date", patch.date] });
        const me = { ...a.data, ...patch };
        const rival = again.find((x) => x.id !== a.id && x.data.prof === a.data.prof && !FREE[x.data.status] && x.data.start < me.start + me.dur && x.data.start + x.data.dur > me.start && ((x.data.movedAt || x.data.at || 0) < patch.movedAt));
        if (rival) { await store.update("appointments", a.id, { date: a.data.date, start: a.data.start, roomId: a.data.roomId || "", local: a.data.local || "", status: st0, log: a.data.log || [], hist: a.data.hist || [] }); return err(409, "horario_ocupado", "Este horário acabou de ser ocupado por outra pessoa."); }
      }
      return json({ ...apptOut({ id: a.id, data: { ...a.data, ...patch } }, null), id: a.id });
    }
    return err(404, "nao_encontrado", "Endereço não existe. Veja a lista em GET /.");
  }

  // ---- pacientes ----
  if (path === "/pacientes" || path.startsWith("/pacientes/")) {
    const d = need("pacientes"); if (d) return d;
    const out = (p: Row) => {
      const o: any = { id: p.id, nome: p.data.name, prontuario: p.data.pront || null, celular: p.data.cel || null, telefone: wa55(p.data.cel) || null, nascimento: p.data.nasc || null, sexo: p.data.sexo || null, cadastrado_em: p.data.createdAt || null };
      if (pCpf) o.cpf = digits(p.data.cpf) || null;
      if (pMail) o.email = p.data.email || null;
      if (pResp) o.responsavel = p.data.resp && p.data.resp.nome ? { nome: p.data.resp.nome, parentesco: p.data.resp.parentesco || null } : null;
      if (rConv) o.convenio = String(p.data.convenio || "particular").toLowerCase() === "interlife" ? "interlife" : "particular";
      return o;
    };
    const all = await store.rows("patients");
    if (req.method === "POST") {
      if (path !== "/pacientes") return err(404, "nao_encontrado", "Endereço não existe.");
      const dw = need("pac_cadastrar"); if (dw) return dw;
      const nome = String(body.nome || "").trim().replace(/\s+/g, " ");
      if (nome.length < 3 || nome.length > 120) return err(400, "dado_invalido", "Informe o nome completo do paciente.");
      if (body.nascimento != null && body.nascimento !== "" && (!isDate(body.nascimento) || body.nascimento > today || body.nascimento < "1900-01-01")) return err(400, "dado_invalido", "nascimento precisa estar no formato AAAA-MM-DD e não pode ser futuro.");
      const tel = digits(body.telefone); const tel2 = tel.startsWith("55") && tel.length >= 12 ? tel.slice(2) : tel;
      if (body.telefone && !(tel2.length === 10 || tel2.length === 11)) return err(400, "dado_invalido", "telefone inválido. Use DDD + número, por exemplo 5561999998888.");
      const cpf = digits(body.cpf);
      if (body.cpf && !cpfOk(cpf)) return err(400, "dado_invalido", "CPF inválido.");
      if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email))) return err(400, "dado_invalido", "E-mail inválido.");
      const conv = body.convenio || "particular";
      if (!["particular", "interlife"].includes(conv)) return err(400, "dado_invalido", "convenio aceita particular ou interlife.");
      const rs = body.responsavel && body.responsavel.nome ? { nome: String(body.responsavel.nome).trim().slice(0, 120), parentesco: String(body.responsavel.parentesco || "").trim().slice(0, 40) } : null;
      const dup = all.find((x) => (cpf && digits(x.data.cpf) === cpf) || (norm(x.data.name) === norm(nome) && (body.nascimento ? x.data.nasc === body.nascimento : !x.data.nasc && false)));
      if (dup) return err(409, "paciente_existente", "Já existe um paciente com este CPF, ou com o mesmo nome e nascimento.", { id: dup.id });
      let m = 0; all.forEach((x) => { if (+x.data.pront > m) m = +x.data.pront; });
      const doc: any = { name: nome, cel: tel2 ? maskTel(tel2) : "", nasc: body.nascimento || "", cpf: cpf ? maskCpf(cpf) : "", sexo: "", email: body.email ? String(body.email).trim() : "", resp: rs, convenio: conv,
        pront: m + 1, createdAt: clock().getTime(), origem: String(body.origem || ORIGEM).slice(0, 60), createdBy: "api:" + (K.data.name || "chave") };
      const id = rid();
      if (!(await store.insert("patients", id, doc))) return err(500, "erro_interno", "Não foi possível gravar. Tente de novo.");
      return json({ ...out({ id, data: doc }), id }, 201);
    }
    if (req.method !== "GET") return err(405, "metodo_nao_permitido", "Use GET ou POST.");
    if (path !== "/pacientes") {
      const id = decodeURIComponent(path.split("/")[2] || ""), p = all.find((x) => x.id === id);
      return p ? json({ data: out(p) }) : err(404, "nao_encontrado", "Paciente não encontrado.");
    }
    let l = all;
    if (q.get("cpf")) { if (!pCpf) return need("ver_cpf")!; const c = digits(q.get("cpf")); l = l.filter((p) => digits(p.data.cpf) === c); }
    if (q.get("telefone")) l = l.filter((p) => samePhone(p.data.cel, q.get("telefone")));
    if (q.get("nascimento")) l = l.filter((p) => p.data.nasc === q.get("nascimento"));
    const n = norm(q.get("q"));
    if (n) l = l.filter((p) => norm(p.data.name).includes(n));
    return page(l.sort((a, b) => String(a.data.name).localeCompare(String(b.data.name))).map(out));
  }

  if (path === "/pacotes") {
    if (req.method !== "GET") return err(405, "metodo_nao_permitido", "Use GET.");
    const d = need("pacotes"); if (d) return d;
    const appts = await store.rows("appointments", { gte: ["date", addDays(today, -400)] });
    let l = (await store.rows("packages")).filter((p) => profOk(p.data.prof)).map((p) => {
      const ss = appts.filter((a) => a.data.pkg === p.id), feitas = ss.filter((a) => a.data.status === 3).length;
      const estado = p.data.status === "cancelado" ? "cancelado" : !p.data.paid ? "aguardando_pagamento" : feitas >= p.data.n ? "concluido" : "em_andamento";
      const pr = profs.find((x) => x.id === p.data.prof);
      return { id: p.id, estado, paciente: { id: p.data.pid, nome: p.data.pac }, profissional: pr ? { id: pr.id, nome: pr.data.name } : null, procedimento: p.data.proc, sessoes: p.data.n, realizadas: feitas, marcadas: ss.filter((a) => !FREE[a.data.status]).length, pago: !!p.data.paid, criado_em: p.data.at || null };
    });
    if (q.get("estado")) l = l.filter((p) => p.estado === q.get("estado"));
    if (q.get("paciente_id")) l = l.filter((p) => p.paciente.id === q.get("paciente_id"));
    return page(l);
  }

  return err(404, "nao_encontrado", "Endereço não existe. Veja a lista em GET /.");
  }
}
const CANC = (s: number) => s === 11 || s === 22;

// ---- execução no Supabase (não roda nos testes) ----
declare const Deno: any;
if (typeof Deno !== "undefined" && Deno.serve) {
  // @ts-ignore (módulo remoto do Deno)
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const store: Store = {
    async rows(coll, f) {
      const out: { id: string; data: any }[] = [];
      for (let o = 0; o < 20000; o += 1000) {
        let qy = sb.from("docs").select("id,data").eq("coll", coll);
        if (f?.gte) qy = qy.gte("data->>" + f.gte[0], f.gte[1]);
        if (f?.lte) qy = qy.lte("data->>" + f.lte[0], f.lte[1]);
        const { data, error } = await qy.order("id").range(o, o + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
    async get(coll, id) {
      const { data, error } = await sb.from("docs").select("id,data").eq("coll", coll).eq("id", id).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async insert(coll, id, data) {
      const { error } = await sb.from("docs").insert({ coll, id, data });
      if (error) { if (String(error.code) === "23505") return false; throw error; }
      return true;
    },
    async update(coll, id, patch) { const { error } = await sb.rpc("doc_merge", { p_coll: coll, p_id: id, p_patch: patch }); if (error) throw error; },
    async remove(coll, id) { const { error } = await sb.from("docs").delete().eq("coll", coll).eq("id", id); if (error) throw error; },
    async touch(id, patch) { await sb.rpc("doc_merge", { p_coll: "apikeys", p_id: id, p_patch: patch }); },
  };
  Deno.serve((req: Request) => handle(req, store).catch((e) => { console.error(e); return err(500, "erro_interno", "Erro inesperado. Tente de novo."); }));
}
