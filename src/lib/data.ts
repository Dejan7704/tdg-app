import editionsRaw from "@/data/editions.json";
import playersRaw from "@/data/players.json";

export type Standing = {
  name: string;
  placering: number;
  total: number | null;
  rounds: (number | null)[];
};

export type Section = {
  courses: string[];
  standings: Standing[];
};

export type SectionKey = "poängbogey" | "nettoslag" | "bruttoslag";

export const SECTION_LABELS: Record<SectionKey, string> = {
  poängbogey: "Poängbogey",
  nettoslag: "Nettoslag",
  bruttoslag: "Bruttoslag",
};

export type Edition = {
  year: number;
  roman: string;
  hasRoundData: boolean;
  country: string | null;
  sections: Partial<Record<SectionKey, Section>>;
};

export type Player = {
  id: string;
  fullName: string;
  nicknames: string[];
  /** Sökväg till en inzoomad porträttbild (cirkelbeskuren i UI:t). Valfri - inte alla spelare har en bild ännu. */
  photo?: string;
};

// Initialer att visa som platshållare i cirkeln där en spelare saknar photo -
// delad mellan spelarlistan och den enskilda spelarprofilen så de alltid ser
// likadana ut.
export function playerInitials(fullName: string): string {
  return fullName
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export const editions = editionsRaw as Edition[];
export const players = playersRaw as Player[];

// Hela TDG-historikens år-spann (2004–2025 f.n.). Används för att tvinga
// samma x-axel-skala i flera diagram på samma sida, så de går att jämföra
// visuellt år för år.
export const EDITIONS_MIN_YEAR = Math.min(...editions.map((e) => e.year));
export const EDITIONS_MAX_YEAR = Math.max(...editions.map((e) => e.year));

export function getEdition(year: number): Edition | undefined {
  return editions.find((e) => e.year === year);
}

// Poängbogey-tabellen är den officiella tävlingen (huvudresultatet).
// Om den saknar riktiga siffror (t.ex. 2019, där bara nettoslag registrerades)
// faller vi tillbaka på nettoslag/bruttoslag.
export function getMainSection(edition: Edition): Section | undefined {
  return edition.sections.poängbogey ?? edition.sections.nettoslag ?? edition.sections.bruttoslag;
}

export function getMainSectionKey(edition: Edition): SectionKey | undefined {
  if (edition.sections.poängbogey) return "poängbogey";
  if (edition.sections.nettoslag) return "nettoslag";
  if (edition.sections.bruttoslag) return "bruttoslag";
  return undefined;
}

export function getWinner(edition: Edition): Standing | undefined {
  return getMainSection(edition)?.standings.find((s) => s.placering === 1);
}

// Slår upp vilken spelare (av de 9) ett smeknamn tillhör, om känt.
const nicknameToPlayer = new Map<string, Player>();
for (const p of players) {
  for (const n of p.nicknames) nicknameToPlayer.set(n, p);
}

export function getPlayerByNickname(nickname: string): Player | undefined {
  return nicknameToPlayer.get(nickname);
}

export function getPlayer(id: string): Player | undefined {
  return players.find((p) => p.id === id);
}

export function getPlayerHistory(playerId: string) {
  const player = getPlayer(playerId);
  if (!player) return [];
  return editions
    .filter((e) => getMainSection(e)?.standings.some((s) => player.nicknames.includes(s.name)))
    .map((e) => ({
      year: e.year,
      roman: e.roman,
      standing: getMainSection(e)!.standings.find((s) => player.nicknames.includes(s.name))!,
    }));
}

// Vilka upplagor (år) spelaren INTE deltog i, av samtliga upplagor som
// hållits (baserat på huvudresultatet, samma källa som getPlayerHistory).
// Enda källan till sanning för "missade den här upplagan" - används både av
// linjediagrammet (för att bryta linjen) och stapeldiagrammet (för
// missad-markören), så de alltid är eniga om exakt vilka år det gäller.
export function getPlayerMissedYears(playerId: string): number[] {
  const played = new Set(getPlayerHistory(playerId).map((h) => h.year));
  return editions.map((e) => e.year).filter((y) => !played.has(y));
}

// Placering per år (baserat på tävlingens huvudresultat, samma logik som
// getPlayerHistory) - men täcker ALLA upplagor (2004–2025), inte bara de
// spelaren faktiskt deltog i. År spelaren missade får value: null, vilket gör
// att linjediagrammet bryter linjen där istället för att felaktigt binda ihop
// upplagan innan och upplagan efter ett missat år.
export function getPlayerPlaceringSeries(playerId: string): { year: number; value: number | null }[] {
  const player = getPlayer(playerId);
  if (!player) return [];
  return editions.map((e) => {
    const standing = getMainSection(e)?.standings.find((s) => player.nicknames.includes(s.name));
    return { year: e.year, value: standing ? standing.placering : null };
  });
}

// Snitt nettoslag per rond, per år (medel av de rondresultat som finns
// registrerade för spelaren i Nettoslag-tabellen). Skiljer sig medvetet från
// getMainSection - det här är alltid renodlad Nettoslag, inte huvudresultatet,
// eftersom frågan handlar om spelnivå snarare än placering.
//
// Ger value: null för upplagor spelaren missade (så linjen bryts där), men
// hoppar helt över år där ingen nettoslag-data alls finns registrerad (t.ex.
// 2004–2007) - det är brist på källdata för alla spelare, inte ett tecken på
// att just den här spelaren var borta.
export function getPlayerNettoAverageSeries(playerId: string): { year: number; value: number | null }[] {
  const player = getPlayer(playerId);
  if (!player) return [];
  const out: { year: number; value: number | null }[] = [];
  for (const e of editions) {
    const section = e.sections.nettoslag;
    if (!section) continue;
    const standing = section.standings.find((s) => player.nicknames.includes(s.name));
    if (!standing) {
      out.push({ year: e.year, value: null });
      continue;
    }
    const rounds = standing.rounds.filter((r): r is number => r != null);
    const avg = rounds.length ? rounds.reduce((a, b) => a + b, 0) / rounds.length : null;
    out.push({ year: e.year, value: avg });
  }
  return out;
}

// Vilka år spelaren vunnit tävlingens huvudresultat, i kronologisk ordning -
// samma källa som getPlayerHistory.
export function getPlayerWinYears(playerId: string): number[] {
  return getPlayerHistory(playerId)
    .filter((h) => h.standing.placering === 1)
    .map((h) => h.year);
}

export function getSegerrekord(): { player: Player; segrar: number }[] {
  const wins = new Map<string, number>();
  for (const e of editions) {
    const w = getWinner(e);
    if (!w) continue;
    const player = getPlayerByNickname(w.name);
    const key = player?.id ?? w.name;
    wins.set(key, (wins.get(key) ?? 0) + 1);
  }
  return Array.from(wins.entries())
    .map(([id, segrar]) => ({ player: getPlayer(id) ?? unknownPlayer(id), segrar }))
    .sort((a, b) => b.segrar - a.segrar);
}

function unknownPlayer(name: string): Player {
  return { id: name, fullName: name, nicknames: [name] };
}

// Snittplacering över samtliga upplagor spelaren faktiskt deltog i (lägre är
// bättre - 1:a plats räknas som 1). Används som sista tiebreak i
// getRankedPlayers. null om spelaren aldrig deltagit (finns inte i praktiken,
// men skyddar mot division med 0).
export function getPlayerAveragePlacering(playerId: string): number | null {
  const history = getPlayerHistory(playerId);
  if (history.length === 0) return null;
  const sum = history.reduce((acc, h) => acc + h.standing.placering, 0);
  return sum / history.length;
}

// Spelare rankade: flest segrar överst, vid lika segrar rankas flest spelade
// upplagor högre, och vid fortsatt lika avgör bästa (lägsta) genomsnittliga
// placering över spelarens historik. Om även det är exakt lika sorteras
// alfabetiskt som absolut sista utväg.
export function getRankedPlayers(): { player: Player; segrar: number; upplagor: number }[] {
  const segrar = new Map(getSegerrekord().map((s) => [s.player.id, s.segrar]));
  return players
    .map((player) => ({
      player,
      segrar: segrar.get(player.id) ?? 0,
      upplagor: getPlayerHistory(player.id).length,
      avgPlacering: getPlayerAveragePlacering(player.id),
    }))
    .sort((a, b) => {
      if (b.segrar !== a.segrar) return b.segrar - a.segrar;
      if (b.upplagor !== a.upplagor) return b.upplagor - a.upplagor;
      if (a.avgPlacering != null && b.avgPlacering != null && a.avgPlacering !== b.avgPlacering) {
        return a.avgPlacering - b.avgPlacering;
      }
      return a.player.fullName.localeCompare(b.player.fullName, "sv");
    });
}
