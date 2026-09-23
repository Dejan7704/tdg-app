import Link from "next/link";
import Image from "next/image";
import { editions, getWinner, getPlayerByNickname } from "@/lib/data";
import { getProjectedWinnerForNextSeason } from "@/lib/prognosis";
import { InfoTooltip } from "@/components/InfoTooltip";

// force-dynamic sedan 2026-09-23 (tidigare statisk sida) - "Projected
// winner"-prognosen ska räknas om från Supabase varje sidladdning, så den
// automatiskt hoppar fram ett år så fort "Bokslut <år>"-knappen tryckts på
// Betz & Expz-sidan, se getProjectedWinnerForNextSeason i prognosis.ts.
export const dynamic = "force-dynamic";

export default async function Home() {
  const latest = editions[editions.length - 1];
  const winner = editions[editions.length - 1] ? getWinner(latest) : undefined;
  const winnerPlayer = winner ? getPlayerByNickname(winner.name) : undefined;
  const projected = await getProjectedWinnerForNextSeason();

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
            ({winner.name}, {latest.year})
          </p>
        )}
        {/* "Projected winner" - lekfull prognos inför nästa upplaga, tillagd
            2026-09-19 på Davids begäran. Bara favoriten visas direkt i
            rutan (inte hela topplistan) - metodiken och favoritens
            nyckelsiffror förklaras i en (i)-tooltip istället för att lassa på
            texten i själva raden. Logik i src/lib/prognosis.ts. */}
        <p className="mt-1 text-white/85">
          <span className="font-medium text-white">🔮 Projected winner {projected.year}:</span>{" "}
          <Link
            href={`/spelare/${projected.entry.player.id}`}
            className="font-semibold text-tdg-yellow hover:underline"
          >
            {projected.entry.player.fullName}
          </Link>
          <InfoTooltip text={projected.explanation} label="Så räknas prognosen ut" />
        </p>
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
