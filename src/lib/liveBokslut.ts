import { supabase, type EditionRow, type EntryRow, type RoundResultRow, type SweepstakeBetRow } from "@/lib/supabase";
import { players } from "@/lib/data";
import { type BettingCategory, CATEGORY_ORDER } from "@/lib/business";
import {
  RESULT_CATEGORIES,
  SEASON_START_YEAR,
  GOLF_VINST_DEFAULT,
  mapEntryRow,
  mapSweepstakeBetRow,
  mapRoundResultRows,
  buildAllEntries,
  computeAutoEntries,
  computeCategoryWins,
  playerName,
  roundNumbers,
} from "@/lib/betzExpz";

// Läser in en "live"-sammanställning av den pågående säsongen (den öppna
// edition-raden i Supabase) - motsvarande de info-rutor Bokslut-sidan visar
// för avslutade år (rond för rond, totalt per kategori, avräkning), men
// framräknat direkt från Betz & Expz-sidans löpande registrerade data
// istället för en statisk business-*.json-fil. David bad om detta
// 2026-09-22 ("man gärna vill se samtliga inforutor för pågående år 2026").
//
// Körs bara server-side (importeras bara från betting-business/page.tsx, en
// async Server Component) - `supabase`-klienten är dock samma publika
// anon-klient som används client-side på Betz & Expz-sidan (RLS tillåter
// redan öppen läsning/skrivning, se supabase.ts).

export type LiveBettingWin = {
  category: Exclude<BettingCategory, "sweepstake">;
  playerId: string;
  playerName: string;
  amount: number;
};

export type LiveRound = { round: number; wins: LiveBettingWin[] };

export type LiveSettlementRow = {
  playerId: string;
  playerName: string;
  utlagg: number;
  poker: number;
  golfbetting: number;
  sweepstake: number;
  justering: number;
};

export type LiveBokslut = {
  year: number;
  editionId: number;
  /** Antal rundor upplagan spelar (1-4) - tillagt 2026-09-22, se `courses` nedan. */
  roundCount: number;
  /** Fritext, t.ex. "Spanien" - null om inte ifyllt än. Tillagt 2026-09-22. */
  country: string | null;
  /** Bannamn per runda, index 0 = Runda 1 osv (längd roundCount). Tillagt 2026-09-22 - används av LiveRoundCard istället för den tidigare (trasiga) getEdition()-uppslagningen, som aldrig kan hitta den pågående säsongen i den statiska editions.json. */
  courses: string[];
  rounds: LiveRound[];
  totals: Record<string, Partial<Record<Exclude<BettingCategory, "sweepstake">, number>>>;
  settlement: LiveSettlementRow[];
  entryCount: number;
};

export async function getLiveBokslut(): Promise<LiveBokslut | null> {
  const { data: editionRows, error } = await supabase
    .from("editions")
    .select("*")
    .eq("status", "open")
    .limit(1);
  if (error || !editionRows || editionRows.length === 0) return null;
  const edition = editionRows[0] as EditionRow;

  const [entriesRes, betsRes, resultsRes] = await Promise.all([
    supabase.from("entries").select("*").eq("edition_id", edition.id),
    supabase.from("sweepstake_bets").select("*").eq("edition_id", edition.id),
    supabase.from("round_results").select("*").eq("edition_id", edition.id),
  ]);
  if (entriesRes.error || betsRes.error || resultsRes.error) return null;

  const entries = (entriesRes.data as EntryRow[]).map(mapEntryRow);
  const sweepstakeBets = (betsRes.data as SweepstakeBetRow[]).map(mapSweepstakeBetRow);
  const roundResults = mapRoundResultRows(resultsRes.data as RoundResultRow[]);

  // Rond-för-rond golfbetting-segrare, samma form som den historiska
  // BusinessYear.rounds (se business.ts) men nyckelt på playerId istället
  // för smeknamn - getPlayerByNickname() i data.ts kan inte slå upp de
  // player-id:n som lagras i round_results/entries-tabellerna (bara
  // smeknamn), se arkitektur-dokumentet.
  const rounds: LiveRound[] = [];
  for (const runda of roundNumbers(edition.round_count)) {
    const result = roundResults[runda];
    if (!result) continue;
    const wins: LiveBettingWin[] = [];
    for (const kategori of RESULT_CATEGORIES) {
      const winnerId = result.winners[kategori];
      if (!winnerId) continue;
      wins.push({
        category: kategori,
        playerId: winnerId,
        playerName: playerName(winnerId),
        amount: GOLF_VINST_DEFAULT,
      });
    }
    if (wins.length > 0) rounds.push({ round: runda, wins });
  }

  const totals: LiveBokslut["totals"] = {};
  for (const r of rounds) {
    for (const w of r.wins) {
      totals[w.playerId] = totals[w.playerId] ?? {};
      totals[w.playerId]![w.category] = (totals[w.playerId]![w.category] ?? 0) + w.amount;
    }
  }

  const allEntries = buildAllEntries(entries, sweepstakeBets, roundResults, edition.round_count);

  // Avräkning - en rad per deltagande spelare (även den som ännu inte
  // registrerat något får en nollrad, så rutan visar hela gruppen från
  // start), byggd direkt från entries-ledgern (samma poster som "Registrerade
  // poster" på Betz & Expz) istället för de statiska business-*.json-filernas
  // engångs-nettostruktur - varje spelare lägger här in sin egen
  // golfbetting-insats individuellt, det finns ingen gemensam
  // `stakePerPlayer` att utgå från (se "Föreslagen datamodell" i
  // arkitektur-dokumentet).
  //
  // Antagande (ej bekräftat av David): utläggens snittkostnad delas här per
  // AKTIV spelare (hela gruppen), inte bara de som redan lagt ut något -
  // till skillnad från den historiska modellen där bara de som faktiskt har
  // en utläggsrad får en avräkningsrad alls. Samma justerings-formel som
  // getSettlement() i business.ts i övrigt (utlägg - snittutlägg + poker +
  // betting), plus sweepstake-netto som en egen post (den historiska
  // modellen saknar sweepstake i avräkningen helt).
  const nonParticipants = edition.non_participants ?? [];
  const activePlayers = players.filter((p) => !nonParticipants.includes(p.id));
  const playerIdByName = new Map(players.map((p) => [p.fullName, p.id]));

  const utlaggByPlayer = new Map<string, number>();
  const pokerByPlayer = new Map<string, number>();
  const golfByPlayer = new Map<string, number>();
  const sweepByPlayer = new Map<string, number>();

  for (const e of allEntries) {
    const playerId = playerIdByName.get(e.playerName);
    if (!playerId) continue;
    if (e.huvudkategori === "Utlägg") {
      utlaggByPlayer.set(playerId, (utlaggByPlayer.get(playerId) ?? 0) + e.belopp);
    } else if (e.huvudkategori === "Pokerbetting") {
      pokerByPlayer.set(playerId, (pokerByPlayer.get(playerId) ?? 0) + e.belopp);
    } else if (e.huvudkategori === "Golfbetting") {
      golfByPlayer.set(playerId, (golfByPlayer.get(playerId) ?? 0) + e.belopp);
    } else if (e.huvudkategori === "Sweepstake") {
      sweepByPlayer.set(playerId, (sweepByPlayer.get(playerId) ?? 0) + e.belopp);
    }
  }

  const totalUtlagg = Array.from(utlaggByPlayer.values()).reduce((a, b) => a + b, 0);
  const avgUtlagg = activePlayers.length > 0 ? totalUtlagg / activePlayers.length : 0;

  const settlement: LiveSettlementRow[] = activePlayers.map((p) => {
    const utlagg = utlaggByPlayer.get(p.id) ?? 0;
    const poker = pokerByPlayer.get(p.id) ?? 0;
    const golfbetting = golfByPlayer.get(p.id) ?? 0;
    const sweepstake = sweepByPlayer.get(p.id) ?? 0;
    const justering = utlagg - avgUtlagg + poker + golfbetting + sweepstake;
    return {
      playerId: p.id,
      playerName: p.fullName,
      utlagg,
      poker,
      golfbetting,
      sweepstake,
      justering,
    };
  });

  return {
    year: edition.year,
    editionId: edition.id,
    roundCount: edition.round_count,
    country: edition.country,
    courses: edition.courses,
    rounds,
    totals,
    settlement,
    entryCount: allEntries.length,
  };
}

// --- Live nettoslag för Historik-sidan (tillagd 2026-09-22) - David bad om
// att Historik ska fyllas på löpande allteftersom nettoscore registreras
// rond för rond i Betz & Expz Resultat-ruta, precis som Bokslut-sidan redan
// gör för betting/avräkning. Nettoscoren som registreras där (`round_results.
// netto`, per spelare) ÄR samma sorts siffra som den historiska
// "Nettoslag"-sektionen i editions.json (rena slag per rond, lägre är
// bättre - bekräftat genom att jämföra värdeintervallet, se t.ex. 2019 års
// nettoslag-data). Från och med 2026 är nettoscore (lägst totalt över 4
// rundor) tävlingens officiella huvudresultat - Poängbogey registreras inte
// längre alls, i appen eller på annat sätt (bekräftat av David 2026-09-22).
// Den pågående säsongens "Nettoslag"-tabell är alltså inte en preliminär
// föraning om ett "riktigt" facit som kommer senare - den ÄR facit, bara
// ofullständig tills alla 4 rundor är spelade. ---

export type LiveStandingRow = {
  playerId: string;
  playerName: string;
  rounds: (number | null)[];
  total: number | null;
  /** 1-baserad placering bland spelare med minst en registrerad rond, null om spelaren själv saknar data. Ren nettoslag-rangordning (lägst total överst) - inte en officiell slutplacering. */
  placering: number | null;
};

export type LiveEditionStandings = {
  year: number;
  editionId: number;
  /** Antal rundor upplagan spelar (1-4). Tillagt 2026-09-22 - styr hur många R-kolumner tabellen visar. */
  roundCount: number;
  /** Fritext, t.ex. "Spanien" - null om inte ifyllt än. Tillagt 2026-09-22. */
  country: string | null;
  /** Bannamn per runda, index 0 = Runda 1 osv (längd roundCount). Tillagt 2026-09-22. */
  courses: string[];
  /** Hur många av rundorna som har ett sparat facit (oavsett om alla nettoscore/kategorivinnare är ifyllda). */
  roundsRegistered: number;
  standings: LiveStandingRow[];
};

export async function getLiveEditionStandings(): Promise<LiveEditionStandings | null> {
  const { data: editionRows, error } = await supabase
    .from("editions")
    .select("*")
    .eq("status", "open")
    .limit(1);
  if (error || !editionRows || editionRows.length === 0) return null;
  const edition = editionRows[0] as EditionRow;

  const { data: resultRows, error: resultsError } = await supabase
    .from("round_results")
    .select("*")
    .eq("edition_id", edition.id);
  if (resultsError) return null;

  const roundResults = mapRoundResultRows((resultRows ?? []) as RoundResultRow[]);
  const roundsRegistered = Object.keys(roundResults).length;

  const nonParticipants = edition.non_participants ?? [];
  const activePlayers = players.filter((p) => !nonParticipants.includes(p.id));

  const withTotals = activePlayers.map((p) => {
    const rounds: (number | null)[] = roundNumbers(edition.round_count).map(
      (r) => roundResults[r]?.netto[p.id] ?? null
    );
    const registered = rounds.filter((r): r is number => r != null);
    const total = registered.length > 0 ? registered.reduce((a, b) => a + b, 0) : null;
    return { playerId: p.id, playerName: p.fullName, rounds, total };
  });

  // Sortera: spelare med registrerad total först (lägst = bäst), spelare
  // utan någon rond ännu sist (oordnat sinsemellan, spelar ingen roll).
  const sorted = [...withTotals].sort((a, b) => {
    if (a.total != null && b.total != null) return a.total - b.total;
    if (a.total != null) return -1;
    if (b.total != null) return 1;
    return 0;
  });

  let nextPlacering = 1;
  const standings: LiveStandingRow[] = sorted.map((row) => {
    const placering = row.total != null ? nextPlacering++ : null;
    return { ...row, placering };
  });

  return {
    year: edition.year,
    editionId: edition.id,
    roundCount: edition.round_count,
    country: edition.country,
    courses: edition.courses,
    roundsRegistered,
    standings,
  };
}

// --- Historikdiagrammens Supabase-år (tillagd 2026-09-23) - David ville att
// Bokslut-sidans "Totalt pengaflöde per år"-diagram och de tre diagrammen på
// varje spelares detaljsida (placering/nettosnitt, kategorivinster,
// ackumulerad betting/utlägg) ska kompletteras med TDG 2026 och framåt,
// precis som Historik-sidan redan gör för de tabeller den visar. Samma
// arkitekturval som där: de gamla åren (t.o.m. 2025) kommer fortfarande från
// de statiska business-*.json/editions.json-filerna (rörs inte alls här) -
// det här lagret täcker bara år från och med SEASON_START_YEAR, oavsett om
// den editionen är öppen (pågående säsong) eller stängd (arkiverad via
// "Bokslut"-knappen). Att skriva om de statiska filerna vid varje Bokslut
// hade krävt att en serverless-funktion committar till git-repot (Vercel har
// inget skrivbart filsystem i produktion) - att läsa Supabase direkt, precis
// som den öppna säsongen redan gör, är den väg som faktiskt fungerar.
export type SupabaseSeasonPlayerStats = {
  /** 1-baserad nettoslag-placering, null om spelaren saknar registrerad rond. */
  placering: number | null;
  /** false om spelaren står i editionens non_participants - används för att bryta diagramlinjer, som getPlayerMissedYears gör för de statiska åren. */
  participated: boolean;
  nettoAvg: number | null;
  /** Antal golfbetting-/sweepstake-vinster per kategori, se computeCategoryWins. */
  categoryWinCounts: Partial<Record<BettingCategory, number>>;
  /** Summan av spelarens automatiskt framräknade golfbetting-/sweepstake-vinster (kr), motsvarande de historiska årens r.wins-summa. */
  bettingWon: number;
  /** Summan av spelarens manuellt registrerade utläggsposter (kr). */
  utlagg: number;
};

export type SupabaseSeasonStats = {
  year: number;
  /** Totalt utbetalt i golfbetting/sweepstake, samtliga spelare - motsvarande getYearlyTotals().bettingTotal. */
  bettingTotal: number;
  /** Totalt registrerat utlägg, samtliga spelare - motsvarande getYearlyTotals().utlaggTotal. */
  utlaggTotal: number;
  players: Record<string, SupabaseSeasonPlayerStats>;
};

export async function getSupabaseSeasonStats(): Promise<SupabaseSeasonStats[]> {
  const { data: editionRows, error } = await supabase
    .from("editions")
    .select("*")
    .gte("year", SEASON_START_YEAR)
    .order("year", { ascending: true });
  if (error || !editionRows || editionRows.length === 0) return [];

  const playerIdByName = new Map(players.map((p) => [p.fullName, p.id]));

  const results = await Promise.all(
    (editionRows as EditionRow[]).map(async (edition): Promise<SupabaseSeasonStats | null> => {
      const [entriesRes, betsRes, resultsRes] = await Promise.all([
        supabase.from("entries").select("*").eq("edition_id", edition.id),
        supabase.from("sweepstake_bets").select("*").eq("edition_id", edition.id),
        supabase.from("round_results").select("*").eq("edition_id", edition.id),
      ]);
      if (entriesRes.error || betsRes.error || resultsRes.error) return null;

      const entries = (entriesRes.data as EntryRow[]).map(mapEntryRow);
      const sweepstakeBets = (betsRes.data as SweepstakeBetRow[]).map(mapSweepstakeBetRow);
      const roundResults = mapRoundResultRows(resultsRes.data as RoundResultRow[]);
      const roundCount = edition.round_count;
      const nonParticipants = edition.non_participants ?? [];
      const activePlayers = players.filter((p) => !nonParticipants.includes(p.id));

      // Placering + nettosnitt - samma sortering/logik som
      // getLiveEditionStandings ovan, oavsett om säsongen är öppen eller
      // stängd (samma tabeller, bara olika `status` på edition-raden).
      const withTotals = activePlayers.map((p) => {
        const roundsArr = roundNumbers(roundCount).map((r) => roundResults[r]?.netto[p.id] ?? null);
        const registered = roundsArr.filter((r): r is number => r != null);
        const total = registered.length > 0 ? registered.reduce((a, b) => a + b, 0) : null;
        const nettoAvg = registered.length > 0 ? total! / registered.length : null;
        return { playerId: p.id, total, nettoAvg };
      });
      const sorted = [...withTotals].sort((a, b) => {
        if (a.total != null && b.total != null) return a.total - b.total;
        if (a.total != null) return -1;
        if (b.total != null) return 1;
        return 0;
      });
      let nextPlacering = 1;
      const placeringByPlayer = new Map<string, number | null>();
      const nettoByPlayer = new Map<string, number | null>();
      for (const row of sorted) {
        placeringByPlayer.set(row.playerId, row.total != null ? nextPlacering++ : null);
        nettoByPlayer.set(row.playerId, row.nettoAvg);
      }

      // Kategorivinster per spelare (stapeldiagrammet).
      const categoryCountByPlayer = new Map<string, Partial<Record<BettingCategory, number>>>();
      for (const w of computeCategoryWins(roundResults, sweepstakeBets, roundCount)) {
        const bucket = categoryCountByPlayer.get(w.playerId) ?? {};
        bucket[w.category] = (bucket[w.category] ?? 0) + 1;
        categoryCountByPlayer.set(w.playerId, bucket);
      }

      // Vunnet i kronor (golfbetting + sweepstake-utbetalningar) - de
      // automatiskt framräknade posterna, samma som visas med "Auto"-badgen
      // i Registrerade poster.
      const bettingWonByPlayer = new Map<string, number>();
      for (const e of computeAutoEntries(roundResults, sweepstakeBets, roundCount)) {
        const playerId = playerIdByName.get(e.playerName);
        if (!playerId) continue;
        bettingWonByPlayer.set(playerId, (bettingWonByPlayer.get(playerId) ?? 0) + e.belopp);
      }
      const bettingTotal = Array.from(bettingWonByPlayer.values()).reduce((a, b) => a + b, 0);

      // Utlägg per spelare (manuellt registrerade poster).
      const utlaggByPlayer = new Map<string, number>();
      for (const e of entries) {
        if (e.huvudkategori !== "Utlägg") continue;
        const playerId = playerIdByName.get(e.playerName);
        if (!playerId) continue;
        utlaggByPlayer.set(playerId, (utlaggByPlayer.get(playerId) ?? 0) + e.belopp);
      }
      const utlaggTotal = Array.from(utlaggByPlayer.values()).reduce((a, b) => a + b, 0);

      const playersOut: SupabaseSeasonStats["players"] = {};
      for (const p of players) {
        const categoryWinCounts = Object.fromEntries(
          CATEGORY_ORDER.map((c) => [c, categoryCountByPlayer.get(p.id)?.[c] ?? 0])
        ) as Partial<Record<BettingCategory, number>>;
        playersOut[p.id] = {
          placering: placeringByPlayer.get(p.id) ?? null,
          participated: !nonParticipants.includes(p.id),
          nettoAvg: nettoByPlayer.get(p.id) ?? null,
          categoryWinCounts,
          bettingWon: bettingWonByPlayer.get(p.id) ?? 0,
          utlagg: utlaggByPlayer.get(p.id) ?? 0,
        };
      }

      return { year: edition.year, bettingTotal, utlaggTotal, players: playersOut };
    })
  );

  return results
    .filter((r): r is SupabaseSeasonStats => r !== null)
    .sort((a, b) => a.year - b.year);
}
