-- Depozitka Core - pgcrypto compatibility wrappers in public schema (v18)
-- Purpose: legacy functions use unqualified crypt/gen_salt/digest with search_path=public.
-- On Supabase, pgcrypto is typically installed in schema `extensions`.
-- These wrappers keep existing SQL compatible without redefining every function body.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.crypt(text, text)
returns text
language sql
immutable
strict
as $$
  select extensions.crypt($1, $2);
$$;

create or replace function public.gen_salt(text)
returns text
language sql
volatile
strict
as $$
  select extensions.gen_salt($1);
$$;

create or replace function public.gen_salt(text, integer)
returns text
language sql
volatile
strict
as $$
  select extensions.gen_salt($1, $2);
$$;

create or replace function public.digest(text, text)
returns bytea
language sql
immutable
strict
as $$
  select extensions.digest($1, $2);
$$;

create or replace function public.digest(bytea, text)
returns bytea
language sql
immutable
strict
as $$
  select extensions.digest($1, $2);
$$;

comment on function public.crypt(text, text)
is 'Compatibility wrapper to extensions.crypt for legacy SQL with search_path=public.';

comment on function public.gen_salt(text)
is 'Compatibility wrapper to extensions.gen_salt for legacy SQL with search_path=public.';

comment on function public.gen_salt(text, integer)
is 'Compatibility wrapper to extensions.gen_salt(rounds) for legacy SQL with search_path=public.';

comment on function public.digest(text, text)
is 'Compatibility wrapper to extensions.digest for legacy SQL with search_path=public.';

comment on function public.digest(bytea, text)
is 'Compatibility wrapper to extensions.digest for legacy SQL with search_path=public.';
