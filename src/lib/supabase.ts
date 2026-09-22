import { createClient } from "@supabase/supabase-js";

// Delad Supabase-klient för hela appen. Använder den publika ("anon")
// nyckeln - avsedd att köras i webbläsaren, appen har ingen inloggning
// (delad länk till 9 vänner) så rättigheterna styrs helt av RLS-policyerna
// som sattes upp i supabase/migrations/0001_init.sql.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Saknar NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY - kontrollera .env.local (lokalt) eller Vercels Environment Variables (produktion)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- Databastyper, motsvarar tabellerna i 0001_init.sql ---

export type EditionRow = {
  id: number;
  year: number;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  /** Spelar-id:n som INTE är med den här upplagan (tom lista = alla 9 med). */
  non_participants: string[];
  /** Fritext, t.ex. "Spanien" - samma svenska landsbenämningar som editions.json/countryFlags.ts (tillagd 0003, 2026-09-22). */
  country: string | null;
  /** Antal rundor (1-4) - David bad om detta 2026-09-22 eftersom TDG 2026 bara spelar 3. Styr rondvalen på Betz & Expz och antal kolumner i Historik-sidans live-vy. */
  round_count: number;
  /** Bannamn per runda, index 0 = Runda 1 osv. Längd bör matcha round_count (upprätthålls av UI:t, inte databasen). */
  courses: string[];
};

export type EntryRow = {
  id: number;
  edition_id: number;
  created_at: string;
  player_name: string;
  huvudkategori: "Golfbetting" | "Pokerbetting" | "Utlägg";
  detalj: string;
  kategori: string | null;
  belopp: number;
};

export type SweepstakeBetRow = {
  id: number;
  edition_id: number;
  created_at: string;
  bettor_id: string;
  runda: number;
  kategori: string;
  gissning_id: string;
  belopp: number;
};

export type RoundResultRow = {
  edition_id: number;
  runda: number;
  netto: Record<string, number | undefined>;
  winners: Partial<Record<string, string>>;
  updated_at: string;
};
