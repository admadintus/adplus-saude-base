# Link de inscrição dos eventos: como ativar (3 passos)

São três partes. Não precisa rodar nenhum SQL.

## Passo 1 · Função no Supabase (uns 3 minutos)
1. Supabase › **Edge Functions** › **Deploy a new function** › **Via Editor**.
2. Nome da função: `adintus-inscricao` (exatamente assim).
3. Apague o texto de exemplo, abra o arquivo `adintus-inscricao.ts`, copie tudo e cole no editor.
4. Clique em **Deploy**.
5. Abra a função criada › **Details** (ou Settings) e **desligue "Verify JWT"** (igual à função `adintus-link`). Sem isso, as pessoas sem login não conseguem se inscrever.

## Passo 2 · Página pública no Cloudflare (uns 5 minutos)
1. Cloudflare › **Workers & Pages** › **Create** › **Pages** › **Upload assets**.
2. Nome do projeto: `adintus-eventos` › envie o arquivo `adintus-eventos-pagina.zip` › **Deploy**.
3. No projeto criado: **Custom domains** › **Set up a custom domain** › digite `eventos.adintus.com.br` › confirme. Se o domínio adintus.com.br já está no Cloudflare, o endereço é criado sozinho (pode levar alguns minutos).

## Passo 3 · Atualizar o Adintus Saúde
Suba o arquivo `adintus-saude-site.zip` (versão 12/11 18:10) no projeto de sempre (prontuario.adintus.com.br).

## Como testar
1. Abra **Eventos**, entre no evento e veja o quadro **Link de inscrição** (os eventos antigos ganham o link sozinhos quando o administrador abre o evento).
2. Clique em **Copiar link** e abra em uma janela anônima ou no celular.
3. Faça uma inscrição de teste. Ela aparece na lista do evento como **Link de inscrição**, aguardando pagamento.
4. Depois do teste, mude a situação dessa inscrição para **Cancelada** (assim libera a vaga).

## Dicas
- Em **Editar evento**, preencha **WhatsApp da clínica para o comprovante**. Com ele, a página mostra o botão "Enviar comprovante pelo WhatsApp".
- O botão **Receber inscrições pelo link** pausa o link sem apagar nada.
- **Gerar um novo link** desativa o link antigo (use se o link foi para o lugar errado).
- O link fecha sozinho depois da data do evento.
- A página só mostra nome, data, local, valor e vagas. A chave Pix só aparece para quem acabou de se inscrever com vaga. A lista de inscritos nunca aparece.
