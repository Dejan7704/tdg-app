import business2007 from "@/data/business-2007.json";
import business2011 from "@/data/business-2011.json";
import business2014 from "@/data/business-2014.json";
import business2015 from "@/data/business-2015.json";
import business2016 from "@/data/business-2016.json";
import business2017 from "@/data/business-2017.json";
import business2018 from "@/data/business-2018.json";
import business2019 from "@/data/business-2019.json";
import business2023 from "@/data/business-2023.json";
import business2025 from "@/data/business-2025.json";
import {
  getPlayer,
  getPlayerByNickname,
  getPlayerMissedYears,
  EDITIONS_MIN_YEAR,
  EDITIONS_MAX_YEAR,
  type Player,
} from "@/lib/data";

export type BettingCategory =
  | "closest"
  | "longest"
  | "forstaNio"
  | "andraNio"
  | "totalen"
  | "sweepstake";

export const CATEGORY_LABELS: Record<BettingCategory, string> = {
  closest: "Closest to pin",
  longest: "Longest Drive",
  forstaNio: "1:a nio",
  andraNio: "2:a nio",
  totalen: "Totalen",
  sweepstake: "Sweepstake",
};

export const CATEGORY_ORDER: BettingCategory[] = [
  "closest",
  "longest",
  "forstaNio",
  "andraNio",
  "totalen",
  "sweepstake",
];

// Färger för kategorierna i stapeldiagrammet (spelarprofilen), från den
// validerade kategoriska paletten (dataviz-skill) – ordningen är vald för att
// klara CVD-separation mellan intilliggande segment, ändra inte ordningen
// utan att köra om validate_palette.js. "sweepstake" (lila) tillkom
// 2026-09-15 när 2016–2018 års filer lades till - inte omkörd genom
// valideringsskriptet, men valt för att vara tydligt skild från de andra 5.
export const CATEGORY_COLORS: Record<BettingCategory, string> = {
  closest: "#2a78d6", // blå
  longest: "#eb6834", // orange
  forstaNio: "#1baf7a", // aqua
  andraNio: "#eda100", // gul
  totalen: "#e87ba4", // magenta
  sweepstake: "#8b5cf6", // lila
};

// Sweepstake (2016–2018) är en sidobetting där alla 9 "köper" en gissning på
// vem som vinner ronden - vinner man gissningen får man utbetalning från de
// som gissade fel. Källfilerna lagrar bara ett NETTO per spelare/runda (inte
// separata insats-/vinstbelopp), så här registreras enbart de ronder där
// nettot var positivt (dvs. spelaren vann sin gissning) som en "vinst" - i
// linje med hur alla andra kategorier bara registrerar vinster, inte
// förluster. Det gör att sweepstake-vinster syns korrekt i
// "Antal golfbetting-vinster per år", men `getBettingNetto()`/avräkningen
// blir en förenkling för dessa tre år (subtraherar bara stakePerPlayer, inte
// motsvarande sweepstake-förluster) - se öppna frågor i statusdokumentet.

export type BettingWin = { category: BettingCategory; nickname: string; amount: number };
export type BettingRound = { round: number; wins: BettingWin[] };

export type BusinessYear = {
  year: number;
  stakePerPlayer: number;
  rounds: BettingRound[];
  utlagg: { nickname: string; belopp: number }[];
  poker: { nickname: string; netto: number }[];
  settlementNotes: { nickname: string; note: string }[];
};

const BUSINESS_YEARS: Record<number, BusinessYear> = {
  2007: business2007 as BusinessYear,
  2011: business2011 as BusinessYear,
  2014: business2014 as BusinessYear,
  2015: business2015 as BusinessYear,
  2016: business2016 as BusinessYear,
  2017: business2017 as BusinessYear,
  2018: business2018 as BusinessYear,
  2019: business2019 as BusinessYear,
  2023: business2023 as BusinessYear,
  2025: business2025 as BusinessYear,
};

export function getBusinessYears(): number[] {
  return Object.keys(BUSINESS_YEARS)
    .map(Number)
    .sort((a, b) => b - a);
}

export function getBusinessYear(year: number): BusinessYear | undefined {
  return BUSINESS_YEARS[year];
}

// Alla år som ska visas som en egen "årsbox" på Betting & Business-sidan -
// från första TDG-upplagan och fram till och med innevarande år (så nästa års
// resa syns direkt, redan innan det finns data). Övre gränsen räknas ut från
// dagens datum (inte hårdkodad), så sidan visar automatiskt även 2027, 2028
// osv. med tiden utan att koden behöver ändras. De allra flesta av dessa år
// saknar ännu data - se `getBusinessYear()`, som ger `undefined` för dem.
export function getAllBusinessYears(): number[] {
  const currentYear = new Date().getFullYear();
  const maxYear = Math.max(currentYear, EDITIONS_MAX_YEAR);
  const years: number[] = [];
  for (let y = maxYear; y >= EDITIONS_MIN_YEAR; y--) years.push(y);
  return years;
}

// Slår upp spelaren bakom ett smeknamn i betting-/utläggsdatan. Om smeknamnet
// inte kan kopplas till någon av de 9 kända spelarna (t.ex. "A+" i 2025 års
// underlag) returneras ett platshållarobjekt så UI:t kan flagga det tydligt.
export function resolveBusinessPlayer(nickname: string): { player: Player; isUnknown: boolean } {
  const player = getPlayerByNickname(nickname);
  if (player) return { player, isUnknown: false };
  return { player: { id: nickname, fullName: nickname, nicknames: [nickname] }, isUnknown: true };
}

// Alla unika smeknamn som förekommer i ett års betting-/utläggsunderlag.
export function getBusinessParticipants(business: BusinessYear): string[] {
  const names = new Set<string>();
  for (const r of business.rounds) for (const w of r.wins) names.add(w.nickname);
  for (const u of business.utlagg) names.add(u.nickname);
  return Array.from(names);
}

// Smeknamn i årets underlag som inte kunde kopplas till någon av de 9 kända
// spelarna. Ska normalt vara tom lista - används för att flagga i UI:t om ett
// nytt/okänt smeknamn dyker upp i framtida års filer.
export function getUnknownParticipants(business: BusinessYear): string[] {
  return getBusinessParticipants(business).filter((name) => !getPlayerByNickname(name));
}

// Summerar vinster per smeknamn och kategori över alla ronder.
export function getCategoryTotals(
  business: BusinessYear
): Record<string, Partial<Record<BettingCategory, number>>> {
  const totals: Record<string, Partial<Record<BettingCategory, number>>> = {};
  for (const r of business.rounds) {
    for (const w of r.wins) {
      totals[w.nickname] = totals[w.nickname] ?? {};
      totals[w.nickname]![w.category] = (totals[w.nickname]![w.category] ?? 0) + w.amount;
    }
  }
  return totals;
}

// Total betting-netto (vinster minus insats) per smeknamn.
export function getBettingNetto(business: BusinessYear): Record<string, number> {
  const totals = getCategoryTotals(business);
  const netto: Record<string, number> = {};
  for (const name of getBusinessParticipants(business)) {
    const won = Object.values(totals[name] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    netto[name] = won - business.stakePerPlayer;
  }
  return netto;
}

// Antal golfbetting-vinster per år för en spelare (oavsett kategori - Closest,
// Longest, 1:a nio, 2:a nio, Totalen räknas alla lika, en "vinst" = en rad i
// källdatan). Ger en trendlinje som visar om spelaren vinner mer eller mindre
// betting över tid, oberoende av vilken typ av vad det gäller.
export function getPlayerBettingWinsSeries(playerId: string): { year: number; value: number | null }[] {
  const player = getPlayer(playerId);
  if (!player) return [];
  return getBusinessYears()
    .slice()
    .sort((a, b) => a - b)
    .map((year) => {
      const business = getBusinessYear(year)!;
      let count = 0;
      for (const r of business.rounds) {
        for (const w of r.wins) {
          if (player.nicknames.includes(w.nickname)) count++;
        }
      }
      return { year, value: count };
    });
}

// Antal golfbetting-vinster per år OCH kategori för en spelare, för hela
// TDG-historikens år-spann (EDITIONS_MIN_YEAR–EDITIONS_MAX_YEAR), inte bara de
// år vi har betting-data för. Åren utan betting-data får bara nollor - det gör
// att stapeldiagrammets x-axel kan tvingas till samma skala/spann som
// placering/nettoslag-diagrammet ovanför det på spelarprofilen, så de två
// diagrammen går att jämföra år för år trots att de visar olika saker.
//
// `participated` säger om spelaren faktiskt var med den upplagan (baserat på
// huvudresultatet, samma källa som getPlayerHistory) - oberoende av om vi har
// betting-data för året. Används för att rita en tydlig "deltog inte"-markör
// i stapeldiagrammet, skild från "deltog men vann inget".
export function getPlayerBettingWinsByCategorySeries(
  playerId: string
): { year: number; values: Record<BettingCategory, number>; participated: boolean }[] {
  const player = getPlayer(playerId);
  const missedYears = new Set(player ? getPlayerMissedYears(playerId) : []);
  const years: number[] = [];
  for (let y = EDITIONS_MIN_YEAR; y <= EDITIONS_MAX_YEAR; y++) years.push(y);

  return years.map((year) => {
    const values = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<
      BettingCategory,
      number
    >;
    if (player) {
      const business = getBusinessYear(year);
      if (business) {
        for (const r of business.rounds) {
          for (const w of r.wins) {
            if (player.nicknames.includes(w.nickname)) {
              values[w.category] += 1;
            }
          }
        }
      }
    }
    return { year, values, participated: !missedYears.has(year) };
  });
}

export type SettlementRow = {
  nickname: string;
  utlagg: number;
  poker: number;
  betting: number;
  justering: number;
  note?: string;
};

// Bygger hela avräkningen: utlägg, poker, betting och en "justering" som visar
// vem som totalt ska få eller betala pengar, med hänsyn till att utläggen inte
// är jämnt fördelade i gruppen.
export function getSettlement(business: BusinessYear): SettlementRow[] {
  const bettingNetto = getBettingNetto(business);
  const pokerByName = new Map(business.poker.map((p) => [p.nickname, p.netto]));
  const noteByName = new Map(business.settlementNotes.map((n) => [n.nickname, n.note]));

  const totalUtlagg = business.utlagg.reduce((a, u) => a + u.belopp, 0);
  const avgUtlagg = business.utlagg.length ? totalUtlagg / business.utlagg.length : 0;

  return business.utlagg.map((u) => {
    const poker = pokerByName.get(u.nickname) ?? 0;
    const betting = bettingNetto[u.nickname] ?? 0;
    const justering = u.belopp - avgUtlagg + poker + betting;
    return {
      nickname: u.nickname,
      utlagg: u.belopp,
      poker,
      betting,
      justering,
      note: noteByName.get(u.nickname),
    };
  });
}
