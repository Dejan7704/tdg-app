import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  players,
  editions,
  getPlayer,
  getPlayerHistory,
  getPlayerPlaceringSeries,
  getPlayerNettoAverageSeries,
  getPlayerMissedYears,
  getPlayerAveragePlacering,
  playerInitials,
  EDITIONS_MIN_YEAR,
  EDITIONS_MAX_YEAR,
} from "@/lib/data";
import {
  getPlayerBettingWinsByCategorySeries,
  getPlayerCumulativeBettingSeries,
  getPlayerCumulativeUtlaggSeries,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  type BettingCategory,
} from "@/lib/business";
import { getSupabaseSeasonStats } from "@/lib/liveBokslut";
import { DualAxisLineChart } from "@/components/LineChart";
import { StackedBarChart } from "@/components/StackedBarChart";

export function generateStaticParams() {
  return players.map((p) => ({ slug: p.id }));
}

// Sidan måste renderas dynamiskt (per request), precis som Historik och
// Bokslut - annars skulle Supabase-åren (se nedan) bara hämtas en gång vid
// deploy istället för att uppdateras allteftersom nya rondresultat
// registreras i Betz & Expz.
export const dynamic = "force-dynamic";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const player = getPlayer(slug);
  if (!player) return notFound();

  // Diagrammen kompletteras med TDG 2026 och framåt (öppen ELLER stängd
  // säsong) direkt från Supabase - David bad om detta 2026-09-23. De äldre
  // åren (t.o.m. 2025) kommer fortfarande oförändrat från de statiska
  // editions.json/business-*.json-filerna nedan, se getSupabaseSeasonStats i
  // liveBokslut.ts för det fullständiga resonemanget kring varför det här
  // görs vid läsning istället för att skriva om de statiska filerna.
  const supabaseSeasonStats = await getSupabaseSeasonStats();
  const supabasePlayerYears = supabaseSeasonStats.map((s) => ({
    year: s.year,
    stats: s.players[player.id],
  }));

  // Siffrutorna (Upplagor spelade/Segrar/Bästa placering/Snittplacering)
  // ska INTE uppdateras löpande under en pågående säsong - David var tydlig
  // 2026-09-23 om att de bara ska räkna med det FÄRDIGA, slutgiltiga
  // facit som finns när ett år stängs via "Bokslut"-knappen (till skillnad
  // från diagrammen ovan/nedan, som medvetet uppdateras direkt). Filtrerar
  // därför bort "open"-editionen (den pågående säsongen) här.
  const closedSupabaseYears = supabasePlayerYears.filter(
    (s) => supabaseSeasonStats.find((season) => season.year === s.year)?.status === "closed"
  );
  const closedSupabasePlayed = closedSupabaseYears.filter(
    (s) => s.stats?.participated && s.stats.placering != null
  );

  const history = getPlayerHistory(player.id);
  const wins =
    history.filter((h) => h.standing.placering === 1).length +
    closedSupabasePlayed.filter((s) => s.stats!.placering === 1).length;
  const staticBest = history.length ? Math.min(...history.map((h) => h.standing.placering)) : null;
  const supabaseBest = closedSupabasePlayed.length
    ? Math.min(...closedSupabasePlayed.map((s) => s.stats!.placering!))
    : null;
  const best =
    staticBest != null && supabaseBest != null
      ? Math.min(staticBest, supabaseBest)
      : (staticBest ?? supabaseBest);
  const playedCount = history.length + closedSupabasePlayed.length;
  const avgPlaceringSum =
    history.reduce((sum, h) => sum + h.standing.placering, 0) +
    closedSupabasePlayed.reduce((sum, s) => sum + s.stats!.placering!, 0);
  const avgPlacering = playedCount > 0 ? avgPlaceringSum / playedCount : null;
  const totalEditions = editions.length + closedSupabaseYears.length;
  const playedPct = totalEditions ? Math.round((playedCount / totalEditions) * 100) : 0;
  const winsPct = totalEditions ? Math.round((wins / totalEditions) * 100) : 0;

  const placeringSeries = [
    ...getPlayerPlaceringSeries(player.id),
    ...supabasePlayerYears.map((s) => ({ year: s.year, value: s.stats?.placering ?? null })),
  ];
  const nettoSeries = [
    ...getPlayerNettoAverageSeries(player.id),
    ...supabasePlayerYears.map((s) => ({ year: s.year, value: s.stats?.nettoAvg ?? null })),
  ];
  const missedYears = [
    ...getPlayerMissedYears(player.id),
    ...supabasePlayerYears.filter((s) => s.stats && !s.stats.participated).map((s) => s.year),
  ];
  const bettingByCategory = [
    ...getPlayerBettingWinsByCategorySeries(player.id),
    ...supabasePlayerYears.map((s) => ({
      year: s.year,
      values: Object.fromEntries(
        CATEGORY_ORDER.map((c) => [c, s.stats?.categoryWinCounts[c] ?? 0])
      ) as Record<BettingCategory, number>,
      participated: s.stats?.participated ?? true,
    })),
  ];

  // Ackumulerade diagram - Supabase-årens värden fortsätter räkna vidare från
  // där de statiska årens sista värde slutade, så kurvan blir sammanhängande
  // över hela tidsspannet.
  const staticCumulativeBetting = getPlayerCumulativeBettingSeries(player.id);
  let cumulativeBettingRunning = staticCumulativeBetting.at(-1)?.value ?? 0;
  const cumulativeBetting = [
    ...staticCumulativeBetting,
    ...supabasePlayerYears.map((s) => {
      cumulativeBettingRunning += s.stats?.bettingWon ?? 0;
      return { year: s.year, value: cumulativeBettingRunning };
    }),
  ];

  const staticCumulativeUtlagg = getPlayerCumulativeUtlaggSeries(player.id);
  let cumulativeUtlaggRunning = staticCumulativeUtlagg.at(-1)?.value ?? 0;
  const cumulativeUtlagg = [
    ...staticCumulativeUtlagg,
    ...supabasePlayerYears.map((s) => {
      cumulativeUtlaggRunning += s.stats?.utlagg ?? 0;
      return { year: s.year, value: cumulativeUtlaggRunning };
    }),
  ];

  const bettingCategories = CATEGORY_ORDER.map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    color: CATEGORY_COLORS[key],
  }));
  // Samma år-spann i samtliga diagram (2004– senaste registrerade Supabase-år)
  // så de går att jämföra år för år, trots att de visar olika mätvärden.
  const chartMaxYear = supabaseSeasonStats.length
    ? Math.max(EDITIONS_MAX_YEAR, ...supabaseSeasonStats.map((s) => s.year))
    : EDITIONS_MAX_YEAR;
  const yearDomain = { minYear: EDITIONS_MIN_YEAR, maxYear: chartMaxYear };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/spelare" className="text-sm text-tdg-green hover:underline">
          ← Alla spelare
        </Link>
        <div className="mt-2 flex items-center gap-4">
          {player.photo ? (
            <Image
              src={player.photo}
              alt={player.fullName}
              width={88}
              height={88}
              className="h-[5.5rem] w-[5.5rem] shrink-0 rounded-full object-cover ring-2 ring-tdg-gray-light"
            />
          ) : (
            <span className="flex h-[5.5rem] w-[5.5rem] shrink-0 items-center justify-center rounded-full bg-tdg-gray-light text-2xl font-semibold text-tdg-green ring-2 ring-tdg-gray-light">
              {playerInitials(player.fullName)}
            </span>
          )}
          <div>
            <h1 className="text-2xl font-bold text-stone-900">{player.fullName}</h1>
            {player.nicknames.length > 0 && (
              <p className="mt-0.5 text-stone-900">Känd som: {player.nicknames.join(" / ")}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Upplagor spelade" value={playedCount} sub={`${playedPct}%`} />
        <Stat label="Segrar" value={wins} sub={`${winsPct}%`} />
        <Stat label="Bästa placering" value={best ? `${best}:a` : "–"} />
        <Stat label="Snittplacering" value={avgPlacering != null ? avgPlacering.toFixed(1) : "–"} />
      </div>

      <div className="flex flex-col gap-4">
        <ChartCard title="Placering & snitt nettoslag per år">
          <DualAxisLineChart
            left={{ data: placeringSeries, color: "#065f46", label: "Placering", invert: true, format: "placering" }}
            right={{ data: nettoSeries, color: "#b45309", label: "Snitt nettoslag", format: "decimal1" }}
            yearDomain={yearDomain}
            missedYears={missedYears}
          />
        </ChartCard>

        <ChartCard title="Antal golfbetting-vinster per år">
          <StackedBarChart data={bettingByCategory} categories={bettingCategories} yearDomain={yearDomain} />
        </ChartCard>

        <ChartCard title="Ackumulerad betting-vinst & utlägg">
          <DualAxisLineChart
            left={{ data: cumulativeBetting, color: "#065f46", label: "Ackumulerad betting-vinst", format: "sek" }}
            right={{ data: cumulativeUtlagg, color: "#b45309", label: "Ackumulerat utlägg", format: "sek" }}
            yearDomain={yearDomain}
            missedYears={missedYears}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-stone-400">{subtitle}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl bg-tdg-gray-light p-4 text-center">
      <div className="text-2xl font-bold text-tdg-green">{value}</div>
      <div className="mt-1 text-xs text-stone-600">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-900">{sub}</div>}
    </div>
  );
}
