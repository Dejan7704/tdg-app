import {
  editions,
  players,
  getPlayer,
  getMainSection,
  getPlayerHistory,
  getPlayerWinYears,
  getPlayerAveragePlacering,
  EDITIONS_MAX_YEAR,
  type Player,
} from "@/lib/data";
import { getPlayerBettingWinsSeries } from "@/lib/business";
import { getSupabaseSeasonStats, type SupabaseSeasonStats } from "@/lib/liveBokslut";

// "Projected winner"-prognosen för nästa TDG-upplaga (David bad om detta
// 2026-09-19, formeln förenklad 2026-09-23 så den ordagrant matchar
// tooltip-texten). Bygger fyra delfaktorer per spelare, viktade enligt
// Davids egna prioriteringar:
//
//   1. Senaste 3 årens TDG-placeringar   40%  (viktigast - vad gör spelaren
//                                              just nu, rent snitt över de
//                                              senaste 3 spelade upplagorna)
//   2. Antal TDG-vinster totalt sett     25%  (ren vinsträkning över karriären)
//   3. Sverige-historik                  20%  (TDG 2026 spelas i Sverige - kolla
//                                              hur spelaren presterat de gånger
//                                              tävlingen faktiskt hållits här:
//                                              2004-2010, 2020, 2023 - alltså
//                                              inte bara två år som ursprungligen
//                                              diskuterat, utan nio)
//   4. Golfbetting-form                  15%  (färsk signal, men brusigare
//                                              data - hålls medvetet lägst
//                                              viktad)
//
// Varje delfaktor normaliseras 0-100 över de 9 spelarna (bästa spelaren i
// just den kategorin får 100, sämsta får 0, resten linjärt däremellan) innan
// de viktas ihop - det gör metoden lätt att förklara ("bäst i varje kategori
// får full pott") och okänslig för vilken skala respektive råmått råkar ha.
//
// Medvetet transparent/enkel poängmodell (inte ML, inte en svart låda) - på
// Davids uttryckliga önskan, eftersom det ska gå att förklara i en kort
// tooltip och vara kul att diskutera snarare än att kännas som ett facit.
// Formeln ska alltid räkna exakt det tooltip-texten beskriver - inga dolda
// delfaktorer utöver de fyra ovan.

const HOST_COUNTRY = "Sverige";

const WEIGHTS = {
  recentForm: 0.4,
  careerStats: 0.25,
  swedenHistory: 0.2,
  bettingForm: 0.15,
};

const RECENT_EDITIONS_COUNT = 3; // hur många senast spelade upplagor "formen" baseras på
const RECENT_BETTING_YEARS_COUNT = 5; // hur många senaste betting-år som räknas

/** Viktat snitt där nyaste värdet (index 0) väger tyngst, äldsta minst - vikter n, n-1, ..., 1. */
function weightedAverage(newestFirst: number[]): number | null {
  if (newestFirst.length === 0) return null;
  const n = newestFirst.length;
  let sumWeight = 0;
  let sumWeighted = 0;
  newestFirst.forEach((v, i) => {
    const weight = n - i;
    sumWeight += weight;
    sumWeighted += weight * v;
  });
  return sumWeighted / sumWeight;
}

/** Min-max-normaliserar en lista råvärden till 0-100. `lowerIsBetter` styr riktningen (placering: lägre=bättre, vinstprocent: högre=bättre). Om alla spelare har exakt samma värde får alla 100 (ingen särskiljer sig, så ingen ska straffas). */
function normalize(values: number[], lowerIsBetter: boolean): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 100);
  return values.map((v) => {
    const t = (v - min) / (max - min);
    const goodness = lowerIsBetter ? 1 - t : t;
    return goodness * 100;
  });
}

type PlayerRawStats = {
  player: Player;
  recentAvgPlacering: number; // viktat snitt, senaste upp till 3 spelade upplagor
  recentEditionsUsed: number;
  winRate: number; // segrar / spelade upplagor
  careerAvgPlacering: number; // visas i tooltip-texten, ingår inte längre i själva poängen
  totalSegrar: number;
  totalUpplagor: number;
  swedenAvgPlacering: number; // med fallback till karriärsnitt om spelaren aldrig spelat i Sverige (borde inte hända - alla 9 var med redan 2004-2010)
  swedenAppearances: number;
  bettingWeightedAvg: number; // viktat snitt antal golfbetting-vinster/år, senaste upp till 5 betting-år
};

/**
 * `closedSeasons` = stängda Supabase-upplagor (från "Bokslut <år>"-knappen på
 * Betz & Expz, se getSupabaseSeasonStats), kronologiskt stigande, tillagt
 * 2026-09-23 så prognosen räknas om utifrån nyss avslutade TDG-upplagor
 * istället för att stanna på de statiska filerna t.o.m. 2025. Tom lista ger
 * exakt samma resultat som innan (bara statisk historik).
 */
function computeRawStats(player: Player, closedSeasons: SupabaseSeasonStats[]): PlayerRawStats {
  const history = getPlayerHistory(player.id); // kronologisk ordning, bara upplagor spelaren faktiskt spelade

  // Kombinerad placeringshistorik: statiska upplagor + stängda Supabase-år
  // spelaren faktiskt deltog i och har en registrerad placering för.
  const combinedPlaceringar: { year: number; placering: number }[] = [
    ...history.map((h) => ({ year: h.year, placering: h.standing.placering })),
  ];
  for (const season of closedSeasons) {
    const p = season.players[player.id];
    if (p?.participated && p.placering != null) {
      combinedPlaceringar.push({ year: season.year, placering: p.placering });
    }
  }
  combinedPlaceringar.sort((a, b) => a.year - b.year);

  const recentSlice = combinedPlaceringar.slice(-RECENT_EDITIONS_COUNT);
  const recentNewestFirst = [...recentSlice].reverse().map((h) => h.placering);
  const recentAvgPlacering =
    weightedAverage(recentNewestFirst) ?? getPlayerAveragePlacering(player.id) ?? 5;

  const totalUpplagor = combinedPlaceringar.length;
  const closedSeasonWins = closedSeasons.filter(
    (season) => season.players[player.id]?.placering === 1
  ).length;
  const totalSegrar = getPlayerWinYears(player.id).length + closedSeasonWins;
  const winRate = totalUpplagor > 0 ? totalSegrar / totalUpplagor : 0;
  const careerAvgPlacering =
    combinedPlaceringar.length > 0
      ? combinedPlaceringar.reduce((acc, h) => acc + h.placering, 0) / combinedPlaceringar.length
      : (getPlayerAveragePlacering(player.id) ?? 5);

  const swedenPlaceringar: number[] = [];
  for (const e of editions) {
    if (e.country !== HOST_COUNTRY) continue;
    const standing = getMainSection(e)?.standings.find((s) => player.nicknames.includes(s.name));
    if (standing) swedenPlaceringar.push(standing.placering);
  }
  for (const season of closedSeasons) {
    if (season.country !== HOST_COUNTRY) continue;
    const p = season.players[player.id];
    if (p?.participated && p.placering != null) swedenPlaceringar.push(p.placering);
  }
  const swedenAppearances = swedenPlaceringar.length;
  const swedenAvgPlacering =
    swedenAppearances > 0
      ? swedenPlaceringar.reduce((a, b) => a + b, 0) / swedenAppearances
      : careerAvgPlacering; // fallback: ingen Sverige-data -> neutralt, använd karriärsnittet istället

  const bettingSeries = getPlayerBettingWinsSeries(player.id); // kronologisk ordning, bara år med betting-data
  const combinedBetting: { year: number; value: number }[] = [
    ...bettingSeries.map((s) => ({ year: s.year, value: s.value ?? 0 })),
  ];
  for (const season of closedSeasons) {
    const p = season.players[player.id];
    if (!p) continue;
    const winCount = Object.values(p.categoryWinCounts).reduce((a, b) => a + (b ?? 0), 0);
    combinedBetting.push({ year: season.year, value: winCount });
  }
  combinedBetting.sort((a, b) => a.year - b.year);
  const bettingRecent = combinedBetting.slice(-RECENT_BETTING_YEARS_COUNT);
  const bettingNewestFirst = [...bettingRecent].reverse().map((s) => s.value);
  const bettingWeightedAvg = weightedAverage(bettingNewestFirst) ?? 0;

  return {
    player,
    recentAvgPlacering,
    recentEditionsUsed: recentSlice.length,
    winRate,
    careerAvgPlacering,
    totalSegrar,
    totalUpplagor,
    swedenAvgPlacering,
    swedenAppearances,
    bettingWeightedAvg,
  };
}

export type ProjectedWinnerEntry = {
  player: Player;
  totalScore: number;
  components: {
    recentForm: number;
    careerStats: number;
    swedenHistory: number;
    bettingForm: number;
  };
  stats: PlayerRawStats;
};

/** Räknar ut hela prognosen för samtliga 9 spelare, rankade fallande efter totalpoäng. Vid exakt lika totalpoäng avgör flest karriärsegrar, sedan alfabetiskt - rent deterministiskt så resultatet inte skiftar mellan sidladdningar. `closedSeasons` = stängda Supabase-upplagor att räkna in utöver den statiska historiken, se computeRawStats. */
export function getProjectedWinnerRanking(closedSeasons: SupabaseSeasonStats[] = []): ProjectedWinnerEntry[] {
  const raw = players.map((p) => computeRawStats(p, closedSeasons));

  const recentAvgNorm = normalize(raw.map((r) => r.recentAvgPlacering), true);
  const winRateNorm = normalize(raw.map((r) => r.winRate), false);
  const swedenNorm = normalize(raw.map((r) => r.swedenAvgPlacering), true);
  const bettingNorm = normalize(raw.map((r) => r.bettingWeightedAvg), false);

  const entries: ProjectedWinnerEntry[] = raw.map((r, i) => {
    const recentForm = recentAvgNorm[i];
    const careerStats = winRateNorm[i];
    const swedenHistory = swedenNorm[i];
    const bettingForm = bettingNorm[i];
    const totalScore =
      WEIGHTS.recentForm * recentForm +
      WEIGHTS.careerStats * careerStats +
      WEIGHTS.swedenHistory * swedenHistory +
      WEIGHTS.bettingForm * bettingForm;
    return {
      player: r.player,
      totalScore,
      components: { recentForm, careerStats, swedenHistory, bettingForm },
      stats: r,
    };
  });

  return entries.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.stats.totalSegrar !== a.stats.totalSegrar) return b.stats.totalSegrar - a.stats.totalSegrar;
    return a.player.fullName.localeCompare(b.player.fullName, "sv");
  });
}

/**
 * Hela "Projected winner"-prognosen för nästa TDG-upplaga, inklusive vilket
 * år prognosen faktiskt gäller. Läser stängda Supabase-upplagor (via
 * getSupabaseSeasonStats) och räknar med dem både i formeln (computeRawStats)
 * och i vilket år som räknas som "nästa" - så prognosen blir "2027" så fort
 * "Bokslut 2026"-knappen tryckts på Betz & Expz-sidan, utan att någon behöver
 * röra koden. Tillagd 2026-09-23 på Davids begäran. Körs bara server-side
 * (async, läser Supabase) - se src/app/page.tsx som await:ar den direkt i en
 * force-dynamic Server Component så den alltid räknas om per sidladdning.
 */
export async function getProjectedWinnerForNextSeason(): Promise<{
  year: number;
  entry: ProjectedWinnerEntry;
  explanation: string;
}> {
  const allSeasons = await getSupabaseSeasonStats();
  const closedSeasons = allSeasons.filter((s) => s.status === "closed");

  const latestClosedYear = closedSeasons.reduce((max, s) => Math.max(max, s.year), EDITIONS_MAX_YEAR);
  const year = latestClosedYear + 1;

  const ranking = getProjectedWinnerRanking(closedSeasons);
  const entry = ranking[0];
  const s = entry.stats;
  const explanation =
    `Beräknat utifrån senaste 3 årens TDG placeringar (40%), Antal TDG vinster totalt sett (25%), historik vid TDG Sverige-upplagor (20%) och TDG golfbetting vinster (15%). ` +
    `${entry.player.fullName}: snittplacering ${s.recentAvgPlacering.toFixed(1)} de senaste ${s.recentEditionsUsed} spelade upplagorna, ${s.totalSegrar} segrar totalt ` +
    `och snitt ${s.swedenAvgPlacering.toFixed(1)} vid de ${s.swedenAppearances} upplagor som spelats i Sverige. Obs: en lekfull uppskattning, inget facit!`;
  return { year, entry, explanation };
}
