#!/usr/bin/env bash
# Lista, arquivo por arquivo, tudo que ainda é da clínica de origem (Adintus) e precisa ser trocado.
# Uso: bash scripts/achar-dados-da-clinica.sh
cd "$(dirname "$0")/.." || exit 1
TERMOS='umkrepbjtnjwzgpujgxi|sb_publishable_|adintus\.com\.br|administrativo@|mjuniorgdias|Clínica Adintus|Adintus Saúde|Adintus|Giulia|Pignata|prontuario\.adintus|eventos\.adintus'
grep -rnoE "$TERMOS" --include=*.html --include=*.js --include=*.ts --include=*.sql --include=*.md --include=*.webmanifest --include=_headers site site-eventos supabase 2>/dev/null \
  | awk -F: '{c[$1" -> "$3]++} END{for(k in c) printf "%4d  %s\n", c[k], k}' | sort -k2
echo
echo "Troque tudo acima pelos dados da nova clínica (ver docs/CONFIGURAR-NOVA-CLINICA.md)."
