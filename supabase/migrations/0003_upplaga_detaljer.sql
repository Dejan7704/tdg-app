-- Tour De Golf (TDG) – land, antal rundor och bannamn per runda (Betz & Expz)
-- Skapad 2026-09-22. Kör detta en gång i Supabase SQL Editor (samma sätt som
-- tidigare migrationer: SQL Editor -> New query -> klistra in -> Run).
--
-- Lägger till tre kolumner på editions, ifyllda via en ny ruta ("Upplaga TDG
-- {år}") på Betz & Expz-sidan. Dessa styr sedan både formulären på samma sida
-- (Sweepstakets och Resultat-rutans rondval begränsas till round_count) och
-- Historik-sidans live-vy för den pågående säsongen (flagga + bannamn per
-- runda). Nytt för TDG 2026: bara 3 rundor spelas i år, därav round_count
-- istället för att anta 4 rundor överallt som tidigare.
--
-- Befintliga rader (inkl. den öppna TDG 2026-raden) får round_count = 4 och
-- tomt land/tomma banor - David fyller i de rätta värdena (3 rundor för i
-- år, Spanien/vad det nu är, samt bannamnen) i den nya rutan efter att
-- migrationen körts.

alter table editions
  add column country text,
  add column round_count smallint not null default 4 check (round_count between 1 and 4),
  add column courses jsonb not null default '[]'::jsonb;
