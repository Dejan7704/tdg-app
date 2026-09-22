import Link from "next/link";
import { notFound } from "next/navigation";
import {
  editions,
  getEdition,
  getPlayerByNickname,
  SECTION_LABELS,
  type SectionKey,
} from "@/lib/data";
import { getLiveEditionStandings } from "@/lib/liveBokslut";
import { getCountryFlag } from "@/lib/countryFlags";
import { roundNumbers } from "@/lib/betzExpz";

export function generateStaticParams() {
  return editions.map((e) => ({ year: String(e.year) }));
}

// Måste renderas dynamiskt (per request) - annars skulle den pågående
// säsongens sida bara hämta live-datan en gång vid deploy istället för att
// uppdateras allteftersom nya rondresultat registreras. De historiska årens
// sidor kostar i praktiken inget extra att rendera på nytt varje gång (liten
// app, 9 användare) så samma inställning används för hela rutten. Se samma
// resonemang i historik/page.tsx.
export const dynamic = "force-dynamic";

// Nettoslag visas alltid först och märks "Tävlingens huvudresultat" - David
// bad om detta 2026-09-22 för samtliga historiska år (inte bara 2026 och
// framåt), som en ren visningsändring. Den tidigare amber-varningen om att
// "Poängbogey saknas... placeringen baseras istället på nettoslag" togs
// bort helt samma dag (nästa rad i chatten) - David ville inte ha någon
// text alls om att Poängbogey/Bruttoslag saknas för ett visst år.
// getMainSectionKey() (som styr getWinner() m.fl. på andra sidor) är
// oförändrad och opåverkad - bara denna sidas UI slutade fråga efter den.
const SECTION_ORDER: SectionKey[] = ["nettoslag", "bruttoslag", "poängbogey"];

export default async function EditionPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  const edition = getEdition(Number(year));

  // Den pågående säsongen finns inte i den statiska editions.json (den blir
  // en "riktig" upplaga där först när Bokslut-knappen trycks på Betz & Expz)
  // - om året som efterfrågas råkar vara den öppna säsongen visas istället
  // en live-vy byggd av round_results.netto, tydligt märkt "Pågår". David
  // bad om detta 2026-09-22 som en del av att Historik ska fyllas på
  // löpande allteftersom rondresultat registreras. Från och med 2026 är
  // nettoscore (lägst totalt över 4 rundor) tävlingens officiella
  // huvudresultat - Poängbogey registreras inte längre alls (bekräftat av
  // David 2026-09-22), så nettoslaget här är inte en "preliminär" siffra
  // som väntar på något annat facit, det ÄR facit.
  if (!edition) {
    const live = await getLiveEditionStandings();
    if (live && live.year === Number(year)) {
      return (
        <div className="flex flex-col gap-6">
          <div>
            <Link href="/historik" className="text-sm text-tdg-green hover:underline">
              ← Alla år
            </Link>
            <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold text-stone-900">
              TDG {live.year}
              <span className="rounded-full bg-tdg-yellow px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-tdg-green-dark">
                Pågår
              </span>
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-stone-500">
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
                {live.roundsRegistered} av {live.roundCount} rundor spelade – uppdateras live från
                Betz &amp; Expz.
              </span>
            </p>
            {live.courses.some(Boolean) && (
              <p className="mt-1 text-stone-500">
                Banor: {live.courses.filter(Boolean).join(", ")}
              </p>
            )}
          </div>

          {live.roundsRegistered === 0 ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Inga rondresultat registrerade än.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Nettoslag
                <span className="ml-2 rounded-full bg-tdg-green-dark px-2 py-0.5 text-xs font-medium normal-case text-white">
                  Tävlingens huvudresultat
                </span>
              </h2>
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
                            <div className="text-xs font-normal text-stone-400">
                              {live.courses[r - 1]}
                            </div>
                          )}
                        </th>
                      ))}
                      <th className="px-4 py-2 font-medium">Totalt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.standings.map((s) => (
                      <tr key={s.playerId} className="border-t border-stone-100">
                        <td className="px-4 py-2 font-semibold text-stone-400">
                          {s.placering ?? "–"}
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            href={`/spelare/${s.playerId}`}
                            className="font-medium text-tdg-green hover:underline"
                          >
                            {s.playerName}
                          </Link>
                        </td>
                        {s.rounds.map((r, i) => (
                          <td key={i} className="px-4 py-2 text-stone-600">
                            {r ?? "–"}
                          </td>
                        ))}
                        <td className="px-4 py-2 font-semibold">{s.total ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-stone-400">
                Nettoslag registreras löpande i Betz &amp; Expz Resultat-ruta – lägst totalt
                nettoscore när alla 4 rundor är spelade avgör vinnaren.
              </p>
            </div>
          )}
        </div>
      );
    }
    return notFound();
  }

  const availableSections = SECTION_ORDER.filter((key) => edition.sections[key]);
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

      {availableSections.map((key) => {
        const section = edition.sections[key]!;
        return (
          <div key={key} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              {SECTION_LABELS[key]}
              {key === "nettoslag" && (
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
                        <div>R{i + 1}</div>
                        {c && <div className="text-xs font-normal text-stone-400">{c}</div>}
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
