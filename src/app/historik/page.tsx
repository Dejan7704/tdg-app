import Link from "next/link";
import { editions, getWinner, getMainSection, getPlayerByNickname } from "@/lib/data";
import { getCountryFlag } from "@/lib/countryFlags";
import { getLiveEditionStandings, type LiveEditionStandings } from "@/lib/liveBokslut";
import { roundNumbers } from "@/lib/betzExpz";

// Sidan måste renderas dynamiskt (per request) - annars skulle den pågående
// säsongens live-kort bara hämtas en gång vid deploy (Vercel-bygget) istället
// för att faktiskt uppdateras allteftersom nya rondresultat registreras i
// Betz & Expz. Bokslut-sidan (betting-business) blir dynamisk "på köpet" via
// sin searchParams-användning - Historik har ingen sådan, så det måste sättas
// explicit.
export const dynamic = "force-dynamic";

// Rondtabellen för den pågående säsongens kort - samma stil/kolumner som
// den statiska detaljvyn (historik/[year]/page.tsx), men byggd av
// LiveStandingRow (playerId-nycklad) istället för Standing (nickname-
// nycklad). Egen liten komponent så den kan återanvändas oförändrad från
// både listkortet här och den pågående säsongens detaljsida.
function LiveStandingsTable({ live }: { live: LiveEditionStandings }) {
  // Slag efter ledaren, inom parentes bredvid totalsumman - David bad om
  // detta 2026-09-26, bara för den pågående/live-säsongen (2026+), inte de
  // historiska årens statiska tabeller. Ledaren (placering 1) är referensen
  // - "0" för ledaren själv, annars "+N" (nettoslag: lägst totalt är bäst,
  // så alla andra ligger på eller över ledarens summa).
  const leaderTotal = live.standings.find((s) => s.placering === 1)?.total ?? null;
  // Samma sak per runda (David bad om detta 2026-09-26, direkt efter
  // totalsumme-varianten ovan) - "rondledaren" är lägsta registrerade
  // nettoscore för just den rundan (kan vara en annan spelare än den som
  // leder totalt), null om ingen i gruppen har ett resultat för rundan än.
  const roundLeaders = roundNumbers(live.roundCount).map((_, i) => {
    const values = live.standings
      .map((s) => s.rounds[i])
      .filter((v): v is number => v != null);
    return values.length > 0 ? Math.min(...values) : null;
  });
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-stone-500">
          <tr>
            <th className="px-4 py-2 font-medium">Plac.</th>
            <th className="px-4 py-2 font-medium">Spelare</th>
            {roundNumbers(live.roundCount).map((r) => (
              <th key={r} className="px-4 py-2 font-medium">
                <div>R{r}</div>
                {live.courses[r - 1] && (
                  <div className="text-xs font-normal text-stone-400">{live.courses[r - 1]}</div>
                )}
              </th>
            ))}
            <th className="px-4 py-2 font-medium">Totalt</th>
          </tr>
        </thead>
        <tbody>
          {live.standings.map((s) => (
            <tr key={s.playerId} className="border-t border-stone-100">
              <td className="px-4 py-2 font-semibold text-stone-400">{s.placering ?? "–"}</td>
              <td className="px-4 py-2">
                <Link
                  href={`/spelare/${s.playerId}`}
                  className="font-medium text-tdg-green hover:underline"
                >
                  {s.playerName}
                </Link>
              </td>
              {s.rounds.map((r, i) => {
                const roundLeader = roundLeaders[i];
                return (
                  <td key={i} className="px-4 py-2 text-stone-600">
                    {r != null ? (
                      <>
                        {r}
                        {roundLeader != null && (
                          <span className="ml-1 text-stone-400">
                            ({r === roundLeader ? "0" : `+${r - roundLeader}`})
                          </span>
                        )}
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                );
              })}
              <td className="px-4 py-2 font-semibold">
                {s.total != null ? (
                  <>
                    {s.total}
                    {leaderTotal != null && (
                      <span className="ml-1 font-normal text-stone-400">
                        ({s.total === leaderTotal ? "0" : `+${s.total - leaderTotal}`})
                      </span>
                    )}
                  </>
                ) : (
                  "–"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function HistorikPage() {
  const live = await getLiveEditionStandings();
  const sorted = [...editions].sort((a, b) => b.year - a.year);

  // Sorterad lista över de unika länderna (inte bara antalet) - David bad
  // 2026-09-22 om att flaggorna för samtliga listas i "Länder spelade
  // i"-rutan, inte bara siffran.
  //
  // Måste räkna med den pågående säsongens land/banor (live.country/
  // live.courses, från Supabase) också, inte bara de historiska årens
  // statiska editions.json - annars uppdateras inte rutorna när ett nytt
  // land/en ny bana registreras för innevarande år på Betz & Expz (bugg
  // som David hittade 2026-09-23: "Unika banor spelade" räknade inte med
  // Omberg Golfklubb, som registrerades för TDG 2026 runda 1).
  const uniqueCountryList = Array.from(
    new Set(
      [...editions.map((e) => e.country), live?.country].filter(
        (c): c is string => Boolean(c)
      )
    )
  ).sort((a, b) => a.localeCompare(b, "sv"));
  const uniqueCountries = uniqueCountryList.length;
  const uniqueCourses = new Set(
    [
      ...editions.flatMap((e) => Object.values(e.sections).flatMap((s) => s?.courses ?? [])),
      ...(live?.courses ?? []),
    ]
      .map((c) => c.trim())
      .filter(Boolean)
  ).size;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Historik</h1>
        <p className="mt-1 text-stone-500">
          Alla {editions.length} upplagor av Tour De Golf, 2004–2025 – rond för rond. Klicka
          på ett år för fullständigt rondresultat och tabell.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:max-w-md">
        <Stat
          label="Länder spelade i"
          value={uniqueCountries}
          extra={
            <>
              {uniqueCountryList.map((country) => {
                const flag = getCountryFlag(country);
                return flag ? (
                  <span key={country} title={country}>
                    {flag}
                  </span>
                ) : null;
              })}
            </>
          }
        />
        <Stat label="Unika banor spelade" value={uniqueCourses} />
      </div>

      <div className="flex flex-col gap-4">
        {live && (
          <div className="overflow-hidden rounded-xl border border-tdg-green-dark bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-tdg-green-dark px-4 py-3 text-white">
              <div className="flex items-baseline gap-3">
                <span className="rounded-full bg-tdg-yellow px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-tdg-green-dark">
                  Pågår
                </span>
                <Link
                  href={`/historik/${live.year}`}
                  className="text-lg font-bold text-white hover:underline"
                >
                  {live.year}
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-white/80">
                {live.country && (
                  <span>
                    {getCountryFlag(live.country) && (
                      <span aria-hidden="true" className="mr-1">
                        {getCountryFlag(live.country)}
                      </span>
                    )}
                    {live.country}
                  </span>
                )}
                <span>
                  {live.roundsRegistered} av {live.roundCount} rundor spelade
                </span>
                <span>Uppdateras live från Betz &amp; Expz</span>
              </div>
            </div>
            {live.roundsRegistered === 0 ? (
              <p className="px-4 py-3 text-sm text-stone-400">
                Inga rondresultat registrerade än – dyker upp här allteftersom de fylls i på
                Betz &amp; Expz.
              </p>
            ) : (
              <LiveStandingsTable live={live} />
            )}
          </div>
        )}
        {sorted.map((e) => {
          const winner = getWinner(e);
          const winnerPlayer = winner ? getPlayerByNickname(winner.name) : undefined;
          const section = getMainSection(e);
          const courses = section?.courses.filter(Boolean) ?? [];
          const participants = section?.standings ?? [];

          return (
            <div key={e.year} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-tdg-gray-light px-4 py-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-stone-400">
                    TDG {e.roman}
                  </span>
                  <Link
                    href={`/historik/${e.year}`}
                    className="text-lg font-bold text-tdg-green hover:underline"
                  >
                    {e.year}
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-stone-600">
                  <span>
                    {e.country ? (
                      <>
                        {getCountryFlag(e.country) && (
                          <span aria-hidden="true" className="mr-1">
                            {getCountryFlag(e.country)}
                          </span>
                        )}
                        {e.country}
                      </>
                    ) : (
                      <span className="italic text-stone-400">Land okänt</span>
                    )}
                  </span>
                  <span>{participants.length} spelare</span>
                  <span>
                    Vinnare:{" "}
                    {winner ? (
                      winnerPlayer ? (
                        <Link
                          href={`/spelare/${winnerPlayer.id}`}
                          className="font-semibold text-tdg-green hover:underline"
                        >
                          {winner.name}
                        </Link>
                      ) : (
                        <span className="font-semibold text-stone-800">{winner.name}</span>
                      )
                    ) : (
                      "–"
                    )}
                  </span>
                </div>
              </div>

              {courses.length > 0 ? (
                <div className="flex flex-col sm:flex-row">
                  <ul className="divide-y divide-stone-100 sm:w-72 sm:shrink-0 sm:border-r sm:border-stone-100">
                    {courses.map((course, i) => (
                      <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                        <span className="w-16 shrink-0 font-medium text-stone-400">
                          Runda {i + 1}
                        </span>
                        <span className="text-stone-700">{course}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex-1 border-t border-stone-100 px-4 py-3 sm:border-t-0">
                    <div className="text-xs font-medium uppercase tracking-wide text-stone-400">
                      Deltagare
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-1 gap-y-1 text-sm">
                      {participants.map((p, i) => {
                        const player = getPlayerByNickname(p.name);
                        const isLast = i === participants.length - 1;
                        return (
                          <span key={p.name}>
                            {player ? (
                              <Link
                                href={`/spelare/${player.id}`}
                                className="text-tdg-green hover:underline"
                              >
                                {p.name}
                              </Link>
                            ) : (
                              <span className="text-stone-700">{p.name}</span>
                            )}
                            {!isLast && <span className="text-stone-300">,</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="px-4 py-3 text-sm text-stone-400">
                  Endast slutplacering registrerad – rondresultat/banor saknas i källdatan.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  extra,
}: {
  label: string;
  value: number;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-tdg-gray-light p-4 text-center">
      <div className="text-2xl font-bold text-tdg-green">{value}</div>
      <div className="mt-1 text-xs text-stone-600">{label}</div>
      {extra && <div className="mt-2 flex flex-wrap justify-center gap-1 text-lg">{extra}</div>}
    </div>
  );
}
