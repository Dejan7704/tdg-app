-- Tour De Golf (TDG) – deltagarval per upplaga (Betz & Expz)
-- Skapad 2026-09-21. Kör detta en gång i Supabase SQL Editor (samma sätt som
-- förra migrationen: SQL Editor -> New query -> klistra in -> Run).
--
-- Lägger till en kolumn på editions som listar vilka av de 9 spelarna som
-- INTE är med en given upplaga (David bad om "vem som ev inte är med" som
-- det enklare alternativet). Tom lista = alla 9 med, vilket är läget för
-- samtliga befintliga rader (inkl. TDG 2026) efter den här migrationen.

alter table editions
  add column if not exists non_participants jsonb not null default '[]'::jsonb;
