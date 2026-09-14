import Link from "next/link";
import { notFound } from "next/navigation";
import {
  editions,
  getEdition,
  getMainSectionKey,
  getPlayerByNickname,
  SECTION_LABELS,
  type SectionKey,
} from "@/lib/data";

export function generateStaticParams() {
  return editions.map((e) => ({ year: String(e.year) }));
}

const SECTION_ORDER: SectionKey[] = ["poängbogey", "nettoslag", "bruttoslag"];

export default async function EditionPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  const edition = getEdition(Number(year));
  if (!edition) return notFound();

  const availableSections = SECTION_ORDER.filter((key) => edition.sections[key]);
  const mainKey = getMainSectionKey(edition);
  const allCourses = new Set<string>();
  for (const key of availableSections) {
    for (const c of edition.sections[key]!.courses) allCourses.add(c);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/historik" className="text-sm text-tdg-green hover:underline">
          ← Alla år
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-stone-900">
          TDG {edition.roman} · {edition.year}
        </h1>
        {allCourses.size > 0 && (
          <p className="mt-1 text-stone-500">Banor: {Array.from(allCourses).join(", ")}</p>
        )}
      </div>

      {!edition.hasRoundData && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Endast slutplacering finns registrerad för det här året – rondresultat saknas i
          källdatan.
        </p>
      )}

      {edition.hasRoundData && mainKey && mainKey !== "poängbogey" && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Poängbogey saknas i källdatan för det här året – placeringen baseras istället på{" "}
          {SECTION_LABELS[mainKey].toLowerCase()}.
        </p>
      )}

      {availableSections.map((key) => {
        const section = edition.sections[key]!;
        return (
          <div key={key} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              {SECTION_LABELS[key]}
              {key === mainKey && (
                <span className="ml-2 rounded-full bg-tdg-green-dark px-2 py-0.5 text-xs font-medium normal-case text-white">
                  Tävlingens huvudresultat
                </span>
              )}
            </h2>
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-stone-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Plac.</th>
                    <th className="px-4 py-2 font-medium">Spelare</th>
                    {section.courses.map((c, i) => (
                      <th key={i} className="px-4 py-2 font-medium">
                        R{i + 1}
                      </th>
                    ))}
                    <th className="px-4 py-2 font-medium">Totalt</th>
                  </tr>
                </thead>
                <tbody>
                  {section.standings.map((s) => {
                    const player = getPlayerByNickname(s.name);
                    return (
                      <tr key={s.name} className="border-t border-stone-100">
                        <td className="px-4 py-2 font-semibold text-stone-400">
                          {s.placering}
                        </td>
                        <td className="px-4 py-2">
                          {player ? (
                            <Link
                              href={`/spelare/${player.id}`}
                              className="font-medium text-tdg-green hover:underline"
                            >
                              {s.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{s.name}</span>
                          )}
                        </td>
                        {s.rounds.map((r, i) => (
                          <td key={i} className="px-4 py-2 text-stone-600">
                            {r ?? "–"}
                          </td>
                        ))}
                        <td className="px-4 py-2 font-semibold">{s.total ?? "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
