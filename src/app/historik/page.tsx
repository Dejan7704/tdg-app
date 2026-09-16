import Link from "next/link";
import { editions, getWinner, getMainSection, getPlayerByNickname } from "@/lib/data";

export default function HistorikPage() {
  const sorted = [...editions].sort((a, b) => b.year - a.year);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Historik</h1>
        <p className="mt-1 text-stone-500">
          Alla {editions.length} upplagor av Tour De Golf, 2004–2025 – rond för rond. Klicka
          på ett år för fullständigt rondresultat och tabell.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {sorted.map((e) => {
          const winner = getWinner(e);
          const winnerPlayer = winner ? getPlayerByNickname(winner.name) : undefined;
          const courses = getMainSection(e)?.courses.filter(Boolean) ?? [];

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
                  <span>{e.country ?? <span className="italic text-stone-400">Land okänt</span>}</span>
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
                <ul className="divide-y divide-stone-100">
                  {courses.map((course, i) => (
                    <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="w-20 shrink-0 font-medium text-stone-400">
                        Runda {i + 1}
                      </span>
                      <span className="text-stone-700">{course}</span>
                    </li>
                  ))}
                </ul>
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
