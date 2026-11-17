# Configurar o Ad+ Saúde para uma nova clínica

Faça na ordem. Reserve 2 a 3 horas na primeira vez. Use sempre um repositório **novo e privado** criado a partir deste modelo (nunca dados reais aqui).

## 0. Antes de começar: reunir os dados da clínica
- Nome da clínica e nome curto; logo (PNG e SVG, fundo claro e escuro); cores.
- Domínio e subdomínios (ex.: `prontuario.CLINICA.com.br`, `eventos.CLINICA.com.br`).
- E-mail do administrador (dono do sistema) e e-mail remetente (ex.: `agenda@CLINICA.com.br`).
- Lista de profissionais (nome, especialidade, registro, e-mail), salas, horários, procedimentos e valores.
- Taxas da maquininha (por bandeira), chave Pix, WhatsApp da clínica.

## 1. Contas e projetos (uma conta e um projeto **por clínica**)
1. **Supabase:** criar um projeto novo (região São Paulo). Anotar a **Project URL** e a chave **publishable/anon**. Nunca reutilizar o projeto de outra clínica: os dados dos pacientes não podem se misturar.
2. **Cloudflare Pages:** criar dois projetos: um para `site/` e outro para `site-eventos/` (opcional). Ligar o domínio.
3. **Resend:** criar conta, **verificar o domínio** da clínica e gerar a chave de API.
4. Se possível, **plano Pro do Supabase** (inclui backup diário). No plano gratuito não há backup.

## 2. Trocar os dados de origem no código
Rode `bash scripts/achar-dados-da-clinica.sh`. Ele lista todos os pontos que ainda são da Adintus. Os principais:
- **URL do projeto Supabase e chave publishable** no `site/index.html`, no `site/p.html`, no `site-eventos/app.js`, `site-eventos/_headers` e `site-eventos/_worker.js`.
- **Domínios** (`prontuario.…`, `eventos.…`) em `index.html`, funções e `site-eventos`.
- **E-mails** (administrador, remetente) em `index.html` e nas funções (`AGENDA_ADMIN_EMAILS`, `LINK_FROM`).
- **Nome da clínica**, logo, `manifest.webmanifest`, ícones, título das páginas e textos "Adintus Saúde".
- **Exemplos** (evento de exemplo com profissional e valor; conta de teste da assinatura digital): remover ou trocar.
- Trocar os arquivos de `site/icon-*.png`, `favicon.ico`, `apple-touch-icon.png` e `modelo-papel-timbrado-*.docx` pelos da nova clínica.

Depois de trocar, rodar o script de novo: o resultado deve ficar vazio.

## 3. Banco (Supabase › SQL Editor), nesta ordem
1. Tabelas base (`docs`, `profiles`, `doc_merge`, regras de acesso). **Atenção:** as tabelas e regras base do app ainda não estão em um arquivo SQL único neste modelo. Elas devem ser extraídas do projeto de origem (ver "Pendências do modelo" abaixo) antes de criar uma clínica nova.
2. `adintus-duplicidade-supabase.sql`
3. `adintus-link-supabase.sql`
4. `adintus-eventos-supabase.sql`, `adintus-eventos-regras-supabase.sql`, `adintus-eventos-caixa-supabase.sql`
5. `adintus-trava-registro-concluido-supabase.sql`
6. `adintus-agenda-email-supabase.sql` e `adintus-suporte-supabase.sql`: trocar `COLE_AQUI_O_SEGREDO` **somente no editor do Supabase** (o mesmo texto do segredo da função).

## 4. Funções (Supabase › Edge Functions)
Para cada arquivo de `supabase/functions/`: criar a função com o mesmo nome, colar o código, **desligar "Verify JWT"** nas funções públicas (`adintus-link`, `adintus-agenda-email`, `adintus-inscricao`, `adintus-suporte`) e publicar.
Segredos (Edge Functions › Secrets): `RESEND_API_KEY`, `AGENDA_CRON_SECRET`, `AGENDA_ADMIN_EMAILS`, `LINK_FROM`, `LINK_BASE`, `INSCRICAO_ORIGINS`; opcional `ANTHROPIC_API_KEY`. **Nunca** colocar valores no repositório.

## 5. Publicar e testar
1. Subir `site/` no Cloudflare (zip com `index.html` na raiz).
2. Criar o primeiro usuário no Supabase Auth e marcá-lo como administrador; entrar e cadastrar profissionais, salas e procedimentos.
3. Teste de ponta a ponta: cadastrar paciente → agendar → check-in → atendimento → finalizar com receita → enviar link → abrir `p.html` no celular → fechar o caixa.
4. Conferir o e-mail de teste (inclusive spam) e o rodapé com a versão.

## 6. Rotina de trabalho
- Mudanças só por commit, com mensagem clara. Aumentar `APP_VER` e `site/versao.json` juntos.
- Backup: ativar o do Supabase; guardar fora do repositório.
- LGPD: dados de pacientes **nunca** vão para o repositório.

## Pendências do modelo (a fazer ao criar a 2ª clínica)
- Extrair do Supabase de origem o **SQL das tabelas e regras base** (`docs`, `profiles`, RLS, `doc_merge`) em um arquivo único.
- Transformar os textos e dados da clínica em um **arquivo de configuração único** (hoje estão espalhados no código; o script acima os localiza).
- Ver os itens "não construir sem aprovação" em `FUNCOES.md`.
