# Prontuários de teste por clínica (sem servidor)

Versões de **demonstração** do Ad+ Saúde para as 13 clínicas-alvo de Planaltina-DF. Só para testes.

- `clinicas.json`: clínicas, especialidades, procedimentos, salas e profissionais **fictícios**.
- `demo-shim.js`: troca a camada do Supabase por um banco no navegador (localStorage). Nenhum dado sai do navegador; nenhum endereço da Adintus é chamado.
- `../scripts/gerar-testes.py`: gera `testes/saida/` (uma pasta por clínica + página de lista).

```
python3 scripts/gerar-testes.py
cd testes/saida && python3 -m http.server 8000   # abrir http://localhost:8000
```

No app, o botão vermelho **TESTE** (canto inferior esquerdo) troca o perfil: Administrador, Recepção ou cada Profissional. O prontuário só aparece para Profissional. "Restaurar dados de exemplo" recria a agenda a partir de hoje (isso também acontece sozinho a cada dia, se nada foi alterado).

Não funciona no teste: e-mail, link do paciente, suporte, API e assinatura digital (dependem do servidor).
Para uma clínica de verdade, siga `docs/CONFIGURAR-NOVA-CLINICA.md` (projeto Supabase próprio).
