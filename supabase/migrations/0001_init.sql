-- Tour De Golf (TDG) – initial databasstruktur för Betz & Expz
-- Skapad 2026-09-21. Kör detta en gång i Supabase SQL Editor.
--
-- Speglar exakt det som idag lever i React-state i src/app/utlagg/page.tsx:
--   - editions:        en rad per TDG-år, med status open/closed (säsongsbytet)
--   - entries:         manuellt registrerade poster (Golfbetting-insats,
--                       Pokerbetting, Utlägg) – Sweepstake-insatser och alla
--                       "Auto"-vinster (golfbetting-vinster, sweepstake-
--                       utbetalningar inkl. rullning) sparas MEDVETET INTE
--                       som egna rader, de räknas fram i appen precis som
--                       idag, fast från sweepstake_bets + round_results.
--   - sweepstake_bets: varje sweepstake-satsning
--   - round_results:   facit per golfrunda (nettoscore + kategorivinnare)

-- 1) editions – en rad per TDG-år. "open" = det året man just nu registrerar
--    mot, "closed" = arkiverat (Bokslut-knappen stänger det aktiva året och
--    skapar nästa års rad som "open").
create table if not exists editions (
  id bigint generated always as identity primary key,
  year int not null unique,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

-- 2) entries – manuella poster (Golfbetting-insats, Pokerbetting, Utlägg).
create table if not exists entries (
  id bigint generated always as identity primary key,
  edition_id bigint not null references editions(id) on delete cascade,
  created_at timestamptz not null default now(),
  player_name text not null,
  huvudkategori text not null check (huvudkategori in ('Golfbetting', 'Pokerbetting', 'Utlägg')),
  detalj text not null,
  kategori text,
  belopp numeric not null
);

create index if not exists entries_edition_id_idx on entries(edition_id);

-- 3) sweepstake_bets – varje satsning i sidospelet Sweepstake.
create table if not exists sweepstake_bets (
  id bigint generated always as identity primary key,
  edition_id bigint not null references editions(id) on delete cascade,
  created_at timestamptz not null default now(),
  bettor_id text not null,
  runda int not null check (runda between 1 and 4),
  kategori text not null,
  gissning_id text not null,
  belopp numeric not null
);

create index if not exists sweepstake_bets_edition_id_idx on sweepstake_bets(edition_id);

-- 4) round_results – facit per golfrunda. En rad per (edition, runda).
--    netto: { player_id: nettoscore }, winners: { kategori: winner_player_id }
create table if not exists round_results (
  edition_id bigint not null references editions(id) on delete cascade,
  runda int not null check (runda between 1 and 4),
  netto jsonb not null default '{}'::jsonb,
  winners jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (edition_id, runda)
);

-- Säsongsstart: TDG 2026 är den första säsongen (David bekräftat 2026-09-19).
insert into editions (year, status)
values (2026, 'open')
on conflict (year) do nothing;

-- Row Level Security: appen har ingen inloggning (delad länk till 9 vänner),
-- så vi ger anon-nyckeln (den publika nyckeln appen använder) full läs-/
-- skrivrättighet via en enkel "allow all"-policy per tabell, snarare än att
-- lämna RLS helt avstängd (håller Supabases säkerhetsvarningar rena och gör
-- det tydligt/medvetet att detta är en öppen app utan konton).
alter table editions enable row level security;
alter table entries enable row level security;
alter table sweepstake_bets enable row level security;
alter table round_results enable row level security;

drop policy if exists "Allow all - editions" on editions;
create policy "Allow all - editions" on editions for all using (true) with check (true);

drop policy if exists "Allow all - entries" on entries;
create policy "Allow all - entries" on entries for all using (true) with check (true);

drop policy if exists "Allow all - sweepstake_bets" on sweepstake_bets;
create policy "Allow all - sweepstake_bets" on sweepstake_bets for all using (true) with check (true);

drop policy if exists "Allow all - round_results" on round_results;
create policy "Allow all - round_results" on round_results for all using (true) with check (true);

-- Rättigheter till API-rollerna (motsvarar "Automatically expose new
-- tables" som vi medvetet lät vara avkryssad vid projektskapandet).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on editions, entries, sweepstake_bets, round_results to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
