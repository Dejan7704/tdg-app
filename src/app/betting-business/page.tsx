import Link from "next/link";
import {
  getAllBusinessYears,
  getBusinessYear,
  getBusinessYears,
  getCategoryTotals,
  getSettlement,
  getUnknownParticipants,
  getYearlyTotals,
  resolveBusinessPlayer,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type BusinessYear,
} from "@/lib/business";
import { EDITIONS_MIN_YEAR, EDITIONS_MAX_YEAR } from "@/lib/data";
import { DualAxisLineChart } from "@/components/LineChart";

function formatSek(n: number): string {
  const rounded = Math.round(n);
  return (rounded > 0 ? "+" : "") + rounded.toLocaleString("sv-SE") + " kr";
}

function PlayerBadge({ nickname }: { nickname: string }) {
  const { player, isUnknown } = resolveBusinessPlayer(nickname);
  if (isUnknown) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-medium">{nickname}</span>
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
          okänd
        </span>
      </span>
    );
  }
  return (
    <Link href={`/spelare/${player.id}`} className="font-medium text-tdg-green hover:underline">
      {nickname}
    </Link>
  );
}

function RoundCard({ business, round }: { business: BusinessYear; round: number }) {
  const roundData = business.rounds.find((r) => r.round === round);
  if (!roundData) return null;

  return (
    <div className="overflow-hidden rounded-xl bg-tdg-gray-light">
      <div className="bg-tdg-green-dark px-4 py-2 text-sm font-semibold text-white">
        Runda {round}
      </div>
      <div className="grid divide-y divide-white sm:grid-cols-3 sm:divide-x sm:divide-y-0 lg:grid-cols-6">
        {CATEGORY_ORDER.map((cat) => {
          const wins = roundData.wins.filter((w) => w.category === cat);
          return (
            <div key={cat} className="px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
                {CATEGORY_LABELS[cat]}
              </div>
              {wins.length === 0 ? (
                <div className="mt-1 text-sm text-stone-400">–</div>
              ) : (
                <div className="mt-1 flex flex-col gap-1.5">
                  {wins.map((w, i) => (
                    <div key={i} className="flex flex-col text-sm leading-tight">
                      <PlayerBadge nickname={w.nickname} />
                      <span className="text-xs text-stone-600">{formatSek(w.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TotalsTable({ business }: { business: BusinessYear }) {
  const totals = getCategoryTotals(business);
  const names = Object.keys(totals).sort(
    (a, b) =>
      Object.values(totals[b]).reduce((x, y) => x + (y ?? 0), 0) -
      Object.values(totals[a]).reduce((x, y) => x + (y ?? 0), 0)
  );

  return (
    <div className="overflow-x-auto overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-stone-500">
          <tr>
            <th className="px-4 py-2 font-medium">Spelare</th>
            {CATEGORY_ORDER.map((cat) => (
              <th key={cat} className="px-4 py-2 font-medium">
                {CATEGORY_LABELS[cat]}
              </th>
            ))}
            <th className="px-4 py-2 font-medium">Totalt vunnet</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => {
            const row = totals[name];
            const sum = Object.values(row).reduce((a, b) => a + (b ?? 0), 0);
            return (
              <tr key={name} className="border-t border-stone-100">
                <td className="px-4 py-2">
                  <PlayerBadge nickname={name} />
                </td>
                {CATEGORY_ORDER.map((cat) => (
                  <td key={cat} className="px-4 py-2 text-stone-600">
                    {row[cat] ? formatSek(row[cat]!) : "–"}
                  </td>
                ))}
                <td className="px-4 py-2 font-semibold">{formatSek(sum)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SettlementTable({ business }: { business: BusinessYear }) {
  const rows = getSettlement(business).sort((a, b) => b.justering - a.justering);

  return (
    <div className="overflow-x-auto overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-stone-500">
          <tr>
            <th className="px-4 py-2 font-medium">Spelare</th>
            <th className="px-4 py-2 font-medium">Utlägg</th>
            <th className="px-4 py-2 font-medium">Poker</th>
            <th className="px-4 py-2 font-medium">Betting</th>
            <th className="px-4 py-2 font-medium">Justering</th>
            <th className="px-4 py-2 font-medium">Avräkning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.nickname} className="border-t border-stone-100">
              <td className="px-4 py-2">
                <PlayerBadge nickname={r.nickname} />
              </td>
              <td className="px-4 py-2 text-stone-600">{r.utlagg.toLocaleString("sv-SE")} kr</td>
              <td className="px-4 py-2 text-stone-600">{formatSek(r.poker)}</td>
              <td className="px-4 py-2 text-stone-600">{formatSek(r.betting)}</td>
              <td
                className={
                  "px-4 py-2 font-semibold " +
                  (r.justering >= 0 ? "text-tdg-green" : "text-red-600")
                }
              >
                {formatSek(r.justering)}
              </td>
              <td className="px-4 py-2 text-stone-500">{r.note ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function BettingBusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = await searchParams;
  const allYears = getAllBusinessYears();
  const yearsWithData = getBusinessYears();
  const requestedYear = Number(resolvedSearchParams?.year);
  const year = allYears.includes(requestedYear) ? requestedYear : yearsWithData[0];
  const business = getBusinessYear(year);
  const yearlyTotals = getYearlyTotals();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Bokslut</h1>
        <p className="mt-1 max-w-2xl text-stone-500">
          Golfbetting rond för rond, pokerresultat, utlägg och vem som ska betala vem –
          samlat på ett ställe per resa.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Utveckling över åren
        </h2>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-xs text-stone-400">
            Totalt betting-vunnet och totalt utlägg per år, summerat över alla spelare –
            visar vilka år vi spelat om och lagt ut mest, oavsett vem. Bruten linje betyder
            att det året saknar data ännu.
          </p>
          <div className="mt-2">
            <DualAxisLineChart
              left={{
                data: yearlyTotals.map((d) => ({ year: d.year, value: d.bettingTotal })),
                color: "#065f46",
                label: "Betting-vunnet totalt",
                format: "sek",
              }}
              right={{
                data: yearlyTotals.map((d) => ({ year: d.year, value: d.utlaggTotal })),
                color: "#b45309",
                label: "Utlägg totalt",
                format: "sek",
              }}
              yearDomain={{ minYear: EDITIONS_MIN_YEAR, maxYear: EDITIONS_MAX_YEAR }}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 text-sm">
        {allYears.map((y) => {
          const hasData = yearsWithData.includes(y);
          const isSelected = y === year;
          return (
            <Link
              key={y}
              href={`/betting-business?year=${y}`}
              className={
                "min-w-16 rounded-xl px-3 py-2 text-center font-semibold transition " +
                (isSelected
                  ? "bg-tdg-green-dark text-white"
                  : hasData
                    ? "bg-tdg-gray-light text-tdg-green hover:shadow-sm"
                    : "bg-tdg-gray-light text-stone-400 hover:shadow-sm")
              }
            >
              {y}
            </Link>
          );
        })}
      </div>

      {!business ? (
        <p className="text-stone-500">Ingen data för {year} ännu.</p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Betting rond för rond
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {business.rounds.map((r) => (
                <RoundCard key={r.round} business={business} round={r.round} />
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Betting totalt {year}
            </h2>
            <TotalsTable business={business} />
            <p className="text-xs text-stone-400">
              Insats: {business.stakePerPlayer.toLocaleString("sv-SE")} kr per spelare.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Utlägg, poker & avräkning {year}
            </h2>
            <SettlementTable business={business} />
            <p className="text-xs text-stone-400">
              Justering = utlägg minus gruppens snittutlägg, plus poker- och
              betting-netto. Positivt betyder att spelaren ska få pengar, negativt att
              spelaren ska betala.
            </p>
          </section>

          {(() => {
            const unknown = getUnknownParticipants(business);
            if (unknown.length === 0) return null;
            return (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Smeknamnet {unknown.map((n) => `"${n}"`).join(", ")} i källfilen kunde inte
                kopplas till någon av de 9 kända spelarna automatiskt – flaggat som
                &quot;okänd&quot; ovan tills det är bekräftat.
              </p>
            );
          })()}
        </>
      )}
    </div>
  );
}
