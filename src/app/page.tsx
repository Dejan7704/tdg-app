import Link from "next/link";
import Image from "next/image";
import { editions, getWinner, getPlayerByNickname, getPlayer } from "@/lib/data";
import { getProjectedWinnerForNextSeason } from "@/lib/prognosis";
import { getLiveBokslut, getSupabaseSeasonStats } from "@/lib/liveBokslut";
import { getSeasonPhase } from "@/lib/seasonPhase";
import { InfoTooltip } from "@/components/InfoTooltip";

// force-dynamic sedan 2026-09-23 (tidigare statisk sida) - "Projected
// winner"-prognosen ska räknas om från Supabase varje sidladdning, så den
// automatiskt hoppar fram ett år så fort "Bokslut <år>"-knappen tryckts på
// Betz & Expz-sidan, se getProjectedWinnerForNextSeason i prognosis.ts.
export const dynamic = "force-dynamic";

export default async function Home() {
  // "Regerande mästare" - senaste AVSLUTADE upplagan. Fram till 2026-10-02
  // kom den alltid från den statiska arkivfilen editions.json (t.o.m. 2025),
  // så sidan fortsatte visa föregående års mästare efter att "Bokslut
  // <år>"-knappen tryckts på Betz & Expz - en ny Supabase-säsong migreras
  // aldrig automatiskt till editions.json (se liveBokslut.ts), den blir bara
  // `status: "closed"` på edition-raden. David upptäckte detta 2026-10-02
  // ("Regerande mästare för 2026 inte uppdaterats, står fortfarande 2025 års
  // vinnare"). Samma mönster som Historik-sidans closedSupabaseYears: om den
  // senaste avslutade Supabase-säsongen är nyare än den senaste statiska
  // editions.json-posten, hämta vinnaren (placering 1) därifrån istället.
  const supabaseSeasonStats = await getSupabaseSeasonStats();
  const latestClosedSupabaseSeason = supabaseSeasonStats
    .filter((s) => s.status === "closed" && !editions.some((e) => e.year === s.year))
    .sort((a, b) => b.year - a.year)[0];
  const latestStaticEdition = editions.length > 0 ? editions[editions.length - 1] : undefined;

  let latestYear: number | undefined;
  let winner: { name: string } | undefined;
  let winnerPlayer: ReturnType<typeof getPlayer>;

  if (
    latestClosedSupabaseSeason &&
    (!latestStaticEdition || latestClosedSupabaseSeason.year > latestStaticEdition.year)
  ) {
    latestYear = latestClosedSupabaseSeason.year;
    const winnerId = Object.entries(latestClosedSupabaseSeason.players).find(
      ([, p]) => p.placering === 1
    )?.[0];
    winnerPlayer = winnerId ? getPlayer(winnerId) : undefined;
    winner = winnerPlayer ? { name: winnerPlayer.nicknames[0] ?? winnerPlayer.fullName } : undefined;
  } else if (latestStaticEdition) {
    latestYear = latestStaticEdition.year;
    winner = getWinner(latestStaticEdition);
    winnerPlayer = winner ? getPlayerByNickname(winner.name) : undefined;
  }

  // Datumspärr för nästa säsongs prognos (David 2026-10-02, se
  // seasonPhase.ts) - "Projected winner {år}" ska inte dyka upp samma dag
  // som "Bokslut {år-1}" trycks. Den öppna editionens egna år+land avgör
  // fasen: "locked" (innan 1 mars) visar inget alls om nästa säsong,
  // "upcoming" (1 mars+, Upplaga ej sparad) visar fältet men med en
  // platshållartext istället för ett namn, "active" (Upplaga sparad) visar
  // den riktiga, uträknade prognosen precis som innan.
  const openLive = await getLiveBokslut();
  const nextSeasonPhase = openLive ? getSeasonPhase(openLive.year, openLive.country) : null;
  const projected =
    nextSeasonPhase === "active" ? await getProjectedWinnerForNextSeason() : null;

  return (
    <div className="flex flex-col gap-8">
      {/* -mt-16 drar upp rutan så headerns stora logga (som hänger ned över
          innehållet) medvetet får täcka det gröna hörnet uppe till vänster -
          önskat av David, se layout.tsx. Bara så mycket att det är det
          rundade hörnet som täcks, inte rubriktexten. */}
      <section className="-mt-16 rounded-xl bg-tdg-green-dark px-6 py-8 text-white sm:mt-0">
        <h1 className="text-3xl font-bold">Välkommen till Tour De Gölf</h1>
        <p className="mt-2 max-w-2xl text-white/85">
          Här hittar du allt som är värt att veta om TDG. Rond för rond sedan starten.
          Vem som vunnit vad, på golfbanan och i pokerrummet. Alla utlägg samt
          avräkningar oss emellan.
        </p>
        {winner && (
          <p className="mt-4 text-white/85">
            <span className="font-medium text-white">🏆 Regerande mästare:</span>{" "}
            {winnerPlayer ? (
              <Link
                href={`/spelare/${winnerPlayer.id}`}
                className="font-semibold text-tdg-yellow hover:underline"
              >
                {winnerPlayer.fullName}
              </Link>
            ) : (
              <span className="font-semibold text-white">{winner.name}</span>
            )}{" "}
            ({winner.name}, {latestYear})
          </p>
        )}
        {/* "Projected winner" - lekfull prognos inför nästa upplaga, tillagd
            2026-09-19 på Davids begäran. Bara favoriten visas direkt i
            rutan (inte hela topplistan) - metodiken och favoritens
            nyckelsiffror förklaras i en (i)-tooltip istället för att lassa på
            texten i själva raden. Logik i src/lib/prognosis.ts.

            Datumspärr tillagd 2026-10-02 (se seasonPhase.ts): raden visas
            inte alls förrän 1 mars nästa säsongs år ("locked"), och visar en
            platshållartext istället för ett namn tills Upplaga-rutan sparats
            på Betz & Expz ("upcoming") - annars pekades en favorit ut långt
            innan nästa års TDG ens är planerad. */}
        {nextSeasonPhase && nextSeasonPhase !== "locked" && (
          <p className="mt-1 text-white/85">
            <span className="font-medium text-white">
              🔮 Projected winner {openLive!.year}:
            </span>{" "}
            {projected ? (
              <>
                <Link
                  href={`/spelare/${projected.entry.player.id}`}
                  className="font-semibold text-tdg-yellow hover:underline"
                >
                  {projected.entry.player.fullName}
                </Link>
                <InfoTooltip text={projected.explanation} label="Så räknas prognosen ut" />
              </>
            ) : (
              <span className="italic text-white/70">
                Beräknas när Land + deltagare är klart
              </span>
            )}
          </p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NavCard href="/historik" title="Historik" desc="Översikt alla golfrundor" />
        <NavCard href="/spelare" title="Spelare" desc="All data per spelare" />
        <NavCard
          href="/betting-business"
          title="Bokslut"
          desc="Prisvinster, betting, utlägg & avräkningar"
        />
        <NavCard
          href="/utlagg"
          title="Betting & Expenzes"
          desc="Registrering vinster, betting & utlägg"
        />
      </section>

      {/* Vänner-bilden ersatte "Flest segrar genom tiderna"-rutan här
          2026-09-23, på Davids begäran - ren bild, ingen egen ruta/bakgrund
          eftersom bilden (filmremsa-collage) redan har sin egen skugga. */}
      <section className="flex justify-center">
        <Image
          src="/photos/vanner-filmremsa.png"
          alt="Filmremsa med bilder på TDG-vänner"
          width={1681}
          height={936}
          className="h-auto w-full max-w-2xl"
        />
      </section>

      {/* "In partnership with"-sektion, tillagd 2026-09-20 på Davids begäran,
          innan Betz & Expz kopplas mot riktig databas. */}
      <section className="flex flex-col items-center gap-3 py-2">
        <p className="text-sm text-stone-500">In partnership with</p>
        <Image
          src="/brand/partner-nest-capital.png"
          alt="Nest Capital Fund III KY"
          width={321}
          height={74}
          className="h-auto w-auto max-w-[220px]"
        />
      </section>
    </div>
  );
}

function NavCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl bg-tdg-gray-light p-5 transition hover:shadow-sm"
    >
      <h3 className="font-semibold text-tdg-green">{title}</h3>
      <p className="mt-1 text-sm text-stone-600">{desc}</p>
    </Link>
  );
}
