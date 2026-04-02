# Supabase schema - Depozitka Core

Migrace:
- `001_depozitka_core.sql` — kompletní základní schéma (tabulky, číselníky, RLS, helper funkce)
- `002_depozitka_status_fn.sql` — helper funkce `dpt_change_status(...)`

## Jak spustit

### Varianta A: ručně v Supabase SQL Editoru
1. Otevři SQL Editor ve svém Supabase projektu
2. Spusť obsah `001_depozitka_core.sql`
3. Spusť obsah `002_depozitka_status_fn.sql`

### Varianta B: Supabase CLI (pokud máš projekt linknutý)
```bash
supabase db push
```

## Co schéma obsahuje
- transakce escrow (`dpt_transactions`)
- audit log (`dpt_transaction_events`)
- dispute/hold/refund/payout tabulky
- email/webhook logy
- číselníky stavů + přechodů + email šablon
- nastavení fees/deadlines
- RLS politiky (buyer/seller/admin/service)

## Poznámka
- Přechody stavů jsou validované triggerem proti tabulce `dpt_status_transitions`.
- V test seedu je marketplace `depozitka-test-bazar`.
