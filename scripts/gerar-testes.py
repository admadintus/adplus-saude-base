#!/usr/bin/env python3
"""Gera versões de TESTE do Ad+ Saúde, uma por clínica, sem servidor.

Uso:  python3 scripts/gerar-testes.py [pasta_saida]
Lê:   site/index.html (modelo base) + testes/clinicas.json + testes/demo-shim.js
Gera: <saida>/index.html (lista das clínicas) e <saida>/<slug>/index.html (app de teste)

Cada app de teste:
- não usa Supabase (o banco fica no navegador, localStorage), nem chama nenhuma função de servidor;
- vem com profissionais, pacientes e agenda FICTÍCIOS;
- tem a barra vermelha "TESTE" para trocar de perfil (Administrador, Recepção, cada Profissional).
"""
import base64, html, json, os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, 'testes', 'saida')

base = open(os.path.join(RAIZ, 'site', 'index.html'), encoding='utf8').read()
shim = open(os.path.join(RAIZ, 'testes', 'demo-shim.js'), encoding='utf8').read()
cfg = json.load(open(os.path.join(RAIZ, 'testes', 'clinicas.json'), encoding='utf8'))


def troca_uma(s, velho, novo):
    n = s.count(velho)
    if n < 1:
        raise SystemExit('Não achei no modelo: ' + velho[:80])
    return s.replace(velho, novo)


def svg_texto(txt, cor, w, h, fs_max):
    fs = min(fs_max, int(w * 0.96 / max(1, len(txt) * 0.52)))
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
            '<text x="0" y="%d" font-family="Georgia,\'Times New Roman\',serif" font-size="%d" font-weight="600" fill="%s">%s</text></svg>'
            % (w, h, w, h, int(h / 2 + fs * 0.35), fs, cor, html.escape(txt)))


def data_uri(svg):
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode('utf8')).decode()


def gera(c):
    s = base
    nome, curto = c['nome'], c['curto']
    js = lambda t: t.replace('\\', '\\\\').replace("'", "\\'")

    # 1) camada do Supabase -> banco local de teste
    a = s.find('<script>// Adintus Saúde · camada de conexão')
    b = s.find('</script>', a) + len('</script>')
    assert a > 0 and b > a
    clin = dict(c)
    s = s[:a] + '<script>window.__CLIN=' + json.dumps(clin, ensure_ascii=False) + ';</script>\n<script>' + shim + '</script>' + s[b:]
    s = troca_uma(s, '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>\n', '')

    # 2) nenhum endereço do servidor da Adintus pode sobrar
    s = s.replace('https://umkrepbjtnjwzgpujgxi.supabase.co', 'https://servidor-desligado-no-teste.invalid')
    s = s.replace('mjuniorgdias@gmail\\.com', 'ninguem@teste\\.invalid')

    # 3) logos (cabeçalho e tela de entrada): texto com o nome da clínica
    for _ in range(2):
        i = s.find('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="66 200 708 190"')
        j = s.find('</svg>', i) + 6
        assert i > 0
        w = int(len(curto) * 150 * 0.52) + 20
        logo = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d 190" role="img" aria-label="%s">'
                '<text x="0" y="145" style="fill:var(--lg-ad,currentColor);font-family:\'DM Serif Display\',Georgia,serif" font-size="150">%s</text></svg>'
                % (w, html.escape(curto), html.escape(curto)))
        s = s[:i] + logo + s[j:]
    s = s.replace('<span class="brand-tag">SAÚDE</span>', '<span class="brand-tag">TESTE</span>')
    s = s.replace('<span class="au-tag">SAÚDE</span>', '<span class="au-tag">TESTE</span>')

    # 4) logos dos documentos e papel timbrado padrão
    i = s.find("var DOC_LOGO_W='")
    j = s.find(",DOC_LOGO_RATIO=", i)
    assert i > 0 and j > i
    s = s[:i] + "var DOC_LOGO_W='" + data_uri(svg_texto(curto, c.get('cor', '#004346'), 774, 200, 110)) + "',DOC_LOGO_G='" + data_uri(svg_texto(curto, '#FFFFFF', 774, 200, 110)) + "'" + s[j:]
    i = s.find("LH_DEF='")
    j = s.find("'", i + 8)
    s = s[:i] + "LH_DEF=(window.__CLIN_LH||'')" + s[j + 1:]

    # 5) textos da clínica de origem
    s = s.replace("speaker:'Dra. Giulia Pignata'", "speaker:''").replace("pix:'administrativo@adintus.com.br'", "pix:''")
    s = re.sub(r"Clínica Adintus - Saúde Integral e Humanizada\\nAvenida Contorno[^']*", js(nome) + '\\\\n' + js(c.get('tel', '')), s)
    s = s.replace('https://adintus.com.br/link-exemplo', 'https://exemplo.invalid/link')
    s = s.replace('eventos.adintus.com.br', 'eventos.exemplo.invalid')
    s = s.replace('<title>Adintus Saúde</title>', '<title>' + html.escape(curto) + ' · Prontuário (teste)</title>')
    s = s.replace('aria-label="Adintus – Saúde integral e humanizada"', 'aria-label="' + html.escape(nome) + '"')
    s = s.replace('Clínica Adintus', js(nome)).replace('Adintus Saúde', js(nome)).replace('Adintus', js(curto))
    s = s.replace('modelo-papel-timbrado-adintus.docx', '../modelo-papel-timbrado.docx')

    # 6) ícones: só o Ad+ (os da Adintus não vão junto)
    s = re.sub(r'<link rel="icon" href="favicon\.ico"[^\n]*manifest\.webmanifest">', '<link rel="icon" type="image/svg+xml" href="../adplus-icone.svg">', s)

    resto = re.findall(r'umkrepbjtnjwzgpujgxi|sb_publishable_|Giulia|Pignata|adintus\.com\.br', s)
    if resto:
        raise SystemExit('%s: sobrou dado de origem: %s' % (c['slug'], sorted(set(resto))))
    return s


def pagina_lista(cl):
    def card(c):
        n = len(c['profs'])
        return ('<a class="card" href="%s/index.html" style="--c:%s"><span class="tag">%s</span><b>%s</b><span>%s</span>'
                '<small>%s · %d profissionais fictícios · %s</small></a>'
                % (c['slug'], c.get('cor', '#004346'), 'Plano Essencial' if c['plano'] == 'essencial' else 'Plano Centro',
                   html.escape(c['nome']), html.escape(c['area']), html.escape(c['porte']), n, html.escape(c['tel'])))
    ess = ''.join(card(c) for c in cl if c['plano'] == 'essencial')
    cen = ''.join(card(c) for c in cl if c['plano'] == 'centro')
    return '''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Ad+ Saúde · prontuários de teste</title>
<link rel="icon" type="image/svg+xml" href="adplus-icone.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Figtree:wght@400;500;600;700&display=swap">
<style>
:root{--bg:#F7FAF9;--fg:#0D1F22;--mut:#55707A;--bd:#D5E3E5;--sf:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0D1F22;--fg:#E6F1F2;--mut:#9FBBC0;--bd:#2A4A4E;--sf:#143033}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 Figtree,system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:40px 20px 60px}
h1{font:400 clamp(30px,5vw,44px)/1.1 'DM Serif Display',Georgia,serif;margin:0 0 8px}
h2{font:400 24px/1.2 'DM Serif Display',Georgia,serif;margin:36px 0 4px}
.lead{color:var(--mut);max-width:70ch;margin:0 0 6px}.sub{color:var(--mut);margin:0 0 14px;font-size:14px}
.warn{display:inline-block;background:#B23B3B;color:#fff;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;letter-spacing:.04em;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.card{display:flex;flex-direction:column;gap:4px;padding:18px 18px 16px;border:1px solid var(--bd);border-top:5px solid var(--c);border-radius:14px;background:var(--sf);color:inherit;text-decoration:none;transition:transform .12s,box-shadow .12s}
.card:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,.08)}
.card b{font-size:17px}.card span{color:var(--mut);font-size:14px}.card small{color:var(--mut);font-size:12px;margin-top:6px}
.card .tag{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--c)}
ol{color:var(--mut);font-size:14px;padding-left:20px;max-width:75ch}
</style></head><body><main>
<span class="warn">AMBIENTE DE TESTE · DADOS FICTÍCIOS</span>
<h1>Ad+ Saúde · prontuários de teste</h1>
<p class="lead">Uma cópia do modelo base para cada clínica-alvo de Planaltina-DF, com o nome da clínica, especialidades, salas e procedimentos da área. Profissionais, pacientes, agenda e valores são inventados.</p>
<ol>
<li>Abra uma clínica. Você entra como <b>Administrador</b>.</li>
<li>Pelo botão vermelho <b>TESTE</b> (canto inferior esquerdo) troque para <b>Recepção</b> ou para um <b>Profissional</b>. O prontuário e a evolução só aparecem no perfil Profissional.</li>
<li>Tudo o que você fizer fica só neste navegador. "Restaurar dados de exemplo" volta ao início. Nada é enviado a servidor: e-mail, link do paciente e suporte não funcionam no teste.</li>
</ol>
<h2>Terapias, saúde mental e fisioterapia</h2><p class="sub">Pequenas · plano Essencial</p><div class="grid">''' + ess + '''</div>
<h2>Médicas e oftalmologia</h2><p class="sub">Grandes · plano Centro</p><div class="grid">''' + cen + '''</div>
</main></body></html>'''


os.makedirs(SAIDA, exist_ok=True)
for c in cfg['clinicas']:
    os.makedirs(os.path.join(SAIDA, c['slug']), exist_ok=True)
    open(os.path.join(SAIDA, c['slug'], 'index.html'), 'w', encoding='utf8').write(gera(c))
open(os.path.join(SAIDA, 'index.html'), 'w', encoding='utf8').write(pagina_lista(cfg['clinicas']))
ic = os.path.join(RAIZ, 'brand', 'adplus-icone.svg')
open(os.path.join(SAIDA, 'adplus-icone.svg'), 'w', encoding='utf8').write(open(ic, encoding='utf8').read())
print('Gerado em', SAIDA, '·', len(cfg['clinicas']), 'clínicas')
