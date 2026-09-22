import { supabase, type EditionRow, type EntryRow, type RoundResultRow, type SweepstakeBetRow } from "@/lib/supabase";
import { players } from "@/lib/data";
import { type BettingCategory } from "@/lib/business";
import {
  RESULT_CATEGORIES,
  GOLF_VINST_DEFAULT,
  mapEntryRow,
  mapSweepstakeBetRow,
  mapRoundResultRows,
  buildAllEntries,
  playerName,
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
  for (let runda = 1; runda <= 4; runda++) {
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

  const allEntries = buildAllEntries(entries, sweepstakeBets, roundResults);

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
// nettoslag-data). Poängbogey (tävlingens officiella huvudresultat) hanteras
// medvetet inte här - det registreras inte i appen alls, se
// arkitektur-dokumentet - så den pågående säsongen visas alltid som en
// "Nettoslag"-tabell, aldrig som ett riktigt slutresultat. ---

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
  /** Hur många av rundorna 1-4 som har ett sparat facit (oavsett om alla nettoscore/kategorivinnare är ifyllda). */
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
    const rounds: (number | null)[] = [1, 2, 3, 4].map((r) => roundResults[r]?.netto[p.id] ?? null);
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
    roundsRegistered,
    standings,
  };
}
