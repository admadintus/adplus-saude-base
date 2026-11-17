# Texto para colar no chat que vai montar o prontuário da nova clínica

Quero montar o prontuário e a agenda da clínica **[NOME DA CLÍNICA]** a partir do modelo base Ad+ Saúde (esta pasta/zip). Funções padrões apenas.

Regras:
- Um projeto Supabase e um projeto Cloudflare Pages NOVOS para esta clínica. Nunca reutilizar dados, chaves ou projeto de outra clínica.
- Siga `docs/CONFIGURAR-NOVA-CLINICA.md`. Rode `scripts/achar-dados-da-clinica.sh` para achar tudo que ainda é da Adintus e troque pelos dados da nova clínica (nome, logo, cores, domínio, e-mails, ícones, papel timbrado).
- Não ativar Eventos, API de assistente nem Suporte agora (opcionais).
- Eu (administrador, não programador) executo SQL, crio segredos e subo o zip; você me guia passo a passo e prepara tudo pronto para colar.
- Não coloque senhas, chaves ou dados de pacientes em chat nem no código.
- Antes de aplicar qualquer função nova, mostre uma demonstração.
- Falta no modelo: o SQL das tabelas e regras base (`docs`, `profiles`, `doc_merge`, regras de acesso). Peça o arquivo `adintus-base-supabase.sql` que acompanha este pacote, se existir; senão, avise e pare antes do passo 3.

Funções padrões incluídas: agenda por profissional e sala, pacientes, check-in, prontuário e evolução, receitas/atestados/exames com papel timbrado, pacotes de sessões, caixa e financeiro, link do paciente, e-mail da agenda (opcional), perfis administrador, recepção e profissional.

Dados que vou fornecer: nome e logo da clínica, cores, domínio, e-mail do administrador, profissionais (nome, especialidade, registro, e-mail), salas, horários, procedimentos e valores.
