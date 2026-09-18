import Image from "next/image";
import Link from "next/link";
import { getPlayerWinYears, getRankedPlayers, playerInitials } from "@/lib/data";

export default function SpelarePage() {
  const ranked = getRankedPlayers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Spelare</h1>
        <p className="mt-1 max-w-2xl text-stone-500">
          Spelarna med alla smeknamn de haft genom åren. Rankade efter flest
          segrar, antal spelade upplagor och genomsnittliga placering.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ranked.map(({ player, segrar, upplagor }, i) => {
          const winYears = getPlayerWinYears(player.id);
          const nicks = player.nicknames;
          return (
            <Link
              key={player.id}
              href={`/spelare/${player.id}`}
              className="relative rounded-xl bg-tdg-gray-light p-5 transition hover:shadow-sm"
            >
              <span className="absolute right-4 top-4 text-lg font-bold text-stone-900">
                #{i + 1}
              </span>
              <div className="flex items-center gap-4">
                {player.photo ? (
                  <Image
                    src={player.photo}
                    alt={player.fullName}
                    width={64}
                    height={64}
                    className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white"
                  />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-lg font-semibold text-tdg-green ring-2 ring-white">
                    {playerInitials(player.fullName)}
                  </span>
                )}
                <div className="min-w-0">
                  <h3 className="font-semibold text-tdg-green">{player.fullName}</h3>
                  {nicks.length > 0 && (
                    <p className="mt-0.5 text-sm text-stone-500">{nicks.join(" / ")}</p>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm text-stone-600">{upplagor} upplagor</p>
              {segrar > 0 && (
                <p className="mt-1 text-sm font-medium text-stone-900">
                  🏆 {segrar} segrar
                  <span className="font-normal text-stone-500"> ({winYears.join(", ")})</span>
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
