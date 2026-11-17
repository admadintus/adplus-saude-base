# Suporte e vigilância do Adintus Saúde: como ativar (versão 13/11 16:00)

O que vai funcionar depois de ativar:
- Botão **Ajuda** no topo, para todos os usuários: pedido com texto e print, aba "Meus pedidos" com a resposta.
- Menu **Suporte** (só administrador): pedidos, erros de tela, saúde do sistema, resposta ao usuário.
- Aviso por e-mail ao administrador a cada pedido e a cada erro novo de tela.
- Resumo por e-mail todo dia às 8h e alerta se o site ou o banco caírem (conferência a cada 10 minutos).

STATUS (13/11 16:10): os passos 1 e 2 já foram feitos no Supabase. Falta só o passo 3 (subir o zip).

Ordem certa (3 passos, uns 10 minutos):

## 1. Banco de dados (SQL)
1. Supabase > SQL Editor > New query.
2. Abra o arquivo `adintus-suporte-supabase.sql`, copie tudo e cole.
3. Clique em Run. O SQL copia sozinho o segredo do agendamento da agenda por e-mail, então não precisa colar nada. O aviso "Potential issue detected" é normal.

## 2. Função do servidor
1. Supabase > Edge Functions > Deploy a new function > Via Editor.
2. Nome exato: `adintus-suporte`.
3. Apague o exemplo, cole o conteúdo de `adintus-suporte.ts` e clique em Deploy.
4. Em Settings da função, deixe **Verify JWT desligado** (a função confere o login sozinha), como na função da agenda.
Os segredos `RESEND_API_KEY` e `AGENDA_CRON_SECRET` já existem. Nada novo a criar.

## 3. Aplicativo
Suba o `adintus-saude-site.zip` no Cloudflare Pages (projeto `prontuario-adintus`), como de costume.

## Teste (2 minutos)
1. Entre no sistema, clique em **Ajuda**, escolha "Dúvida de uso", escreva uma frase e anexe um print. Enviar.
2. Confira o e-mail em administrativo@adintus.com.br (vem com o print em anexo). Se não chegar, veja o spam.
3. Menu **Suporte**: o pedido aparece. Escreva uma resposta e envie. Em Ajuda > Meus pedidos a resposta aparece.

## Opcionais
- **Triagem por IA** (resume e sugere resposta): crie o segredo `ANTHROPIC_API_KEY` no Supabase. Só o texto do pedido vai para a IA, nunca o print. Sem a chave, tudo funciona do mesmo jeito.
- **Vigia externo gratuito** (UptimeRobot): cria um monitor para `https://prontuario.adintus.com.br/versao.json` a cada 5 minutos. Ele avisa mesmo se o Supabase inteiro cair.
- Mudar o e-mail que recebe os avisos: segredo `SUPORTE_TO`.

## Cuidados
- O print pode mostrar nome de paciente. O aviso na tela já pede para cobrir. Só o administrador vê os pedidos.
- Erros de tela guardam só a mensagem técnica e a tela, nunca conteúdo de prontuário.
