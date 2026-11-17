# Ad+ Saúde · todas as funções do aplicativo (modelo base, extraído da Clínica Adintus em 15/11/2026)

Descrição de tudo o que o sistema faz. Alguns exemplos citam a clínica de origem; troque pelos dados da nova clínica (ver `CONFIGURAR-NOVA-CLINICA.md`).

## 1. O que é e como está montado

- Sistema de **agenda + prontuário** para clínica multiprofissional (pt-BR). Dono e usuário: **Marcelo Gonçalves** (não programador; administrador; também é o pediatra "Marcelo Gonçalves Dias Junior"). Ele mesmo sobe cada zip no Cloudflare.
- **Site estático de um único arquivo** `index.html` (~1,2 MB, HTML+CSS+JS embutidos), publicado no Cloudflare Pages em `https://prontuario.adintus.com.br`. O código-fonte modular original (`src/p*.js`) foi perdido: edita-se **direto o `index.html` compilado** (texto).
- Arquivos do site: `index.html`, `p.html` (página pública do paciente), `versao.json` (`{"v":"14/11 19:30"}`, igual a `APP_VER`), ícones, `manifest.webmanifest`, `modelo-papel-timbrado-adintus.docx`.
- **Banco e login: Supabase**, projeto `umkrepbjtnjwzgpujgxi` (plano Free, **sem backup automático**; sugerido Pro). Tabela genérica `public.docs(coll, id, data jsonb)`; o app a usa por um wrapper `DB.collection/doc` (set = upsert, update = RPC `doc_merge`, uma nova tentativa automática em falha passageira, mensagem com o motivo real do erro). Perfis em `profiles`; papéis `admin`, `recepcao`, `profissional`.
- **Atualização automática:** a cada 2 min o app confere `versao.json`; se houver versão nova, mostra "Atualizar agora / Depois" e só atualiza sozinho quando a pessoa não está usando.
- **Eventos** têm uma página pública separada: `https://eventos.adintus.com.br` (outro projeto Cloudflare, `adintus-eventos`).

### Fluxo de cada entrega
1. Editar o `index.html` (patch em Python com `assert` de contagem; checar sintaxe extraindo o maior `<script>` e rodando `node --check`; testar com Playwright e Supabase simulado).
2. Subir `APP_VER` e `versao.json`, acrescentar entrada no `ATUALIZACOES.md` (e gravar no Projeto).
3. Zip do conteúdo do site (index.html na raiz) → Marcelo sobe no Cloudflare.
4. Funções do Supabase e SQL: Marcelo cola/clica (ou autoriza explicitamente que se faça).

### Regras combinadas com o Marcelo
- **Só o profissional vê o prontuário** (documentos emitidos são exceção: recepção/admin leem cópias).
- **Ilustrar/mostrar antes de aplicar** funções novas.
- **SQL/RLS e mudanças de segurança no Supabase: o usuário faz**, salvo pedido explícito.
- Nada de exclusão permanente (exclusão reversível, com motivo).
- Não publicar dados de pacientes; não colar chaves no chat; **não enviar WhatsApp/e-mail sem OK**.

## 2. Papéis e permissões

- **admin**: tudo, inclusive Financeiro, Acessos, Suporte, Contas do paciente, auditoria do caixa. Marcelo é o dono (`OWNER`).
- **recepcao**: Agenda, Espera/check-in, Confirmações, Pacientes (cadastra/edita), Pacotes, Caixa (próprio), Documentos emitidos, envio do link do paciente.
- **profissional**: Agenda e Espera (os seus), Pacientes (**ficha somente leitura**), Atendimento/prontuário, Eventos (só se ligado ao evento, 7 dias antes), Minha assinatura.
- O administrador ajusta permissões em Acessos (`config/perms`, linhas `PERM_ROWS`). Menu varia por papel (`navItems()`): Agenda, Espera, Confirmações, Pacientes, Pacotes, Eventos, Atendimento, Assinaturas (só teste), Suporte (admin), Documentos, Financeiro/Caixa, Cadastros, Acessos.

## 3. Agenda

- Agenda diária/semanal por profissional, salas, grade de horário, **encaixe** (só fora da grade/dia de atendimento).
- **Sem sobreposição**: não agenda um paciente em cima de outro (mostra quem ocupa o horário).
- **Bloqueios** de agenda por profissional ou **clínica inteira** ("Todos os profissionais", motivo padrão "Clínica fechada"; editar/remover vale para o grupo). Faixa única quando há bloqueios repetidos; aviso de bloqueio sobreposto ao criar.
- **+ Abrir agenda** (horário extra): só salas livres no horário e **motivo obrigatório** (Solicitação do médico, Reposição, Mutirão, Pedido da recepção, Outro).
- **Feriados**, aniversariantes, duração do **retorno** configurável por profissional (Cadastros › Profissionais).
- Cadastro do paciente › Agendamentos: botão **Ir para a agenda** (abre dia e profissional).
- **Confirmações** (recepção): envia pedido de confirmação (dia anterior/hoje) por WhatsApp; estados "Enviar confirmação" / "Enviar de novo" / "Entrar em contato".

## 4. Espera, check-in e pagamento

- Tela **Espera**: "Na clínica" (chamar pacientes) no topo, "Aguardando chegada", avisos de chegada. Linha do tempo por paciente (chegou → chamado → atendimento iniciado → finalizado).
- **Aviso de chegada** ao profissional em qualquer tela (cartão "Fulano chegou" com Abrir espera/Dispensar; também no sino).
- **Check-in e pagamento**: forma, parcelas, valor; **pagamento dividido** (+ "Adicionar outra forma"; `pays:[{f,v,parc}]`; o caixa separa dinheiro × cartão); **retorno** sem forma de pagamento (valor declarado; forma "Retorno", não entra no caixa); retorno pode ser vinculado a consultas realizadas, em atendimento, chamadas ou na clínica; paciente **familiar** (administrador marca).
- Sessão de **pacote** mostra "Pacote" em vez de valor.

## 5. Pacientes (ficha)

- Cadastro: nome, nascimento, sexo, CPF, contatos, endereço (busca por CEP), nº de prontuário fixo, familiar, histórico, agendamentos, link do paciente (recepção/admin), **Contas do paciente** (só admin: total pago, avulsas × pacotes, retornos, divergências, lista de pagamentos).
- **Profissional vê a ficha somente leitura** e não cadastra paciente novo (desde 14/11 19:30).
- Botão **Prontuário** (profissional) abre o atendimento.

## 6. Prontuário e atendimento (só profissional)

- Tela **Atendimento** com cronômetro (barra flutuante e arrastável), histórico de atendimentos anteriores, abas por especialidade. **Botão "Enviar link ao paciente"** no topo.
- **Medicina**: anamnese (editável durante o atendimento campo a campo, histórico de versões; depois de finalizar, **retificação** como novo registro ligado ao original; botão "Abrir anamnese do dia para editar"), evolução, prescrição (comum/controle especial), atestados, pedido de exames, laudos, encaminhamentos, **Salvar e concluir** (trava o registro no banco após concluir), transcrição por voz (Chrome/Edge, com diagnóstico do microfone).
- **Pediatria**: curvas de crescimento (OMS; exigem nascimento e sexo), impressão.
- **Nutrição**: antropometria (peso, altura, circunferências, **dobras cutâneas** incl. supraespinhal, bioimpedância, fórmulas como Pollock 7 sem torácica obrigatória; "cálculo parcial" avisa dobra faltando), IMC, composição corporal, **Evolução entre consultas** (gráfico de massa gorda/livre, peso, tabela e PDF no padrão do modelo), planejamento alimentar, prescrição de metas, **Atestado de comparecimento** (manhã/tarde).
- **Demais profissionais** (psicologia, fono etc.): anotações, transcrição, **Atestado de comparecimento**.
- Formulários abrem em branco; registros anteriores com **Editar**, **Excluir** (motivo obrigatório, reversível com Restaurar), horário do registro.
- **Impressão em papel timbrado**: texto dentro das margens em todas as páginas.
- **Minha assinatura** (todos os médicos): imagem da assinatura (foto ou desenho) impressa acima do nome/CRM nos documentos. **Não** é assinatura digital ICP-Brasil.
- **Assinatura digital de teste** (Certificado digital, menu Assinaturas): só no perfil de teste (mjuniorgdias@gmail.com); simulada, sem validade jurídica.
- Proteções: salvamento guarda versão anterior (até 25), campos de texto sem "tremer", tentativa automática ao falhar o salvamento.

## 7. Documentos emitidos

- Cópias de prescrição, atestado, pedido de exames (e laudo/encaminhamento) vão para a coleção `emitidos` (carregada só para quem não é profissional): a recepção/admin as veem em **Documentos**, imprimem (com a imagem da assinatura) e enviam ao paciente.
- Além disso (para o link do paciente) a mesma coleção guarda cópias de **planejamento (`nplan`), metas (`nmeta`), evolução nutricional (`nevo_<pid>`) e curvas (`curva_<pid>`)**; essas não aparecem na página Documentos, só no envio do link.

## 8. Link do paciente (envio de documentos)

- **Função** `adintus-link` (Edge Function, "Verify JWT" desligado; autentica o usuário internamente). Ações: `criar`, `listar`, `revogar`, `reenviar`, `url` (equipe) e `abrir` (paciente). Tabela `patient_links` (RLS ligada, sem políticas; só service_role).
- **Um único link ativo por paciente**: gerar/enviar de novo **acrescenta** os itens novos ao mesmo link (mesmo endereço), renova 30 dias; curvas e evolução são substituídas pela mais recente. Revogar permite criar outro.
- Quem envia: **profissional** (caixa ao finalizar e botão no atendimento; itens do dia já marcados; opção Finalizar sem enviar), **recepção/administrador** (ficha › "Gerar / atualizar e enviar link", com o que já foi emitido/guardado). Itens identificados por nome (ex.: "Prescrição · Amoxicilina +1"; exames pelo primeiro item).
- Itens possíveis: prescrições, atestados, exames, laudos, encaminhamentos, **curvas de crescimento**, **evolução nutricional**, **planejamento alimentar**, **metas**. Anotações/evolução clínica **não** são enviadas.
- Cópias para recepção/admin são gravadas quando o profissional salva medidas/planejamento/metas, compartilha, ou **abre o atendimento** do paciente (backfill).
- **E-mail** pelo Resend, remetente padrão `agenda@adintus.com.br` (domínio verificado); segredo opcional `LINK_FROM` troca o remetente. **WhatsApp** com mensagem editável (Cadastros › Mensagens › "Documentos (link)", sempre leva {link}).
- **Segurança**: paciente abre `p.html#TOKEN`, confirma data de nascimento + 4 primeiros dígitos do CPF; 5 erros = bloqueio de 30 min; validade 30 dias; revogável; máx. 30 links/hora por pessoa; 3 MB por link; repetição idêntica em 10 min reaproveitada; limpeza diária de vencidos há +90 dias.
- **Página do paciente** (`p.html`): lista e abre os documentos; botões **Salvar como foto** (PNG; no celular compartilhar → galeria), **Baixar PDF**, **Enviar PDF** (compartilhar), **Imprimir** (bibliotecas html2canvas/jsPDF via cdnjs).
- Segredos da função: `RESEND_API_KEY`; opcionais `LINK_FROM`, `LINK_BASE`, `AGENDA_ADMIN_EMAILS`.

## 9. Pacotes de sessões

- Telas: **Em andamento** (abre aqui), Aguardando pagamento, Concluídos, Cancelados, Todos.
- Criar pacote (paciente, profissional, procedimento, nº de sessões, valor, validade, forma); sem pagamento as sessões **reservam a agenda** ("Pacote n/t · não pago"); ao pagar, são marcadas pagas. Proteção contra duplo clique e pacote igual em <10 min.
- **Editar pacote** com **Histórico** (criação, pagamento, edições, cancelamento); cancelar cancela sessões futuras. "Ver detalhes das sessões".
- **Regra financeira**: o pacote conta **uma vez**, pelo valor total, no dia em que o pagamento é registrado (caixa, fluxo, lançamentos, repasse; sessões não somam valor).
- **Pacote retroativo** (até 14/12/2026): lista de sessões com data/horário/situação (Automático, Realizada, Agendada, Sem data); entra como pago na data informada e fora do caixa.
- **Sessões anteriores ao sistema** (`prior`): cartão mostra "3 de 5 realizadas (3 anteriores ao sistema)"; calculado pela menor numeração lançada, editável no pacote ("Sessões já feitas antes do sistema"). Casos: Enzo Gabriel (3) e Heloísa (2).

## 10. Financeiro e caixa

- **Caixa** por pessoa (a partir de 15/11/2026: cada conta tem o seu caixa do dia; antes, fechamento único da clínica). Abertura automática no primeiro acesso, fechamento até 18h (recepção), campo em branco vale 0,00. Detalhe **Pagamentos do dia** por forma, pacote em uma linha.
- **Administrador**: seletor "Caixa de:", **auditoria um por um** (Conferido/Divergente com descrição, desfazer, aviso se o valor mudou), **Caixas com pendência**, **Fechamentos anteriores** (60 dias).
- **Taxas por bandeira** (Cadastros › Pagamentos e taxas) e **Calculadora de taxas** (antecipação composta, repassar taxa ao cliente; conferida só com Mastercard).
- Financeiro: resumo, lançamentos, fluxo a receber, repasses por profissional (percentual ou valor fixo por pacote), relatórios (ainda por sessão atendida).

## 11. Mensagens de WhatsApp (Cadastros › Mensagens)

- Abas: Confirmação do agendamento (padrão + por profissional), Confirmação do dia anterior, Entrar em contato, Documentos (link), Agenda do profissional (dia com atendimento / dia livre).
- Variáveis ({paciente}, {primeiro_nome}, {data}, {hora}, {sala}, {link}, {validade}, {remetente}…), emojis, prévia, Testar (número de testes), seletor "Abrir o WhatsApp" por computador (automático/web/app/copiar). Em `config/msgs` (`def`, `byProf`). Só o admin salva.

## 12. Eventos

- Aba Eventos: cadastro do evento (vagas, valor, local, ministrante, regras, Pix, WhatsApp da clínica, profissional do evento), inscritos (aguardando pagamento, lista de espera, acompanhante incl. **cônjuge**), CSV, caixa de eventos.
- **Link de inscrição** público em `eventos.adintus.com.br` (código aleatório ou **link curto** `/curso-recem-nascido`), prévia no WhatsApp (`_worker.js`, imagem OG). Função `adintus-inscricao` (sem JWT; limites por IP/evento, LGPD, anti-robô).
- Profissional ligado vê o evento (somente leitura) 7 dias antes.

## 13. Integrações e rotinas no Supabase

- `adintus-api` (**API da Lia**, assistente de WhatsApp): leitura e agendamento (agenda, pacientes, profissionais, especialidades, pacotes, eventos/inscrições). Documentos: `adintus-saude-api-para-lia.md`, `adintus-saude-api-relatorio-para-lia.md`, eventos.
- `adintus-agenda-email`: e-mail às 20:00 BRT (pg_cron) com a agenda do dia seguinte, só se houver paciente agendado; botão de teste no cadastro do profissional.
- `adintus-suporte`: pedidos de ajuda, erros de tela agrupados, resumo diário às 8h, conferência a cada 10 min (ver `COMO-ATIVAR-SUPORTE.md`).
- SQL: tabelas, eventos, duplicidade, link, agenda, **trava de registro concluído** (registro com `done:true` não é alterado nem apagado; log de acessos só inclui).
- Segredos (nomes): `RESEND_API_KEY`, `AGENDA_CRON_SECRET`, `AGENDA_ADMIN_EMAILS`, `LINK_BASE`, `LINK_FROM` (ainda não criado), `INSCRICAO_ORIGINS`, `ANTHROPIC_API_KEY` (opcional).

## 14. Ajuda e suporte dentro do app

- Botão **Ajuda**: aba **Perguntar** (manual embutido `HLP_KB`, ~24 assuntos, sem custo/IA), **Pedir ajuda** (tipo, texto e print) e **Meus pedidos**.
- Menu **Suporte** (admin): saúde do sistema, pedidos, erros de tela.
- Botões **Tema** e **Animações** (liga/desliga), guia.

## 15. Dicas técnicas para quem editar o `index.html`

- Funções-chave do link: `lkItems`, `lkDocsFor`, `lkDocNotes`, `lkBuild`, `lkLabel/lkWhat`, `lkOpen`, `lkSend`, `lkGate`, `lkSnapNote`, `lkSnapEvo`, `lkSnapCurva`, `LK_DOCT`, `LK_NDOC`; pacotes: `pkSessions`, `pkState`, `pkPrior`, `pkSave`, `pkMarcar`; caixa: `payParts`, `cxKind`, `pkEntries`; nutrição: `nuEvoRecs`, `nuEvoPrint`, `nuSaveTab`; pediatria: `pedPrint`, `lkCanCurvas`.
- `emitidos` guarda cópias; `data/users/<UID>` guarda notas privadas do prontuário (só o próprio profissional lê).
- Testes: Supabase simulado + Playwright; fechar diálogos abertos nos testes; `APP_VER` e `versao.json` sempre juntos.
