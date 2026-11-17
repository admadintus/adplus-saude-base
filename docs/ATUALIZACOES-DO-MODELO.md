# Atualizações do modelo base

## 17/11/2026 (versão do app 16/11 16:00)
Em relação ao modelo de 15/11 (app 14/11 19:30), o `site/index.html` agora traz tudo do Adintus Saúde até 16/11, SEM o Workspace (aba interna de administração e recepção, que é específica da Adintus):
- Redução de tráfego do Supabase (menos consultas quando a aba está escondida; atualização a cada 120 s).
- Correção do erro "pv is not a function" ao escolher procedimento no novo agendamento.
- Pacotes em vigor, editar pacote, histórico do pacote e proteção contra pacote duplicado.
- Suporte e vigilância (botão Ajuda, menu Suporte, erros de tela, resumo diário e conferência a cada 10 min).
- Transcrição com diagnóstico, Abrir agenda com sala e motivo, e demais ajustes de 11 a 15/11.
Itens opcionais que a clínica nova pode desligar ou não ativar: Eventos (`site-eventos/` e funções de inscrição), API para assistente de WhatsApp (`adintus-api`), Suporte (`adintus-suporte`).
Continua pendente: SQL das tabelas e regras base (ver CONFIGURAR-NOVA-CLINICA.md, seção 3, passo 1).
