-- =============================================================
-- Depozitka test scénář — 10 transakcí v různých stavech
-- Spusť v Supabase SQL Editoru (jako service_role)
-- =============================================================

-- 1) Marketplace musí existovat
insert into public.dpt_marketplaces (code, name, active)
values ('depozitka-test-bazar', 'Depozitka Test Bazar', true)
on conflict (code) do nothing;

-- 2) Vytvoříme 10 transakcí přes RPC
-- TX-1: zůstane ve stavu CREATED (čeká na platbu)
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1001', 'L-101', 'Tillig 74806 – nákladní vůz H0',
  'Karel Novák', 'karel@test.cz', 'Petr Železný', 'petr@test.cz', 890
);

-- TX-2: CREATED → PAID (kupující zaplatil)
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1002', 'L-102', 'Piko SmartControl set',
  'Jana Malá', 'jana@test.cz', 'Tomáš Kolej', 'tomas.kolej@test.cz', 3490
);
do $$
declare v_code text;
begin
  select transaction_code into v_code from public.dpt_transactions where external_order_id = 'ORD-2026-1002';
  perform public.dpt_change_status(v_code, 'paid', 'service', null, null);
end $$;

-- TX-3: CREATED → PAID → SHIPPED (prodejce odeslal)
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1003', 'L-103', 'Modelová budova nádraží',
  'Martin Rychlý', 'martin@test.cz', 'Lukáš Výhybka', 'lukas@test.cz', 1250
);
do $$
declare v_code text;
begin
  select transaction_code into v_code from public.dpt_transactions where external_order_id = 'ORD-2026-1003';
  perform public.dpt_change_status(v_code, 'paid', 'service', null, null);
  perform public.dpt_change_status(v_code, 'shipped', 'seller', 'lukas@test.cz', null);
  update public.dpt_transactions
  set shipping_carrier = 'Česká pošta', shipping_tracking_number = 'DR1234567CZ'
  where transaction_code = v_code;
end $$;

-- TX-4: celý happy path → COMPLETED
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1004', 'L-104', 'Roco 7310002 – parní lokomotiva',
  'Eva Staničná', 'eva@test.cz', 'Ondřej Depo', 'ondrej@test.cz', 5990
);
do $$
declare v_code text;
begin
  select transaction_code into v_code from public.dpt_transactions where external_order_id = 'ORD-2026-1004';
  perform public.dpt_change_status(v_code, 'paid', 'service', null, null);
  perform public.dpt_change_status(v_code, 'shipped', 'seller', 'ondrej@test.cz', null);
  perform public.dpt_change_status(v_code, 'delivered', 'service', null, null);
  perform public.dpt_change_status(v_code, 'completed', 'buyer', 'eva@test.cz', null);
end $$;

-- TX-5: DISPUTED (kupující otevřel spor po doručení)
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1005', 'L-105', 'Fleischmann kolejový set N',
  'David Sporný', 'david@test.cz', 'Radek Vlak', 'radek@test.cz', 2100
);
do $$
declare v_code text;
begin
  select transaction_code into v_code from public.dpt_transactions where external_order_id = 'ORD-2026-1005';
  perform public.dpt_change_status(v_code, 'paid', 'service', null, null);
  perform public.dpt_change_status(v_code, 'shipped', 'seller', 'radek@test.cz', null);
  perform public.dpt_change_status(v_code, 'delivered', 'service', null, null);
  perform public.dpt_change_status(v_code, 'disputed', 'buyer', 'david@test.cz', 'Zboží neodpovídá popisu – chybí příslušenství');
  insert into public.dpt_disputes (transaction_id, opened_by_role, reason, details)
  select id, 'buyer', 'Neodpovídá popisu', 'Chybí příslušenství uvedené v inzerátu'
  from public.dpt_transactions where transaction_code = v_code;
end $$;

-- TX-6: HOLD (admin pozastavil podezřelou transakci)
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1006', 'L-106', 'Märklin CS3 centrála',
  'Alena Tichá', 'alena@test.cz', 'Igor Podezřelý', 'igor@test.cz', 12500
);
do $$
declare v_code text;
begin
  select transaction_code into v_code from public.dpt_transactions where external_order_id = 'ORD-2026-1006';
  perform public.dpt_change_status(v_code, 'paid', 'service', null, null);
  perform public.dpt_change_status(v_code, 'hold', 'admin', 'admin@depozitka.cz', 'Podezření na podvodný účet prodejce');
  insert into public.dpt_holds (transaction_id, reason, active)
  select id, 'Podezření na podvodný účet prodejce', true
  from public.dpt_transactions where transaction_code = v_code;
end $$;

-- TX-7: REFUNDED (admin vrátil peníze po sporu)
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1007', 'L-107', 'Arnold Souprava RegioJet TT',
  'Zdeněk Vrácený', 'zdenek@test.cz', 'Marek Odesílatel', 'marek@test.cz', 1890
);
do $$
declare v_code text;
begin
  select transaction_code into v_code from public.dpt_transactions where external_order_id = 'ORD-2026-1007';
  perform public.dpt_change_status(v_code, 'paid', 'service', null, null);
  perform public.dpt_change_status(v_code, 'disputed', 'buyer', 'zdenek@test.cz', 'Zásilka vůbec nedorazila');
  perform public.dpt_change_status(v_code, 'refunded', 'admin', 'admin@depozitka.cz', 'Prodejce neprokázal odeslání');
  insert into public.dpt_refunds (transaction_id, amount_czk, status, reason)
  select id, 1890, 'confirmed', 'Prodejce neprokázal odeslání'
  from public.dpt_transactions where transaction_code = v_code;
end $$;

-- TX-8: CANCELLED (zrušeno před zaplacením)
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1008', 'L-108', 'Viessmann návěstidlo H0',
  'Lenka Změnila', 'lenka@test.cz', 'Filip Prodavač', 'filip@test.cz', 450
);
do $$
declare v_code text;
begin
  select transaction_code into v_code from public.dpt_transactions where external_order_id = 'ORD-2026-1008';
  perform public.dpt_change_status(v_code, 'cancelled', 'admin', 'admin@depozitka.cz', 'Kupující požádal o zrušení');
end $$;

-- TX-9: PAYOUT_SENT (výplata odeslaná prodejci)
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1009', 'L-109', 'Auhagen výpravní budova TT',
  'Monika Spokojená', 'monika@test.cz', 'Jiří Stavitel', 'jiri@test.cz', 780
);
do $$
declare v_code text;
begin
  select transaction_code into v_code from public.dpt_transactions where external_order_id = 'ORD-2026-1009';
  perform public.dpt_change_status(v_code, 'paid', 'service', null, null);
  perform public.dpt_change_status(v_code, 'shipped', 'seller', 'jiri@test.cz', null);
  perform public.dpt_change_status(v_code, 'delivered', 'service', null, null);
  perform public.dpt_change_status(v_code, 'completed', 'buyer', 'monika@test.cz', null);
  -- admin ručně přepne na payout (po completed musíme obejít trigger)
  -- Proto vložíme payout záznam přímo:
  insert into public.dpt_payouts (transaction_id, amount_czk, status, sent_at)
  select id, payout_amount_czk, 'sent', now()
  from public.dpt_transactions where transaction_code = v_code;
end $$;

-- TX-10: PARTIAL_PAID (přišla jen část platby)
select public.dpt_create_transaction(
  'depozitka-test-bazar', 'ORD-2026-1010', 'L-110', 'Brawa osobní vůz ČD H0',
  'Tomáš Poloviční', 'tomas.pol@test.cz', 'Anna Čekající', 'anna@test.cz', 2200
);
do $$
declare v_code text;
begin
  select transaction_code into v_code from public.dpt_transactions where external_order_id = 'ORD-2026-1010';
  perform public.dpt_change_status(v_code, 'partial_paid', 'service', null, null);
end $$;

-- =============================================================
-- Hotovo! Teď máš 10 transakcí:
-- 1. CREATED (čeká platbu)
-- 2. PAID (zaplaceno)
-- 3. SHIPPED (odesláno, s tracking)
-- 4. COMPLETED (celý happy path)
-- 5. DISPUTED (spor po doručení)
-- 6. HOLD (pozastaveno adminem)
-- 7. REFUNDED (vráceno po sporu)
-- 8. CANCELLED (zrušeno)
-- 9. COMPLETED + payout záznam
-- 10. PARTIAL_PAID (částečná platba)
-- =============================================================
