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

// Standardbelopp för golfbetting - förifyller bara insats-fältet i Betz &
// Expz (samma årliga summa för alla spelare, men kan ändras år från år, se
// Golfbetting-rutan). GOLF_VINST_DEFAULT används inte längre för att räkna
// fram vinsterna (se computeGolfWinAmount nedan, tillagd 2026-09-23 på Davids
// begäran) - vinstbeloppet är numera hela den insamlade insatspotten delad
// jämnt över samtliga golfbetting-kategorivinster som kan uppstå under
// säsongen, inte en fast klumpsumma. Konstanten finns kvar bara som
// fallback-default för computeAutoEntries/computeSweepstakeRoundInfo ifall de
// anropas utan en uträknad pott (t.ex. innan någon insats alls registrerats).
export const GOLF_INSATS_DEFAULT = 2000;
export const GOLF_VINST_DEFAULT = 700;

// Summan av samtliga registrerade golfbetting-insatser (de manuella, ej
// auto-framräknade, "Insats"-posterna) - detta ÄR potten som golfbetting-
// vinsterna delas ut ifrån, se computeGolfWinAmount. Läggs i sin helhet i
// egen ruta ("Golfbetting Insats"-kolumnen på Bokslut-sidan har blivit
// rent informativ - se computeAutoEntries) snarare än att varje spelares
// egen insats dras av individuellt, se "Snitt gemensamma kostnader" i
// liveBokslut.ts.
export function computeGolfInsatsPool(entries: Entry[]): number {
  return entries
    .filter((e) => e.huvudkategori === "Golfbetting" && !e.auto)
    .reduce((sum, e) => sum + Math.abs(e.belopp), 0);
}

// Golfbetting-vinstbeloppet PER kategorivinst, framräknat som hela
// insatspotten delad jämnt över samtliga kategorivinster som kan uppstå
// under säsongen (5 kategorier × antal rundor) - David bad om detta
// 2026-09-23 istället för en fast klumpsumma (GOLF_VINST_DEFAULT), så att
// potten alltid går jämnt ut oavsett insatsbelopp eller antal rundor. Vid
// t.ex. 3 rundor och en pott på 12 000 kr (6 spelare á 2 000 kr) blir det
// 12 000 / (5*3) = 800 kr per vinst.
export function computeGolfWinAmount(golfInsatsPool: number, roundCount = 4): number {
  const slots = RESULT_CATEGORIES.length * roundCount;
  return slots > 0 ? golfInsatsPool / slots : 0;
}

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

// [1, 2, ..., roundCount] - liten hjälpfunktion så "vilka rundor finns" inte
// behöver hårdkodas som [1,2,3,4] på flera ställen (Betz & Expz rondval,
// Bokslut/Historik-sidornas tabellkolumner).
export function roundNumbers(roundCount: number): number[] {
  return Array.from({ length: roundCount }, (_, i) => i + 1);
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
  sweepstakeBets: SweepstakeBet[],
  // Antal rundor den här upplagan spelar (1-4, default 4 för bakåtkompatibilitet
  // med arkiverade år som saknar ett eget round_count-värde). David bad om
  // detta 2026-09-22 eftersom TDG 2026 bara spelar 3 rundor, inte 4 som
  // tidigare alltid antogs.
  roundCount = 4,
  // Golfbetting-vinst PER kategorivinst - hela insatspotten delad jämnt över
  // säsongens kategorivinster, se computeGolfWinAmount. Default
  // GOLF_VINST_DEFAULT bara som absolut sista utväg om anroparen inte räknat
  // fram potten (t.ex. innan någon insats alls registrerats).
  golfWinAmount = GOLF_VINST_DEFAULT
): Entry[] {
  const out: Entry[] = [];
  let syntheticId = -1;

  for (const kategori of RESULT_CATEGORIES) {
    let carry = 0;
    for (let runda = 1; runda <= roundCount; runda++) {
      const result = roundResults[runda];
      const winnerId = result?.winners[kategori];
      if (!winnerId) continue; // inte avgjort än - rör varken utbetalning eller carry

      // Golfbetting-vinst - andel av insatspotten (se computeGolfWinAmount),
      // inte längre en fast klumpsumma.
      out.push({
        id: syntheticId--,
        timestamp: 0,
        playerName: playerName(winnerId),
        huvudkategori: "Golfbetting",
        detalj: `Vinst – Runda ${runda}, ${CATEGORY_LABELS[kategori]}`,
        kategori: CATEGORY_LABELS[kategori],
        belopp: golfWinAmount,
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

export type CategoryWin = { playerId: string; category: BettingCategory };

// Samma "vem vann vilken kategori vilken runda"-logik som computeAutoEntries
// ovan, men returnerar en enkel lista vinsthändelser (spelare + kategori)
// istället för färdigformaterade Entry-texter/belopp - tillagd 2026-09-23 för
// att kunna bygga "Antal golfbetting-vinster per år"-stapeldiagrammet på
// spelarsidan även för en pågående/avslutad säsong i Supabase (se
// getSupabaseSeasonStats i liveBokslut.ts), på samma sätt som diagrammet
// redan räknar kategorivinster ur de statiska business-*.json-filerna.
// Sweepstake-utbetalningar räknas här som en vinst i kategorin "sweepstake"
// (oavsett vilken av de fem golfkategorierna gissningen gällde) - samma
// modell som de historiska 2016-2018-filerna använder (ett netto per runda,
// inte per gissad kategori).
export function computeCategoryWins(
  roundResults: Record<number, RoundResult>,
  sweepstakeBets: SweepstakeBet[],
  roundCount = 4
): CategoryWin[] {
  const out: CategoryWin[] = [];

  for (const kategori of RESULT_CATEGORIES) {
    let carry = 0;
    for (let runda = 1; runda <= roundCount; runda++) {
      const result = roundResults[runda];
      const winnerId = result?.winners[kategori];
      if (!winnerId) continue;

      out.push({ playerId: winnerId, category: kategori });

      const betsR = sweepstakeBets.filter((b) => b.runda === runda && b.kategori === kategori);
      const pot = betsR.reduce((sum, b) => sum + b.belopp, 0) + carry;
      if (pot === 0) continue;

      const winners = betsR.filter((b) => b.gissningId === winnerId);
      if (winners.length === 0) {
        carry = pot;
        continue;
      }

      carry = 0;
      for (const w of winners) out.push({ playerId: w.bettorId, category: "sweepstake" });
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
  roundResults: Record<number, RoundResult>,
  roundCount = 4
): Entry[] {
  // Golfbetting-vinsten räknas ut från den faktiska insatspotten (summan av
  // de registrerade insatserna i `entries`), inte en fast klumpsumma - se
  // computeGolfWinAmount. Det gör att buildAllEntries kan behålla sin
  // befintliga signatur (anroparna skickar redan in `entries`) samtidigt som
  // både computeAutoEntries och den fristående getLiveBokslut-uträkningen i
  // liveBokslut.ts alltid använder exakt samma pott/vinstbelopp.
  const golfInsatsPool = computeGolfInsatsPool(entries);
  const golfWinAmount = computeGolfWinAmount(golfInsatsPool, roundCount);
  const autoEntries = computeAutoEntries(roundResults, sweepstakeBets, roundCount, golfWinAmount);
  const sweepstakeInsatsEntries = computeSweepstakeInsatsEntries(sweepstakeBets);
  return [...entries, ...sweepstakeInsatsEntries, ...autoEntries].sort((a, b) => {
    // Manuella poster (har ett riktigt timestamp) sorteras nyast-först;
    // automatiska poster (timestamp 0) samlas sist i listan, i den
    // ordning de räknades fram (rond/kategori).
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return 0;
  });
}

export type SweepstakeRoundEvent = {
  runda: number;
  category: Exclude<BettingCategory, "sweepstake">;
  /** Potten som avgjordes/rullade denna runda (insatser lagda denna runda + ev. inrullad pott). */
  potAmount: number;
  /** Den del av potten som rullade in från en tidigare runda (0 om ingen rullning skett). */
  carriedIn: number;
  /** "paid" = potten betalades ut till en eller flera vinnare denna runda. "rolled" = kategorin avgjord men ingen gissade rätt, potten rullar vidare till nästa runda. */
  outcome: "paid" | "rolled";
  /** Bara satt för outcome "paid". */
  winners: { playerName: string; amount: number }[];
};

// Samma bas-loop som computeAutoEntries/computeCategoryWins (se resonemang
// där), men med rikare utdata - tillagd 2026-09-23 på Davids begäran om en
// synlig indikator på Bokslut-sidans "Betting rond för rond"-kort när en
// sweepstake-pott INTE delas ut (ingen gissade rätt) och istället rullar
// vidare till nästa runda för samma kategori, så det syns varför en senare
// rundas utbetalning är större än insatsen just den rundan.
export function computeSweepstakeRoundInfo(
  roundResults: Record<number, RoundResult>,
  sweepstakeBets: SweepstakeBet[],
  roundCount = 4
): SweepstakeRoundEvent[] {
  const out: SweepstakeRoundEvent[] = [];

  for (const kategori of RESULT_CATEGORIES) {
    let carry = 0;
    for (let runda = 1; runda <= roundCount; runda++) {
      const result = roundResults[runda];
      const winnerId = result?.winners[kategori];
      if (!winnerId) continue; // inte avgjort än

      const betsR = sweepstakeBets.filter((b) => b.runda === runda && b.kategori === kategori);
      const pot = betsR.reduce((sum, b) => sum + b.belopp, 0) + carry;
      if (pot === 0) continue; // inga insatser alls i den här kategorin/rundan

      const winners = betsR.filter((b) => b.gissningId === winnerId);
      if (winners.length === 0) {
        out.push({ runda, category: kategori, potAmount: pot, carriedIn: carry, outcome: "rolled", winners: [] });
        carry = pot;
        continue;
      }

      const carriedIn = carry;
      carry = 0;
      const payoutEach = pot / winners.length;
      out.push({
        runda,
        category: kategori,
        potAmount: pot,
        carriedIn,
        outcome: "paid",
        winners: winners.map((w) => ({ playerName: playerName(w.bettorId), amount: payoutEach })),
      });
    }
  }
  return out;
}
