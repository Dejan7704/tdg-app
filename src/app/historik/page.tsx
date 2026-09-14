import Link from "next/link";
import { editions, getWinner, getMainSection } from "@/lib/data";

export default function HistorikPage() {
  const sorted = [...editions].sort((a, b) => b.year - a.year);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Historik</h1>
        <p className="mt-1 text-stone-500">
          Alla {editions.length} upplagor av Tour De Golf, 2004–2025. Klicka på ett år för
          rondresultat och tabell.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-500">
            <tr>
              <th className="px-4 py-2 font-medium">Upplaga</th>
              <th className="px-4 py-2 font-medium">År</th>
              <th className="px-4 py-2 font-medium">Land</th>
              <th className="px-4 py-2 font-medium">Vinnare</th>
              <th className="px-4 py-2 font-medium">Antal spelare</th>
              <th className="px-4 py-2 font-medium">Rondresultat</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const winner = getWinner(e);
              return (
                <tr key={e.year} className="border-t border-stone-100 hover:bg-tdg-gray-light">
                  <td className="px-4 py-2 text-stone-400">TDG {e.roman}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/historik/${e.year}`}
                      className="font-semibold text-tdg-green hover:underline"
                    >
                      {e.year}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-stone-500">
                    {e.country ?? <span className="italic text-stone-300">okänt</span>}
                  </td>
                  <td className="px-4 py-2">{winner?.name ?? "–"}</td>
                  <td className="px-4 py-2 text-stone-500">
                    {getMainSection(e)?.standings.length ?? 0}
                  </td>
                  <td className="px-4 py-2 text-stone-500">
                    {e.hasRoundData ? "Fullständig" : "Endast placering"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
