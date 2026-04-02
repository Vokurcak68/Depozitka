# Depozitka — Kompletní analytický dokument

> Verze: 1.0 | Autor: Arc ⚡ | Datum: 2026-04-02

---

## 1. Přehled systému

**Depozitka** je samostatná escrow SaaS platforma pro C2C marketplace. Jakýkoli bazar/marketplace se napojí přes REST API a webhooky — Depozitka spravuje celý platební flow nezávisle.

### Architektura

```
┌─────────────────┐         REST API          ┌──────────────────┐
│  Marketplace     │ ◄──────────────────────► │  Depozitka Core  │
│  (Test Bazar,    │    + Webhooky            │  (Next.js)       │
│   Lokopolis...)  │                          │                  │
│                  │                          │  ┌────────────┐  │
│  Vlastní DB      │                          │  │ Admin UI   │  │
│  Vlastní auth    │                          │  │ Dashboard  │  │
│  Vlastní UX      │                          │  └────────────┘  │
└─────────────────┘                           │                  │
                                              │  Supabase DB     │
                                              │  Email service   │
                                              │  Cron jobs       │
                                              └──────────────────┘
```

### Klíčový princip
- Marketplace **vlastní vztah s uživatelem** (registrace, inzeráty, zprávy, recenze)
- Depozitka **vlastní peníze** (escrow účet, platby, výplaty, spory)
- Komunikace výhradně přes API — žádná sdílená databáze

---

## 2. Aktéři

| Aktér | Popis |
|-------|-------|
| **Kupující** | Chce koupit zboží, iniciuje escrow transakci |
| **Prodávající** | Prodává zboží, čeká na výplatu po doručení |
| **Marketplace** | Externí systém (bazar), volá Depozitka API |
| **Depozitka Admin** | Řeší spory, manuální zásahy, výplaty, monitoring |
| **Systém (Cron)** | Automatické akce (expiry, remindery, auto-complete) |
| **Banka (FIO)** | Příjem plateb, párování dle VS, odchozí výplaty |

---

## 3. Kompletní stavový diagram

### 3.1 Hlavní stavy

```
                          ┌──────────────────────────────────────────────┐
                          │              ŽIVOTNÍ CYKLUS TRANSAKCE       │
                          └──────────────────────────────────────────────┘

  Marketplace                              Depozitka
  vytvoří tx                               přijme
      │                                       │
      ▼                                       ▼
  ┌─────────┐   platba nepřišla (24h)   ┌───────────┐
  │ CREATED  │ ─────────────────────────►│ EXPIRED   │ (terminální)
  │          │                           └───────────┘
  │          │   částečná platba
  │          │ ─────────────────┐
  └────┬─────┘                  │
       │ platba 100%            ▼
       │                  ┌──────────────┐  platba nedoplněna (24h od partial)
       │                  │ PARTIAL_PAID │ ─────────────────────────────────────►┌───────────┐
       │                  │              │                                       │ EXPIRED   │
       │                  └──────┬───────┘                                       └───────────┘
       │                         │ doplaceno
       │◄────────────────────────┘
       ▼
  ┌─────────┐   prodejce neodeslal (5 dní)  ┌────────────────┐
  │  PAID   │ ─────────────────────────────►│ SHIP_OVERDUE   │
  │         │                                │ (admin alert)  │
  │         │ ◄──────────────────────────────┘ prodejce odešle│
  └────┬────┘                                                 │
       │ prodejce odeslal + tracking                          │
       │◄─────────────────────────────────────────────────────┘
       ▼
  ┌──────────┐  kupující nepotvrdil (7 dní)  ┌─────────────────┐
  │ SHIPPED  │ ─────────────────────────────►│ DELIVERY_OVERDUE│
  │          │                                │ (admin alert)   │
  └────┬─────┘                                └─────────┬───────┘
       │ doručeno (tracking/manuálně)                   │
       │◄───────────────────────────────────────────────┘
       ▼
  ┌───────────┐  kupující nepotvrdil (14 dní od delivered)
  │ DELIVERED │ ──────────────────────────────────────────────►┌────────────────┐
  │           │                                                │ AUTO_COMPLETED │ (terminální)
  └─────┬─────┘                                                └────────────────┘
        │ kupující potvrdil OK
        ▼
  ┌───────────┐
  │ COMPLETED │ ──► čeká na výplatu
  └─────┬─────┘
        ▼
  ┌──────────────┐   banka potvrdila
  │ PAYOUT_SENT  │ ──────────────────►┌────────────────────┐
  └──────────────┘                     │ PAYOUT_CONFIRMED   │ (terminální)
                                       └────────────────────┘
```

### 3.2 Speciální stavy (z libovolného non-terminálního stavu)

```
  ┌──────────────────────────────────────────────────┐
  │              SPORY A ZÁSAHY                       │
  └──────────────────────────────────────────────────┘

  Z jakéhokoli aktivního stavu (paid, shipped, delivered):

  Kupující/prodejce otevře spor:
      ──────►┌────────────┐
             │ DISPUTED   │ ← admin musí řešit
             └─────┬──────┘
                   │ admin rozhodne:
                   ├──► REFUNDED (peníze zpět kupujícímu)
                   ├──► PAYOUT_SENT (peníze prodávajícímu)
                   └──► CANCELLED (obě strany souhlasí se zrušením)

  Admin pozastaví transakci:
      ──────►┌────────────┐
             │ HOLD       │ ← admin šetří situaci
             └─────┬──────┘
                   │ admin rozhodne:
                   ├──► zpět do předchozího stavu
                   ├──► DISPUTED
                   ├──► REFUNDED
                   └──► CANCELLED

  Marketplace/kupující zruší PŘED platbou:
      ──────►┌────────────┐
             │ CANCELLED  │ (terminální, žádné peníze = jednoduché)
             └────────────┘
```

### 3.3 Kompletní přechodová tabulka

| Z stavu | Na stav | Kdo | Podmínka | Akce |
|---------|---------|-----|----------|------|
| `created` | `partial_paid` | Systém (FIO) | Přijata částečná platba | Email kupujícímu (doplaťte) |
| `created` | `paid` | Systém (FIO) | Platba 100% | Email oběma + marketplace webhook |
| `created` | `expired` | Cron (24h) | Platba nepřišla | Email oběma, webhook, uvolnit inzerát |
| `created` | `cancelled` | Marketplace API / Admin | Kupující zrušil nákup | Email oběma, webhook |
| `partial_paid` | `paid` | Systém (FIO) | Doplaceno | Email oběma + webhook |
| `partial_paid` | `expired` | Cron (24h od partial) | Nedoplaceno | Email + webhook, **pozor: vrátit partial platbu** |
| `paid` | `shipped` | Marketplace API (prodejce) | Odeslal + tracking | Email kupujícímu, webhook |
| `paid` | `ship_overdue` | Cron (5 dní) | Neodeslal | Email prodejci (urgence) + admin alert |
| `paid` | `disputed` | Marketplace API (kupující/prodejce) | Důvod povinný | Email oběma + admin, webhook |
| `paid` | `hold` | Admin | Podezřelá aktivita | Email oběma + důvod |
| `paid` | `refunded` | Admin | Okamžitý refund bez sporu | Vrátit peníze, email oběma |
| `paid` | `cancelled` | Admin | Oboustranná dohoda | Vrátit peníze, email oběma |
| `ship_overdue` | `shipped` | Marketplace API (prodejce) | Nakonec odeslal | Email kupujícímu |
| `ship_overdue` | `cancelled` | Admin / Cron (+ X dní) | Prodejce nereaguje | Refund kupujícímu, penalizace prodejci |
| `ship_overdue` | `refunded` | Admin | Kupující chce zpět peníze | Refund |
| `shipped` | `delivered` | Systém (tracking) / Kupující / Admin | Potvrzeno doručení | Email oběma, webhook |
| `shipped` | `delivery_overdue` | Cron (7 dní) | Kupující nepotvrdil | Email kupujícímu (urgence) + admin alert |
| `shipped` | `disputed` | Marketplace API (kupující) | Problém se zásilkou | Email oběma + admin |
| `shipped` | `hold` | Admin | Podezření | Email oběma |
| `delivery_overdue` | `delivered` | Kupující / Admin / Tracking | Nakonec potvrdil | |
| `delivery_overdue` | `auto_completed` | Cron (14 dní od shipped) | Kupující mlčí | Email oběma, výplata |
| `delivered` | `completed` | Marketplace API (kupující) | Potvrdil spokojenost | Email oběma, spustit výplatu |
| `delivered` | `auto_completed` | Cron (14 dní od delivered) | Kupující mlčí | Email oběma, spustit výplatu |
| `delivered` | `disputed` | Marketplace API (kupující) | Problém se zbožím | Email + admin |
| `delivered` | `hold` | Admin | Podezření | |
| `completed` | `payout_sent` | Admin / Systém | Výplata iniciována | Email prodejci |
| `auto_completed` | `payout_sent` | Admin / Systém | Výplata iniciována | Email prodejci |
| `disputed` | `refunded` | Admin | Rozhodnutí: kupující vyhrál | Refund + email oběma |
| `disputed` | `payout_sent` | Admin | Rozhodnutí: prodejce vyhrál | Výplata + email oběma |
| `disputed` | `hold` | Admin | Potřeba dalšího šetření | |
| `disputed` | `cancelled` | Admin | Oboustranná dohoda | Refund + email |
| `hold` | předchozí stav | Admin | Problém vyřešen | Email oběma |
| `hold` | `disputed` | Admin | Eskalace | |
| `hold` | `refunded` | Admin | Rozhodnutí | |
| `hold` | `cancelled` | Admin | Rozhodnutí | |
| `payout_sent` | `payout_confirmed` | Systém (FIO) | Banka potvrdila | Email prodejci |
| `refunded` | — | — | Terminální | — |
| `cancelled` | — | — | Terminální | — |
| `expired` | — | — | Terminální | — |
| `payout_confirmed` | — | — | Terminální | — |

---

## 4. Edge cases & scénáře z praxe

### 4.1 Marketplace akce během escrow

| Situace | Co se stane | Depozitka akce |
|---------|------------|----------------|
| **Kupující zruší nákup v bazaru** (před platbou) | Marketplace volá API `cancel` | Stav → `cancelled`, email oběma |
| **Kupující zruší nákup** (po platbě) | Marketplace volá API `cancel` | **ZAMÍTNUTO** — po platbě nelze zrušit jednoduše. Kupující musí otevřít spor nebo admin řeší. |
| **Prodejce změní cenu inzerátu** (escrow běží) | Marketplace volá API `update_amount` | **ZAMÍTNUTO** pokud `status >= paid`. Pokud `created` → aktualizovat částku a přepočítat provizi. |
| **Prodejce smaže inzerát** | Marketplace webhook | Depozitka pokračuje — transakce je nezávislá na inzerátu. Admin notifikace. |
| **Prodejce se odregistruje z bazaru** | Marketplace webhook | Depozitka pokračuje. Admin alert: „prodejce odešel z platformy, transakce ID X v stavu Y." |
| **Kupující se odregistruje** | Marketplace webhook | Depozitka pokračuje. Kontaktní email zůstává. Admin alert. |
| **Duplikátní transakce** (stejný inzerát, stejný kupující) | API validace | Odmítnout pokud existuje aktivní (non-terminal) transakce se stejným `external_order_id` |
| **Marketplace je offline** | Webhook delivery selhání | Retry 3x (1min, 5min, 30min), pak `dead`. Admin alert po dead. |

### 4.2 Platební edge cases

| Situace | Akce |
|---------|------|
| **Přeplatek** (kupující poslal víc) | Stav → `paid`, přeplatek zaznamenán v `metadata.overpayment_czk`. Admin alert: „Přeplatek X Kč, řešit manuálně." |
| **Platba od neznámého VS** | FIO sync loguje jako unmatched. Admin alert. |
| **Více plateb na jednu transakci** | Kumulativní součet. Přechod `partial_paid → paid` až dosáhne 100%. |
| **Platba po expiraci** | Transakce je `expired`. Admin alert: „Platba přišla na expirovanou tx X. Vrátit manuálně." |
| **Špatná částka** (méně než min provize) | Provize vždy min 15 Kč. API odmítne `amount_czk < 50`. |
| **Refund partial_paid** | Vrátit přesně přijatou částku (ne celou amount). |

### 4.3 Doručení a tracking

| Situace | Akce |
|---------|------|
| **Prodejce zadá špatný tracking** | Kupující reklamuje → spor |
| **Zásilka ztracena** | Kupující otevře spor. Admin prošetří (tracking status). Refund nebo pojistné plnění. |
| **Zásilka vrácena odesílateli** | Tracking detekce (pokud napojeno). Admin alert. |
| **Prodejce odešle jiné zboží** | Kupující otevře spor + fotodokumentace. Admin řeší. |
| **Kupující tvrdí „nedoručeno" ale tracking říká doručeno** | Spor. Admin vidí tracking + verifikaci. Rozhodnutí na základě důkazů. |

### 4.4 Časové limity (konfigurovatelné)

| Limit | Default | Akce po vypršení |
|-------|---------|-----------------|
| Platba od `created` | 24h | → `expired` |
| Doplacení od `partial_paid` | 24h | → `expired` + refund partial |
| Odeslání od `paid` | 5 dní | → `ship_overdue` + admin alert |
| Ultimátum po `ship_overdue` | +3 dny (8 celkem) | → `cancelled` + refund |
| Potvrzení doručení od `shipped` | 7 dní | → `delivery_overdue` |
| Auto-complete od `delivered` | 14 dní | → `auto_completed` + výplata |
| Auto-complete od `delivery_overdue` | 14 dní od shipped | → `auto_completed` |
| Spor — admin má reagovat | 48h | Eskalace (email admin) |
| Webhook retry | 1min, 5min, 30min | Po 3 failed → `dead` + admin alert |

---

## 5. Email notifikace — kompletní matice

### 5.1 Transakční emaily

| Trigger | Komu | Předmět | Obsah |
|---------|------|---------|-------|
| Tx vytvořena | Kupující | „Vaše objednávka #{code} — platební instrukce" | QR kód, VS, částka, lhůta 24h |
| Tx vytvořena | Prodávající | „Nová objednávka #{code} čeká na platbu" | Info o kupujícím, částce |
| Částečná platba | Kupující | „Objednávka #{code} — zbývá doplatit {X} Kč" | Kolik přišlo, kolik zbývá, lhůta |
| Zaplaceno | Kupující | „Platba přijata — #{code}" | Potvrzení, čekáme na odeslání |
| Zaplaceno | Prodávající | „Objednávka #{code} zaplacena — odešlete zboží" | Adresa kupujícího, lhůta 5 dní |
| Připomenutí odeslání | Prodávající | „Připomínka: odešlete #{code} (zbývají 2 dny)" | Po 3 dnech od paid |
| Ship overdue | Prodávající | „⚠️ URGENCE: #{code} — lhůta pro odeslání uplynula!" | Poslední šance, jinak zrušení |
| Ship overdue | Kupující | „Objednávka #{code} — prodejce zatím neodeslal" | Informace, Depozitka řeší |
| Odesláno | Kupující | „Zboží odesláno — #{code}" | Tracking, přepravce, předpokl. doručení |
| Doručeno | Kupující | „Objednávka #{code} doručena — potvrďte převzetí" | Lhůta 14 dní, odkaz na potvrzení |
| Doručeno | Prodávající | „Objednávka #{code} doručena" | Čeká na potvrzení kupujícího |
| Připomenutí potvrzení | Kupující | „Připomínka: potvrďte #{code} (zbývá 7 dní)" | 7 dní po delivered |
| Finální upozornění | Kupující | „⚠️ Poslední upozornění: #{code} bude auto-dokončena za 3 dny" | |
| Dokončeno | Kupující | „Objednávka #{code} dokončena ✅" | Děkujeme |
| Dokončeno | Prodávající | „Objednávka #{code} dokončena — výplata se zpracovává" | Kdy čekat peníze |
| Auto-dokončeno | Kupující | „Objednávka #{code} automaticky dokončena" | Vysvětlení (14 dní bez reakce) |
| Auto-dokončeno | Prodávající | „Objednávka #{code} auto-dokončena — výplata se zpracovává" | |
| Výplata odeslána | Prodávající | „Výplata {X} Kč odeslána — #{code}" | Částka, číslo účtu, kdy dorazí |
| Výplata potvrzena | Prodávající | „Výplata #{code} připsána na účet ✅" | |
| Spor otevřen | Kupující | „Spor otevřen — #{code}" | Info, co se bude dít |
| Spor otevřen | Prodávající | „Spor otevřen — #{code}" | Info, co se bude dít |
| Spor vyřešen | Oba | „Spor #{code} vyřešen" | Výsledek (refund/výplata/zrušení) |
| Hold nastaven | Oba | „Objednávka #{code} pozastavena" | Důvod, co se děje |
| Hold zrušen | Oba | „Objednávka #{code} obnovena" | |
| Refund | Kupující | „Vrácení platby — #{code}" | Částka, kdy dorazí |
| Refund | Prodávající | „Objednávka #{code} — platba vrácena kupujícímu" | |
| Zrušeno | Oba | „Objednávka #{code} zrušena" | Důvod |
| Expirace | Kupující | „Objednávka #{code} zrušena — platba nepřišla" | |
| Expirace | Prodávající | „Objednávka #{code} zrušena — kupující nezaplatil" | |
| Expirace + partial | Kupující | „Objednávka #{code} zrušena — vracíme {X} Kč" | Partial refund |

### 5.2 Admin notifikace (interní)

| Trigger | Urgence | Předmět |
|---------|---------|---------|
| Nová transakce | Nízká | „Nová tx #{code} ({marketplace})" |
| Platba přijata | Nízká | „Platba OK: #{code}" |
| Spor otevřen | **VYSOKÁ** | „🔴 SPOR: #{code} — vyžaduje akci" |
| Ship overdue | **VYSOKÁ** | „🟠 NEODESLANÉ: #{code} — prodejce nereaguje" |
| Delivery overdue | Střední | „🟡 NEPOTVRZENÉ: #{code} — kupující nereaguje" |
| Platba na expirovanou tx | **VYSOKÁ** | „🔴 Platba na expirovanou #{code} — vrátit manuálně!" |
| Přeplatek | Střední | „🟡 Přeplatek na #{code}: +{X} Kč" |
| Unmatched platba (FIO) | **VYSOKÁ** | „🔴 Nespárovaná platba: {VS}, {částka} Kč" |
| Webhook dead | Střední | „🟡 Webhook mrtvý: {marketplace} — {url}" |
| Marketplace odpojení uživatele | Střední | „🟡 Uživatel odregistrován: {email}, aktivní tx: {count}" |
| Admin spor neřešen 48h | **VYSOKÁ** | „🔴 Spor #{code} neřešen 48h!" |

---

## 6. Admin Dashboard — inteligentní zobrazení

### 6.1 Hlavní dashboard

```
┌─────────────────────────────────────────────────────────┐
│  DEPOZITKA ADMIN                                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  🔴 VYŽADUJE OKAMŽITOU AKCI (3)                         │
│  ┌──────────────────────────────────────────────┐        │
│  │ ⚡ DPT-2026-001234 — SPOR (2h neřešen)      │        │
│  │    Kupující: Jan Novák | Prodejce: Petr Král │        │
│  │    Důvod: "Přišlo poškozené zboží"           │        │
│  │    [Rozhodnout] [Detail]                     │        │
│  ├──────────────────────────────────────────────┤        │
│  │ ⚡ Nespárovaná platba: VS 1234567, 2450 Kč   │        │
│  │    FIO účet, přijato dnes 14:32              │        │
│  │    [Přiřadit k transakci] [Vrátit]           │        │
│  ├──────────────────────────────────────────────┤        │
│  │ ⚡ DPT-2026-001230 — SHIP OVERDUE (6 dní!)   │        │
│  │    Prodejce: ModelKing (seller@test.cz)      │        │
│  │    [Kontaktovat prodejce] [Zrušit + refund]  │        │
│  └──────────────────────────────────────────────┘        │
│                                                          │
│  🟠 SLEDOVAT (5)                                         │
│  ┌──────────────────────────────────────────────┐        │
│  │ DPT-2026-001240 — delivery_overdue (10 dní)  │        │
│  │ DPT-2026-001238 — hold (čeká na podklady)    │        │
│  │ DPT-2026-001235 — partial_paid (zbývá 890 Kč)│        │
│  │ Webhook dead: lokopolis.cz (3 failiedy)       │        │
│  │ Přeplatek DPT-2026-001220: +150 Kč           │        │
│  └──────────────────────────────────────────────┘        │
│                                                          │
│  📊 STATISTIKY (dnes)                                    │
│  ┌────────┬────────┬────────┬────────┬────────┐         │
│  │ Nové   │ Zapl.  │ Odesl. │ Dokonč.│ Obrat  │         │
│  │  12    │   8    │   6    │   4    │ 45.2k  │         │
│  └────────┴────────┴────────┴────────┴────────┘         │
│                                                          │
│  🟢 V PROCESU (23 aktivních transakcí)                   │
│  [created: 5] [paid: 8] [shipped: 6] [delivered: 4]     │
│                                                          │
│  ✅ NEDÁVNO DOKONČENÉ (posledních 24h)                   │
│  DPT-2026-001228 — completed — 1,250 Kč                 │
│  DPT-2026-001225 — payout_confirmed — 3,490 Kč          │
│  ...                                                     │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Priority řazení v adminu

1. **🔴 Okamžitá akce** — spory, nespárované platby, ship_overdue > 5 dní, platba na expirovanou tx
2. **🟠 Sledovat** — delivery_overdue, hold, partial_paid blížící se expiraci, webhook failures
3. **🟢 V procesu** — normální flow (created → paid → shipped → delivered)
4. **✅ Dokončené** — completed, payout_confirmed (posledních 7 dní)
5. **⬜ Archiv** — starší terminální stavy

### 6.3 Detail transakce v adminu

- Timeline (všechny eventy chronologicky s barvami a ikonami)
- Aktuální stav + povolené přechody (tlačítka)
- Info o kupujícím a prodávajícím
- Platební info (VS, přijaté platby, přeplatky)
- Tracking info (přepravce, číslo, odkaz, stav)
- Spor (pokud existuje) — důvod, fotky, admin poznámky
- Email log (co bylo posláno komu)
- Webhook log (co bylo notifikováno marketplace)
- Marketplace metadata (odkud to přišlo)
- Admin akce: změna stavu, poznámka, hold, refund, kontaktovat strany

### 6.4 Filtry a vyhledávání

- Fulltext: kód transakce, email, jméno, external_order_id
- Stav (multi-select)
- Marketplace (dropdown)
- Datum (od-do)
- Urgence (jen urgentní / jen moje / vše)
- Částka (od-do)

---

## 7. API endpointy (Depozitka Core)

### 7.1 Autentizace
Každý marketplace má `api_key`. Posílá se v headeru:
```
Authorization: Bearer dpt_live_xxxxxxxxxxxx
```

### 7.2 Endpointy

#### Transakce

| Method | Endpoint | Popis |
|--------|----------|-------|
| `POST` | `/api/v1/transactions` | Vytvořit escrow transakci |
| `GET` | `/api/v1/transactions/:code` | Detail transakce |
| `GET` | `/api/v1/transactions` | Seznam transakcí (s filtry) |
| `PATCH` | `/api/v1/transactions/:code/cancel` | Zrušit (jen před platbou) |
| `PATCH` | `/api/v1/transactions/:code/ship` | Prodejce odeslal (+ tracking) |
| `PATCH` | `/api/v1/transactions/:code/deliver` | Potvrdit doručení |
| `PATCH` | `/api/v1/transactions/:code/complete` | Kupující potvrdil OK |
| `PATCH` | `/api/v1/transactions/:code/dispute` | Otevřít spor |
| `PATCH` | `/api/v1/transactions/:code/amount` | Změnit částku (jen `created`) |

#### Create transaction — request body
```json
{
  "external_order_id": "ORD-2026-1234",
  "listing_id": "l-1001",
  "listing_title": "Tillig 74806 – nákladní vůz H0",
  "buyer": {
    "name": "Jan Novák",
    "email": "jan@example.cz",
    "phone": "+420777123456"
  },
  "seller": {
    "name": "Kolejmaster",
    "email": "seller@example.cz"
  },
  "amount_czk": 1490,
  "delivery_address": {
    "street": "Dlouhá 12",
    "city": "Praha",
    "postal_code": "11000"
  },
  "metadata": {
    "category": "modelové dráhy",
    "listing_url": "https://bazar.example.cz/inzerat/l-1001"
  }
}
```

#### Create transaction — response
```json
{
  "transaction_code": "DPT-2026-001234",
  "status": "created",
  "amount_czk": 1490,
  "fee_czk": 74.50,
  "payout_czk": 1415.50,
  "payment": {
    "bank_account": "1234567890/2010",
    "variable_symbol": "2026001234",
    "amount_czk": 1490,
    "qr_payload": "SPD*1.0*ACC:CZ1234567890*AM:1490*CC:CZK*X-VS:2026001234*MSG:DPT-2026-001234",
    "due_at": "2026-04-03T22:00:00Z"
  },
  "deadlines": {
    "payment_due_at": "2026-04-03T22:00:00Z",
    "ship_due_at": "2026-04-07T22:00:00Z",
    "delivery_confirm_due_at": "2026-04-09T22:00:00Z",
    "auto_complete_at": "2026-04-16T22:00:00Z"
  },
  "created_at": "2026-04-02T22:00:00Z"
}
```

#### Ship — request body
```json
{
  "carrier": "ceska_posta",
  "tracking_number": "RR123456789CZ",
  "tracking_url": "https://www.postaonline.cz/trackandtrace/-/zasilka/cislo?parcelNumbers=RR123456789CZ",
  "note": "Odesláno Českou poštou, balík do ruky"
}
```

#### Dispute — request body
```json
{
  "opened_by": "buyer",
  "reason": "Zboží přišlo poškozené",
  "details": "Krabice byla rozmáčklá, model je zlomený v půlce",
  "photos": ["https://bazar.example.cz/uploads/dispute/photo1.jpg"]
}
```

### 7.3 Webhooky (Depozitka → Marketplace)

Depozitka posílá webhooky na registrovanou URL marketplace. HMAC-SHA256 podpis v `X-Depozitka-Signature`.

#### Eventy

| Event | Kdy |
|-------|-----|
| `transaction.created` | Tx vytvořena |
| `transaction.paid` | Platba 100% |
| `transaction.partial_paid` | Částečná platba |
| `transaction.shipped` | Odesláno |
| `transaction.delivered` | Doručeno |
| `transaction.completed` | Kupující potvrdil |
| `transaction.auto_completed` | Auto po 14 dnech |
| `transaction.disputed` | Spor otevřen |
| `transaction.dispute_resolved` | Spor vyřešen |
| `transaction.hold` | Pozastaveno |
| `transaction.hold_released` | Hold zrušen |
| `transaction.refunded` | Refundováno |
| `transaction.cancelled` | Zrušeno |
| `transaction.expired` | Expirace |
| `transaction.payout_sent` | Výplata odeslána |
| `transaction.payout_confirmed` | Výplata dokončena |
| `transaction.amount_updated` | Částka změněna |
| `transaction.ship_overdue` | Prodejce neodeslal |
| `transaction.delivery_overdue` | Kupující nepotvrdil |

#### Webhook payload
```json
{
  "event": "transaction.paid",
  "timestamp": "2026-04-02T22:00:00Z",
  "data": {
    "transaction_code": "DPT-2026-001234",
    "external_order_id": "ORD-2026-1234",
    "status": "paid",
    "previous_status": "created",
    "amount_czk": 1490,
    "paid_at": "2026-04-02T22:00:00Z"
  }
}
```

---

## 8. Test Bazar — specifikace

### 8.1 Vlastní databáze (Supabase, JINÝ projekt)

| Tabulka | Popis |
|---------|-------|
| `users` | Registrace, login, profil (jméno, email, telefon, adresa, IBAN) |
| `listings` | Inzeráty (title, popis, cena, fotky, stav, kategorie, měřítko) |
| `orders` | Objednávky (buyer_id, seller_id, listing_id, stav, depozitka_tx_code) |
| `messages` | Interní zprávy buyer ↔ seller |
| `reviews` | Hodnocení prodejce po dokončení |

### 8.2 Stránky

| Stránka | Funkce |
|---------|--------|
| `/` | Homepage s nejnovějšími inzeráty |
| `/login`, `/register` | Auth |
| `/inzeraty` | Seznam inzerátů, filtry, vyhledávání |
| `/inzeraty/[id]` | Detail inzerátu, tlačítko „Koupit s Depozitkou" |
| `/inzeraty/novy` | Vytvoření inzerátu |
| `/moje-inzeraty` | Správa vlastních inzerátů |
| `/objednavky` | Moje objednávky (jako kupující i prodávající) |
| `/objednavky/[id]` | Detail objednávky + stav z Depozitky + akce |
| `/zpravy` | Interní zprávy |
| `/profil` | Úprava profilu, IBAN pro výplaty |

### 8.3 Objednávkový flow v bazaru

1. Kupující klikne „Koupit s Depozitkou" na inzerátu
2. Zadá/potvrdí dodací adresu
3. Bazar volá `POST /api/v1/transactions` na Depozitku
4. Depozitka vrátí platební instrukce (VS, QR, lhůta)
5. Bazar zobrazí kupujícímu platební instrukce
6. Kupující zaplatí → Depozitka webhook → bazar aktualizuje stav
7. Bazar notifikuje prodejce: „Odešlete zboží"
8. Prodejce v bazaru klikne „Odesláno" + zadá tracking
9. Bazar volá `PATCH /api/v1/transactions/:code/ship`
10. Kupující vidí tracking, potvrdí doručení
11. Bazar volá `PATCH /api/v1/transactions/:code/complete`
12. Depozitka zpracuje výplatu
13. Oba dostanou hodnotící formulář

### 8.4 Stavy objednávky v bazaru (mapování na Depozitku)

| Bazar stav | Depozitka stav(y) | UI v bazaru |
|------------|-------------------|-------------|
| Čeká na platbu | `created`, `partial_paid` | Platební instrukce, QR kód |
| Zaplaceno | `paid` | Čeká na odeslání (seller: tlačítko Odesláno) |
| Neodeslané ⚠️ | `ship_overdue` | Urgence pro prodejce |
| Odesláno | `shipped` | Tracking info, tlačítko Potvrzuji doručení |
| Doručeno | `delivered` | Tlačítko Vše OK / Mám problém |
| Čeká na potvrzení ⚠️ | `delivery_overdue` | Urgence pro kupujícího |
| Dokončeno ✅ | `completed`, `auto_completed` | Hodnocení prodejce |
| Výplata | `payout_sent`, `payout_confirmed` | Info pro prodejce |
| Spor ⚠️ | `disputed` | Info + čekáme na rozhodnutí |
| Pozastaveno | `hold` | Info, Depozitka řeší |
| Vráceno | `refunded` | Peníze se vracejí |
| Zrušeno | `cancelled`, `expired` | Objednávka zrušena |

---

## 9. Bezpečnost

- API klíče hashované (bcrypt) v DB, nikdy v plaintextu
- Webhook podpisy HMAC-SHA256
- Rate limiting na API (100 req/min per marketplace)
- RLS na všech tabulkách
- CORS — pouze registrované marketplace origins
- Input validace — email, telefon, částka, délka textu
- SQL injection — parametrizované queries (Supabase client)
- XSS — React default escaping + CSP headers
- Admin auth — Supabase Auth + role check

---

## 10. Nové stavy (vs. aktuální schema)

Přidávám stavy, které v aktuální DB chybí:

| Stav | Popis | Akce |
|------|-------|------|
| `expired` | Platba nepřišla v termínu | Terminální. Cleanup. |
| `ship_overdue` | Prodejce neodeslal ve lhůtě | Admin alert. Pokud +3 dny → cancel + refund. |
| `delivery_overdue` | Kupující nepotvrdil doručení | Reminder + admin alert. Auto-complete po 14d. |

Tyto stavy vyžadují úpravu DB enum `dpt_tx_status` a přechodové tabulky.

---

## 11. Technický stack (finální)

| Komponenta | Technologie |
|------------|-------------|
| Depozitka Core | Next.js 16, TypeScript, Tailwind v4 |
| Depozitka DB | Supabase (vlastní projekt) |
| Depozitka API | Next.js API routes (`/api/v1/*`) |
| Depozitka Admin | Next.js pages (SSR) |
| Depozitka Cron | Vercel Cron (`/api/cron/*`) |
| Depozitka Email | Resend / Supabase Edge Functions |
| Test Bazar | Next.js 16, TypeScript, Tailwind v4 |
| Test Bazar DB | Supabase (JINÝ projekt!) |
| Test Bazar ↔ Depozitka | REST API + Webhooky |

---

## 12. Implementační pořadí

### Fáze 1: Depozitka Core API + Admin (základ)
1. Přepsat na Next.js
2. REST API endpointy (create, get, list, ship, deliver, complete, cancel, dispute)
3. API key autentizace
4. Admin dashboard (urgentní akce, přehled, detail)
5. DB migrace (nové stavy: expired, ship_overdue, delivery_overdue)

### Fáze 2: Test Bazar (plnohodnotný marketplace)
1. Next.js projekt, vlastní Supabase
2. Auth (registrace, login)
3. Inzeráty (CRUD, fotky, filtry)
4. Objednávkový flow → volá Depozitka API
5. Webhook endpoint pro příjem stavových změn

### Fáze 3: Automatizace
1. FIO sync (párování plateb)
2. Cron jobs (expiry, remindery, auto-complete, ship_overdue)
3. Email notifikace (kompletní matice)
4. Webhook delivery + retry

### Fáze 4: Polish
1. Admin: spory, hold, refund workflow
2. Admin: FIO payout
3. Test: end-to-end scénáře
4. Monitoring, error tracking

---

*Tento dokument je živý — aktualizuje se průběžně.*
