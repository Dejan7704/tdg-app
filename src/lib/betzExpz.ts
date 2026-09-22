import { players } from "@/lib/data";
import { CATEGORY_LABELS, CATEGORY_ORDER, type BettingCategory } from "@/lib/business";
import {
  type EntryRow,
  type RoundResultRow,
  type SweepstakeBetRow,
} from "@/lib/supabase";

// Delad logik mellan Betz & Expz-sidan (src/app/utlagg/page.tsx, den löpande
// registreringen) och Bokslut-sidans "pågående år"-vy (src/lib/liveBokslut.ts,
// tillagd 2026-09-22) - extraherad hit så båda sidorna räknar exakt likadant
// på samma rådata, istället för att Bokslut skulle behöva återimplementera
// (och riskera att divergera från) registreringssidans beräkningar.

// Standardbelopp för golfbetting, hämtade från samma logik/summor som i 2025
// års utfall (se business-2025.json): insatsen är en fast årlig summa per
// spelare (2 000 kr). Vinstbeloppet (700 kr) är inte längre något man
// registrerar manuellt (se nedan) - det används bara som standardsumman för
// de vinster som räknas fram automatiskt från Resultat-rutan.
export const GOLF_INSATS_DEFAULT = 2000;
export const GOLF_VINST_DEFAULT = 700;

// Vilket år Betz & Expz-sidan börjar på (David bekräftat 2026-09-19) - sidan
// byggdes "från och med 2026". Används bara om databasen mot förmodan saknar
// en öppen säsong helt (t.ex. ett helt tomt projekt) - i normalfallet finns
// alltid en öppen edition-rad (skapad av migrationen eller senaste Bokslut).
export const SEASON_START_YEAR = 2026;

// De fem golfbetting-kategorierna som faktiskt avgörs av ett rondresultat -
// "sweepstake" räknas inte hit, det är ett separat sidospel som i sin tur
// GISSAR på en av de här fem (se Sweepstake-rutan längre ner).
export const RESULT_CATEGORIES = CATEGORY_ORDER.filter((c) => c !== "sweepstake") as Exclude<
  BettingCategory,
  "sweepstake"
>[];

// --- UI-typer (oförändrade sedan innan databaskopplingen) - motsvarande
// databasrader mappas om till dessa vid inläsning, se map*()-funktionerna
// nedan, så att all beräkningslogik (computeAutoEntries m.fl.) kan vara
// exakt oförändrad. ---
export type Entry = {
  id: number;
  timestamp: number;
  playerName: string;
  huvudkategori: "Golfbetting" | "Pokerbetting" | "Utlägg" | "Sweepstake";
  detalj: string;
  kategori?: string;
  belopp: number;
  /** Skiljer poster spelarna faktiskt knappat in från poster appen räknat fram själv (golfbetting-vinster + sweepstake-utbetalningar, se Resultat-rutan). Rent visuellt i tabellen - påverkar inte beloppen. */
  auto?: boolean;
};

export type RoundResult = {
  runda: number;
  netto: Record<string, number | undefined>;
  winners: Partial<Record<Exclude<BettingCategory, "sweepstake">, string>>;
};

export type SweepstakeBet = {
  id: number;
  bettorId: string;
  runda: number;
  kategori: Exclude<BettingCategory, "sweepstake">;
  gissningId: string;
  belopp: number;
};

export function mapEntryRow(row: EntryRow): Entry {
  return {
    id: row.id,
    timestamp: new Date(row.created_at).getTime(),
    playerName: row.player_name,
    huvudkategori: row.huvudkategori,
    detalj: row.detalj,
    kategori: row.kategori ?? undefined,
    belopp: row.belopp,
  };
}

export function mapSweepstakeBetRow(row: SweepstakeBetRow): SweepstakeBet {
  return {
    id: row.id,
    bettorId: row.bettor_id,
    runda: row.runda,
    kategori: row.kategori as Exclude<BettingCategory, "sweepstake">,
    gissningId: row.gissning_id,
    belopp: row.belopp,
  };
}

export function mapRoundResultRows(rows: RoundResultRow[]): Record<number, RoundResult> {
  const out: Record<number, RoundResult> = {};
  for (const row of rows) {
    out[row.runda] = { runda: row.runda, netto: row.netto, winners: row.winners };
  }
  return out;
}

export function formatSek(n: number): string {
  const rounded = Math.round(n);
  return (rounded > 0 ? "+" : "") + rounded.toLocaleString("sv-SE") + " kr";
}

export function playerName(id: string): string {
  return players.find((p) => p.id === id)?.fullName ?? id;
}

// Automatiskt framräknade poster - golfbetting-vinster (en per kategori som
// fått en vinnare i Resultat-rutan) och sweepstake-utbetalningar (löst mot
// samma facit). Ren funktion av roundResults+sweepstakeBets (ingen egen
// state) så den kan användas både för den pågående säsongen och för att
// rendera ett arkiverat års ögonblicksbild oförändrad.
//
// Sweepstaken rullar vidare (David 2026-09-19): gissar ingen rätt på en
// avgjord runda betalas potten inte ut - den läggs istället ovanpå nästa
// rundas pott för SAMMA kategori. Därför måste rundorna gås igenom i
// ordning 1->4 per kategori (inte i den ordning de råkar registrerats) med
// en löpande `carry`-summa. En runda utan registrerat facit än (ingen
// vinnare satt för kategorin) varken betalar ut eller rullar vidare - dess
// insatser väntar orörda tills rundan avgörs.
export function computeAutoEntries(
  roundResults: Record<number, RoundResult>,
  sweepstakeBets: SweepstakeBet[]
): Entry[] {
  const out: Entry[] = [];
  let syntheticId = -1;

  for (const kategori of RESULT_CATEGORIES) {
    let carry = 0;
    for (let runda = 1; runda <= 4; runda++) {
      const result = roundResults[runda];
      const winnerId = result?.winners[kategori];
      if (!winnerId) continue; // inte avgjort än - rör varken utbetalning eller carry

      // Golfbetting-vinst - schablonbeloppet (700 kr), samma som tidigare
      // manuella standardvärde.
      out.push({
        id: syntheticId--,
        timestamp: 0,
        playerName: playerName(winnerId),
        huvudkategori: "Golfbetting",
        detalj: `Vinst – Runda ${runda}, ${CATEGORY_LABELS[kategori]}`,
        kategori: CATEGORY_LABELS[kategori],
        belopp: GOLF_VINST_DEFAULT,
        auto: true,
      });

      const betsR = sweepstakeBets.filter((b) => b.runda === runda && b.kategori === kategori);
      const pot = betsR.reduce((sum, b) => sum + b.belopp, 0) + carry;
      if (pot === 0) continue;

      const winners = betsR.filter((b) => b.gissningId === winnerId);
      if (winners.length === 0) {
        carry = pot;
        continue;
      }

      const rolledIn = carry;
      carry = 0;
      const payoutEach = pot / winners.length;
      for (const w of winners) {
        out.push({
          id: syntheticId--,
          timestamp: 0,
          playerName: playerName(w.bettorId),
          huvudkategori: "Sweepstake",
          detalj: `Vinst – Runda ${runda}, ${CATEGORY_LABELS[kategori]} (gissade ${playerName(
            winnerId
          )}${winners.length > 1 ? `, delad mellan ${winners.length}` : ""}${
            rolledIn > 0 ? `, varav ${formatSek(rolledIn).replace("+", "")} rullat från tidigare runda` : ""
          })`,
          kategori: CATEGORY_LABELS[kategori],
          belopp: payoutEach,
          auto: true,
        });
      }
    }
  }
  return out;
}

// Sweepstake-insatserna visas också i tabellen (manuellt registrerade, till
// skillnad från vinsterna ovan som räknas fram) - egen funktion av samma
// anledning som computeAutoEntries.
export function computeSweepstakeInsatsEntries(sweepstakeBets: SweepstakeBet[]): Entry[] {
  return sweepstakeBets.map((b) => ({
    id: 1_000_000 + b.id, // eget nummerspann så det aldrig krockar med manuella/auto-id:n
    timestamp: 0,
    playerName: playerName(b.bettorId),
    huvudkategori: "Sweepstake" as const,
    detalj: `Insats – Runda ${b.runda}, ${CATEGORY_LABELS[b.kategori]} (gissar ${playerName(
      b.gissningId
    )})`,
    kategori: CATEGORY_LABELS[b.kategori],
    belopp: -b.belopp,
  }));
}

// Slår ihop manuella poster + de två automatiskt framräknade grupperna ovan
// till en enda, sorterad lista - samma logik oavsett om det gäller den
// pågående säsongen eller ett arkiverat års ögonblicksbild.
export function buildAllEntries(
  entries: Entry[],
  sweepstakeBets: SweepstakeBet[],
  roundResults: Record<number, RoundResult>
): Entry[] {
  const autoEntries = computeAutoEntries(roundResults, sweepstakeBets);
  const sweepstakeInsatsEntries = computeSweepstakeInsatsEntries(sweepstakeBets);
  return [...entries, ...sweepstakeInsatsEntries, ...autoEntries].sort((a, b) => {
    // Manuella poster (har ett riktigt timestamp) sorteras nyast-först;
    // automatiska poster (timestamp 0) samlas sist i listan, i den
    // ordning de räknades fram (rond/kategori).
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return 0;
  });
}
