import Link from "next/link";
import { editions, getWinner, getSegerrekord, getPlayerByNickname } from "@/lib/data";

export default function Home() {
  const latest = editions[editions.length - 1];
  const winner = editions[editions.length - 1] ? getWinner(latest) : undefined;
  const winnerPlayer = winner ? getPlayerByNickname(winner.name) : undefined;
  const segerrekord = getSegerrekord().slice(0, 3);

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

      <section className="rounded-xl bg-tdg-green-dark p-6">
        <h2 className="text-lg font-semibold text-white">Flest segrar genom tiderna</h2>
        <ol className="mt-4 flex flex-col gap-2">
          {segerrekord.map((s, i) => (
            <li key={s.player.id} className="flex items-center justify-between text-sm">
              <Link
                href={`/spelare/${s.player.id}`}
                className="font-medium text-tdg-yellow hover:underline"
              >
                {i + 1}. {s.player.fullName}
              </Link>
              <span className="text-white/85">{s.segrar} segrar</span>
            </li>
          ))}
        </ol>
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
