import {
  editions,
  players,
  getPlayer,
  getMainSection,
  getPlayerHistory,
  getPlayerWinYears,
  getPlayerAveragePlacering,
  type Player,
} from "@/lib/data";
import { getPlayerBettingWinsSeries } from "@/lib/business";

// "Projected winner"-prognosen för nästa TDG-upplaga (David bad om detta
// 2026-09-19). Bygger fyra delfaktorer per spelare, viktade enligt Davids
// egna prioriteringar från den diskussionen:
//
//   1. Senaste formen + trend   40%  (viktigast - vad gör spelaren just nu)
//   2. Karriärstatistik         25%  (segrar + snittplacering över alla år)
//   3. Sverige-historik         20%  (TDG 2026 spelas i Sverige - kolla hur
//                                     spelaren presterat de gånger tävlingen
//                                     faktiskt hållits här: 2004-2010, 2020,
//                                     2023 - alltså inte bara två år som
//                                     ursprungligen diskuterat, utan nio)
//   4. Golfbetting-form         15%  (färsk signal, men brusigare data - hålls
//                                     medvetet lägst viktad)
//
// Varje delfaktor normaliseras 0-100 över de 9 spelarna (bästa spelaren i
// just den kategorin får 100, sämsta får 0, resten linjärt däremellan) innan
// de viktas ihop - det gör metoden lätt att förklara ("bäst i varje kategori
// får full pott") och okänslig för vilken skala respektive råmått råkar ha.
//
// Medvetet transparent/enkel poängmodell (inte ML, inte en svart låda) - på
// Davids uttryckliga önskan, eftersom det ska gå att förklara i en kort
// tooltip och vara kul att diskutera snarare än att kännas som ett facit.

export const PROJECTED_YEAR = 2026;
const HOST_COUNTRY = "Sverige";

const WEIGHTS = {
  recentForm: 0.4,
  careerStats: 0.25,
  swedenHistory: 0.2,
  bettingForm: 0.15,
};

// Inom "Senaste formen + trend": själva snittet väger tyngre än trendriktningen.
const RECENT_FORM_SPLIT = { avg: 0.7, trend: 0.3 };
// Inom "Karriärstatistik": vinstprocent och snittplacering vägs lika.
const CAREER_SPLIT = { winRate: 0.5, avgPlacering: 0.5 };

const RECENT_EDITIONS_COUNT = 5; // hur många senast spelade upplagor "formen" baseras på
const TREND_EDITIONS_COUNT = 7; // hur många senast spelade upplagor trenden baseras på
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

/** Lutningen (minsta-kvadrat-linjär regression) för en serie mot dess egna kronologiska index - negativ lutning för placering betyder att spelaren förbättrats (lägre placeringssiffra är bättre). */
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
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
  recentAvgPlacering: number; // viktat snitt, senaste upp till 5 spelade upplagor
  recentEditionsUsed: number;
  trendSlope: number; // negativ = förbättring
  winRate: number; // segrar / spelade upplagor
  careerAvgPlacering: number;
  totalSegrar: number;
  totalUpplagor: number;
  swedenAvgPlacering: number; // med fallback till karriärsnitt om spelaren aldrig spelat i Sverige (borde inte hända - alla 9 var med redan 2004-2010)
  swedenAppearances: number;
  bettingWeightedAvg: number; // viktat snitt antal golfbetting-vinster/år, senaste upp till 5 betting-år
};

function computeRawStats(player: Player): PlayerRawStats {
  const history = getPlayerHistory(player.id); // kronologisk ordning, bara upplagor spelaren faktiskt spelade

  const recentSlice = history.slice(-RECENT_EDITIONS_COUNT);
  const recentNewestFirst = [...recentSlice].reverse().map((h) => h.standing.placering);
  const recentAvgPlacering = weightedAverage(recentNewestFirst) ?? getPlayerAveragePlacering(player.id) ?? 5;

  const trendSlice = history.slice(-TREND_EDITIONS_COUNT).map((h) => h.standing.placering);
  const trendSlope = linearSlope(trendSlice);

  const totalUpplagor = history.length;
  const totalSegrar = getPlayerWinYears(player.id).length;
  const winRate = totalUpplagor > 0 ? totalSegrar / totalUpplagor : 0;
  const careerAvgPlacering = getPlayerAveragePlacering(player.id) ?? 5;

  const swedenPlaceringar: number[] = [];
  for (const e of editions) {
    if (e.country !== HOST_COUNTRY) continue;
    const standing = getMainSection(e)?.standings.find((s) => player.nicknames.includes(s.name));
    if (standing) swedenPlaceringar.push(standing.placering);
  }
  const swedenAppearances = swedenPlaceringar.length;
  const swedenAvgPlacering =
    swedenAppearances > 0
      ? swedenPlaceringar.reduce((a, b) => a + b, 0) / swedenAppearances
      : careerAvgPlacering; // fallback: ingen Sverige-data -> neutralt, använd karriärsnittet istället

  const bettingSeries = getPlayerBettingWinsSeries(player.id); // kronologisk ordning, bara år med betting-data
  const bettingRecent = bettingSeries.slice(-RECENT_BETTING_YEARS_COUNT);
  const bettingNewestFirst = [...bettingRecent].reverse().map((s) => s.value ?? 0);
  const bettingWeightedAvg = weightedAverage(bettingNewestFirst) ?? 0;

  return {
    player,
    recentAvgPlacering,
    recentEditionsUsed: recentSlice.length,
    trendSlope,
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

/** Räknar ut hela prognosen för samtliga 9 spelare, rankade fallande efter totalpoäng. Vid exakt lika totalpoäng avgör flest karriärsegrar, sedan alfabetiskt - rent deterministiskt så resultatet inte skiftar mellan sidladdningar. */
export function getProjectedWinnerRanking(): ProjectedWinnerEntry[] {
  const raw = players.map((p) => computeRawStats(p));

  const recentAvgNorm = normalize(raw.map((r) => r.recentAvgPlacering), true);
  const trendNorm = normalize(raw.map((r) => r.trendSlope), true);
  const winRateNorm = normalize(raw.map((r) => r.winRate), false);
  const careerAvgNorm = normalize(raw.map((r) => r.careerAvgPlacering), true);
  const swedenNorm = normalize(raw.map((r) => r.swedenAvgPlacering), true);
  const bettingNorm = normalize(raw.map((r) => r.bettingWeightedAvg), false);

  const entries: ProjectedWinnerEntry[] = raw.map((r, i) => {
    const recentForm = RECENT_FORM_SPLIT.avg * recentAvgNorm[i] + RECENT_FORM_SPLIT.trend * trendNorm[i];
    const careerStats = CAREER_SPLIT.winRate * winRateNorm[i] + CAREER_SPLIT.avgPlacering * careerAvgNorm[i];
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

/** Bekvämlighetsfunktion: bara favoriten (etta i rankingen), plus en kort svensk motiveringstext att visa i en tooltip. */
export function getProjectedWinner2026(): { entry: ProjectedWinnerEntry; explanation: string } {
  const ranking = getProjectedWinnerRanking();
  const entry = ranking[0];
  const s = entry.stats;
  const explanation =
    `Beräknat utifrån senaste formen (40%), karriärstatistik (25%), historik vid Sverige-upplagor (20%) och aktuell golfbetting-form (15%). ` +
    `${entry.player.fullName}: snitt ${s.recentAvgPlacering.toFixed(1)} de senaste ${s.recentEditionsUsed} spelade upplagorna, ${s.totalSegrar} segrar totalt (snitt ${s.careerAvgPlacering.toFixed(1)} över ${s.totalUpplagor} upplagor), ` +
    `och snitt ${s.swedenAvgPlacering.toFixed(1)} vid de ${s.swedenAppearances} upplagor som spelats i Sverige. Obs: en lekfull uppskattning, inget facit!`;
  return { entry, explanation };
}
