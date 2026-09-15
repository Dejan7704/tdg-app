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
} from "@/lib/business";
import { DualAxisLineChart } from "@/components/LineChart";
import { StackedBarChart } from "@/components/StackedBarChart";

export function generateStaticParams() {
  return players.map((p) => ({ slug: p.id }));
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const player = getPlayer(slug);
  if (!player) return notFound();

  const history = getPlayerHistory(player.id);
  const wins = history.filter((h) => h.standing.placering === 1).length;
  const best = history.length ? Math.min(...history.map((h) => h.standing.placering)) : null;
  const totalEditions = editions.length;
  const playedPct = totalEditions ? Math.round((history.length / totalEditions) * 100) : 0;
  const winsPct = totalEditions ? Math.round((wins / totalEditions) * 100) : 0;

  const placeringSeries = getPlayerPlaceringSeries(player.id);
  const nettoSeries = getPlayerNettoAverageSeries(player.id);
  const missedYears = getPlayerMissedYears(player.id);
  const bettingByCategory = getPlayerBettingWinsByCategorySeries(player.id);
  const cumulativeBetting = getPlayerCumulativeBettingSeries(player.id);
  const cumulativeUtlagg = getPlayerCumulativeUtlaggSeries(player.id);
  const bettingCategories = CATEGORY_ORDER.map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    color: CATEGORY_COLORS[key],
  }));
  // Samma år-spann i båda diagrammen (2004–2025) så de går att jämföra
  // år för år, trots att de visar olika mätvärden.
  const yearDomain = { minYear: EDITIONS_MIN_YEAR, maxYear: EDITIONS_MAX_YEAR };

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
              <p className="mt-0.5 text-stone-400">Känd som: {player.nicknames.join(" / ")}</p>
            )}
          </div>
        </div>
        <p className="mt-2 max-w-2xl rounded-lg bg-tdg-gray-light px-4 py-3 text-sm text-stone-600">
          Presentation saknas ännu – lägg till en kort text om {player.fullName} här
          (bakgrund, spelstil, klassiska citat, etc).
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Upplagor spelade" value={history.length} sub={`${playedPct}% av alla upplagor`} />
        <Stat label="Segrar" value={wins} sub={`${winsPct}% av alla upplagor`} />
        <Stat label="Bästa placering" value={best ? `${best}:a` : "–"} />
      </div>

      <div className="flex flex-col gap-4">
        <ChartCard
          title="Placering & snitt nettoslag per år"
          subtitle="Vänsteraxeln (grön) visar placering – lägre är bättre, 1:an ligger högst upp. Högeraxeln (orange) visar snitt nettoslag per rond."
        >
          <DualAxisLineChart
            left={{ data: placeringSeries, color: "#065f46", label: "Placering", invert: true, format: "placering" }}
            right={{ data: nettoSeries, color: "#b45309", label: "Snitt nettoslag", format: "decimal1" }}
            yearDomain={yearDomain}
            missedYears={missedYears}
          />
        </ChartCard>

        <ChartCard
          title="Antal golfbetting-vinster per år"
          subtitle="Färgkodat per kategori (Closest to pin, Longest Drive, 1:a nio, 2:a nio, Totalen). Samma år-skala som diagrammet ovan – bara 2025 har data ännu, fler år tillkommer."
        >
          <StackedBarChart data={bettingByCategory} categories={bettingCategories} yearDomain={yearDomain} />
        </ChartCard>

        <ChartCard
          title="Ackumulerad betting-vinst & utlägg"
          subtitle="Summan av allt spelaren vunnit i golfbetting respektive lagt ut, år för år över hela historiken. Bruten linje betyder att det året saknar data ännu."
        >
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
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
      <p className="mt-0.5 text-xs text-stone-400">{subtitle}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl bg-tdg-gray-light p-4 text-center">
      <div className="text-2xl font-bold text-tdg-green">{value}</div>
      <div className="mt-1 text-xs text-stone-600">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-400">{sub}</div>}
    </div>
  );
}
