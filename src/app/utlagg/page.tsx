"use client";

import { useMemo, useState } from "react";
import { players } from "@/lib/data";
import { CATEGORY_LABELS, CATEGORY_ORDER, type BettingCategory } from "@/lib/business";

// Standardbelopp för golfbetting, hämtade från samma logik/summor som i 2025
// års utfall (se business-2025.json): insatsen är en fast årlig summa per
// spelare (2 000 kr). Vinstbeloppet (700 kr) är inte längre något man
// registrerar manuellt (se nedan) - det används bara som standardsumman för
// de vinster som räknas fram automatiskt från Resultat-rutan.
const GOLF_INSATS_DEFAULT = 2000;
const GOLF_VINST_DEFAULT = 700;

const UTLAGG_KATEGORIER = ["Mat", "Dryck", "Hyrbil", "Övrigt"] as const;
type UtlaggKategori = (typeof UTLAGG_KATEGORIER)[number];

// De fem golfbetting-kategorierna som faktiskt avgörs av ett rondresultat -
// "sweepstake" räknas inte hit, det är ett separat sidospel som i sin tur
// GISSAR på en av de här fem (se Sweepstake-rutan längre ner).
const RESULT_CATEGORIES = CATEGORY_ORDER.filter((c) => c !== "sweepstake") as Exclude<
  BettingCategory,
  "sweepstake"
>[];

type Entry = {
  id: number;
  timestamp: number;
  playerName: string;
  huvudkategori: "Golfbetting" | "Pokerbetting" | "Utlägg" | "Sweepstake";
  detalj: string;
  kategori?: string;
  belopp: number;
  /** Skiljer poster spelarna faktiskt knappat in från poster appen räknat fram själv (golfbetting-vinster + sweepstake-utbetalningar, se Resultat-rutan). Rent visuellt i tabellen - påverkar inte beloppen. */
  auto?: boolean;
};

// Ett rondresultat - "facit" för en runda (1-4). Fylls i via Resultat-rutan
// och är källan till both de automatiska golfbetting-vinsterna OCH
// Sweepstakens automatiska utbetalning (se useMemo-blocket i komponenten).
type RoundResult = {
  runda: number;
  /** Nettoscore per spelare - nyckel är player.id. Rent informativt i det här steget (visas i tabellen), påverkar inga beräkningar ännu. */
  netto: Record<string, number | undefined>;
  /** Vinnaren (player.id) per kategori för just den här rundan - tomt/undefined tills det är avgjort. */
  winners: Partial<Record<Exclude<BettingCategory, "sweepstake">, string>>;
};

type SweepstakeBet = {
  id: number;
  bettorId: string;
  runda: number;
  kategori: Exclude<BettingCategory, "sweepstake">;
  gissningId: string;
  belopp: number;
};

function formatSek(n: number): string {
  const rounded = Math.round(n);
  return (rounded > 0 ? "+" : "") + rounded.toLocaleString("sv-SE") + " kr";
}

function playerName(id: string): string {
  return players.find((p) => p.id === id)?.fullName ?? id;
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-stone-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 focus:border-tdg-green focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function AmountField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-stone-600">{label}</span>
      <input
        type="number"
        value={value === 0 && placeholder ? "" : value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 focus:border-tdg-green focus:outline-none"
      />
    </label>
  );
}

export default function UtlaggPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextId, setNextId] = useState(1);

  function addEntry(entry: Omit<Entry, "id" | "timestamp">) {
    setEntries((prev) => [{ ...entry, id: nextId, timestamp: Date.now() }, ...prev]);
    setNextId((n) => n + 1);
  }

  // --- Golfbetting (bara insats - vinster räknas fram automatiskt, se Resultat-rutan) ---
  const [golfSpelare, setGolfSpelare] = useState(players[0]?.id ?? "");
  const [golfBelopp, setGolfBelopp] = useState(GOLF_INSATS_DEFAULT);

  function registerGolfInsats() {
    const player = players.find((p) => p.id === golfSpelare);
    if (!player) return;
    addEntry({
      playerName: player.fullName,
      huvudkategori: "Golfbetting",
      detalj: "Insats",
      belopp: -Math.abs(golfBelopp),
    });
  }

  // --- Pokerbetting ---
  const [pokerSpelare, setPokerSpelare] = useState(players[0]?.id ?? "");
  const [pokerTyp, setPokerTyp] = useState<"insats" | "vinst">("vinst");
  const [pokerBelopp, setPokerBelopp] = useState(0);

  function registerPoker() {
    const player = players.find((p) => p.id === pokerSpelare);
    if (!player) return;
    const belopp = pokerTyp === "insats" ? -Math.abs(pokerBelopp) : Math.abs(pokerBelopp);
    const detalj = pokerTyp === "insats" ? "Insats" : "Vinst";
    addEntry({ playerName: player.fullName, huvudkategori: "Pokerbetting", detalj, belopp });
  }

  // --- Utlägg ---
  const [utlaggSpelare, setUtlaggSpelare] = useState(players[0]?.id ?? "");
  const [utlaggKategori, setUtlaggKategori] = useState<UtlaggKategori>("Mat");
  const [utlaggBelopp, setUtlaggBelopp] = useState(0);

  function registerUtlagg() {
    const player = players.find((p) => p.id === utlaggSpelare);
    if (!player) return;
    addEntry({
      playerName: player.fullName,
      huvudkategori: "Utlägg",
      detalj: utlaggKategori,
      kategori: utlaggKategori,
      belopp: Math.abs(utlaggBelopp),
    });
  }

  // --- Sweepstake (fri insats, ingen Vinst-knapp - utbetalningen räknas fram
  // automatiskt nedan när Resultat-rutans facit finns för samma runda+kategori) ---
  const [sweepstakeBets, setSweepstakeBets] = useState<SweepstakeBet[]>([]);
  const [nextBetId, setNextBetId] = useState(1);
  const [sweepBettor, setSweepBettor] = useState(players[0]?.id ?? "");
  const [sweepRunda, setSweepRunda] = useState(1);
  const [sweepKategori, setSweepKategori] = useState<Exclude<BettingCategory, "sweepstake">>(
    RESULT_CATEGORIES[0]
  );
  const [sweepGissning, setSweepGissning] = useState(players[0]?.id ?? "");
  const [sweepBelopp, setSweepBelopp] = useState(0);

  function registerSweepstake() {
    setSweepstakeBets((prev) => [
      ...prev,
      {
        id: nextBetId,
        bettorId: sweepBettor,
        runda: sweepRunda,
        kategori: sweepKategori,
        gissningId: sweepGissning,
        belopp: Math.abs(sweepBelopp),
      },
    ]);
    setNextBetId((n) => n + 1);
    setSweepBelopp(0);
  }

  // --- Resultat per golfrunda ("facit") ---
  const [roundResults, setRoundResults] = useState<Record<number, RoundResult>>({});
  const [resultRunda, setResultRunda] = useState(1);
  const [resultNetto, setResultNetto] = useState<Record<string, number | undefined>>({});
  const [resultWinners, setResultWinners] = useState<
    Partial<Record<Exclude<BettingCategory, "sweepstake">, string>>
  >({});

  // Byter man rondval i Resultat-rutan laddas ett redan registrerat facit för
  // den rundan in i formuläret igen (så man kan komplettera/rätta det),
  // annars börjar man om från ett tomt formulär för en ny runda.
  function selectResultRunda(runda: number) {
    setResultRunda(runda);
    const existing = roundResults[runda];
    setResultNetto(existing?.netto ?? {});
    setResultWinners(existing?.winners ?? {});
  }

  function registerRoundResult() {
    setRoundResults((prev) => ({
      ...prev,
      [resultRunda]: { runda: resultRunda, netto: resultNetto, winners: resultWinners },
    }));
  }

  // Automatiskt framräknade poster - golfbetting-vinster (en per kategori som
  // fått en vinnare i Resultat-rutan) och sweepstake-utbetalningar (löst mot
  // samma facit). Räknas om varje gång roundResults/sweepstakeBets ändras,
  // sparas aldrig som egna "riktiga" poster - så de aldrig kan bli inaktuella
  // eller dubbelräknade om ett rondresultat rättas i efterhand.
  const autoEntries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    let syntheticId = -1;

    for (const result of Object.values(roundResults)) {
      for (const kategori of RESULT_CATEGORIES) {
        const winnerId = result.winners[kategori];
        if (!winnerId) continue;

        // Golfbetting-vinst - schablonbeloppet (700 kr), samma som tidigare
        // manuella standardvärde.
        out.push({
          id: syntheticId--,
          timestamp: 0,
          playerName: playerName(winnerId),
          huvudkategori: "Golfbetting",
          detalj: `Vinst – Runda ${result.runda}, ${CATEGORY_LABELS[kategori]}`,
          kategori: CATEGORY_LABELS[kategori],
          belopp: GOLF_VINST_DEFAULT,
          auto: true,
        });

        // Sweepstake-utbetalning: potten = summan av ALLA insatser som
        // lagts på just den här rundan+kategorin (oavsett vem man gissade
        // på), delad jämnt mellan dem som gissade rätt. Gissade ingen rätt
        // rullar potten inte vidare i det här steget - den blir bara
        // outbetald (flaggas i UI:t).
        const bets = sweepstakeBets.filter(
          (b) => b.runda === result.runda && b.kategori === kategori
        );
        if (bets.length === 0) continue;
        const pot = bets.reduce((sum, b) => sum + b.belopp, 0);
        const winners = bets.filter((b) => b.gissningId === winnerId);
        if (winners.length === 0) continue;
        const payoutEach = pot / winners.length;
        for (const w of winners) {
          out.push({
            id: syntheticId--,
            timestamp: 0,
            playerName: playerName(w.bettorId),
            huvudkategori: "Sweepstake",
            detalj: `Vinst – Runda ${result.runda}, ${CATEGORY_LABELS[kategori]} (gissade ${playerName(
              winnerId
            )}${winners.length > 1 ? `, delad mellan ${winners.length}` : ""})`,
            kategori: CATEGORY_LABELS[kategori],
            belopp: payoutEach,
            auto: true,
          });
        }
      }
    }
    return out;
  }, [roundResults, sweepstakeBets]);

  // Sweepstake-insatserna visas också i tabellen (manuellt registrerade,
  // till skillnad från vinsterna ovan som räknas fram).
  const sweepstakeInsatsEntries = useMemo<Entry[]>(
    () =>
      sweepstakeBets.map((b) => ({
        id: 1_000_000 + b.id, // eget nummerspann så det aldrig krockar med manuella/auto-id:n
        timestamp: 0,
        playerName: playerName(b.bettorId),
        huvudkategori: "Sweepstake" as const,
        detalj: `Insats – Runda ${b.runda}, ${CATEGORY_LABELS[b.kategori]} (gissar ${playerName(
          b.gissningId
        )})`,
        kategori: CATEGORY_LABELS[b.kategori],
        belopp: -b.belopp,
      })),
    [sweepstakeBets]
  );

  const allEntries = useMemo(
    () =>
      [...entries, ...sweepstakeInsatsEntries, ...autoEntries].sort((a, b) => {
        // Manuella poster (har ett riktigt timestamp) sorteras nyast-först;
        // automatiska poster (timestamp 0) samlas sist i listan, i den
        // ordning de räknades fram (rond/kategori).
        if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
        return 0;
      }),
    [entries, sweepstakeInsatsEntries, autoEntries]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Betz & Expz</h1>
        <p className="mt-1 max-w-2xl text-stone-500">
          Registrera utlägg och betting löpande under årets resa (från och med 2026). Insatser
          registreras som negativa poster, vinster och utlägg som positiva. Golfbetting-vinster
          och Sweepstake-utbetalningar räknas fram automatiskt så fort ett rondresultat
          registrerats nedan.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Golfbetting - bara insats */}
        <div className="flex flex-col gap-3 rounded-xl bg-tdg-gray-light p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">
            Golfbetting
          </h2>
          <p className="text-xs text-stone-500">
            Bara årets insats registreras här - vinster per kategori räknas fram automatiskt
            från Resultat-rutan längst ner.
          </p>
          <SelectField label="Spelare" value={golfSpelare} onChange={setGolfSpelare}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </SelectField>
          <AmountField label="Insats (kr)" value={golfBelopp} onChange={setGolfBelopp} />
          <button
            type="button"
            onClick={registerGolfInsats}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark"
          >
            Registrera insats
          </button>
        </div>

        {/* Pokerbetting */}
        <div className="flex flex-col gap-3 rounded-xl bg-tdg-gray-light p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">
            Pokerbetting
          </h2>
          <SelectField label="Spelare" value={pokerSpelare} onChange={setPokerSpelare}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </SelectField>
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => setPokerTyp("insats")}
              className={
                "flex-1 rounded-lg px-3 py-2 font-medium transition " +
                (pokerTyp === "insats"
                  ? "bg-tdg-green-dark text-white"
                  : "bg-white text-stone-600 hover:text-tdg-green")
              }
            >
              Insats
            </button>
            <button
              type="button"
              onClick={() => setPokerTyp("vinst")}
              className={
                "flex-1 rounded-lg px-3 py-2 font-medium transition " +
                (pokerTyp === "vinst"
                  ? "bg-tdg-green-dark text-white"
                  : "bg-white text-stone-600 hover:text-tdg-green")
              }
            >
              Vinst
            </button>
          </div>
          <AmountField label="Belopp (kr)" value={pokerBelopp} onChange={setPokerBelopp} />
          <button
            type="button"
            onClick={registerPoker}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark"
          >
            Registrera
          </button>
        </div>

        {/* Utlägg */}
        <div className="flex flex-col gap-3 rounded-xl bg-tdg-gray-light p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">Utlägg</h2>
          <SelectField label="Spelare" value={utlaggSpelare} onChange={setUtlaggSpelare}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Kategori"
            value={utlaggKategori}
            onChange={(v) => setUtlaggKategori(v as UtlaggKategori)}
          >
            {UTLAGG_KATEGORIER.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </SelectField>
          <AmountField label="Belopp (kr)" value={utlaggBelopp} onChange={setUtlaggBelopp} />
          <button
            type="button"
            onClick={registerUtlagg}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark"
          >
            Registrera
          </button>
        </div>

        {/* Sweepstake - fri insats, ingen Vinst-knapp */}
        <div className="flex flex-col gap-3 rounded-xl bg-tdg-gray-light p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">
            Sweepstake
          </h2>
          <p className="text-xs text-stone-500">
            Valfritt sidospel, oberoende av golfbettingens insats. Gissa vem som vinner en
            kategori en given runda - vinnaren (eller de som gissat rätt, delat lika) tar hem
            hela potten automatiskt när rondresultatet registrerats.
          </p>
          <SelectField label="Vem satsar" value={sweepBettor} onChange={setSweepBettor}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Runda"
            value={String(sweepRunda)}
            onChange={(v) => setSweepRunda(Number(v))}
          >
            {[1, 2, 3, 4].map((r) => (
              <option key={r} value={r}>
                Runda {r}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Kategori"
            value={sweepKategori}
            onChange={(v) => setSweepKategori(v as Exclude<BettingCategory, "sweepstake">)}
          >
            {RESULT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Gissning - vem vinner" value={sweepGissning} onChange={setSweepGissning}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </SelectField>
          <AmountField
            label="Insats (kr)"
            value={sweepBelopp}
            onChange={setSweepBelopp}
            placeholder="Valfri summa"
          />
          <button
            type="button"
            onClick={registerSweepstake}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark"
          >
            Registrera satsning
          </button>
        </div>
      </div>

      {/* Resultat per golfrunda - facit som golfbetting-vinsterna och
          sweepstake-utbetalningarna ovan räknas fram från. Egen sektion
          (inte del av 3-kolumnsgridden) eftersom den rymmer mycket mer
          innehåll (alla 9 spelares nettoscore + 5 kategorivinnare) än de
          andra rutorna. */}
      <section className="rounded-xl bg-tdg-gray-light p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">
          Resultat per golfrunda
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          Facit för en runda - nettoscore för samtliga 9 spelare, plus vem som vann varje
          betting-kategori. Poängbogey (tävlingens officiella huvudresultat) registreras inte
          här, det hanteras separat som idag.
        </p>

        <div className="mt-3 max-w-xs">
          <SelectField
            label="Runda"
            value={String(resultRunda)}
            onChange={(v) => selectResultRunda(Number(v))}
          >
            {[1, 2, 3, 4].map((r) => (
              <option key={r} value={r}>
                Runda {r}
                {roundResults[r] ? " (registrerad)" : ""}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Nettoscore
            </h3>
            <div className="mt-2 flex flex-col gap-2">
              {players.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-stone-700">{p.fullName}</span>
                  <input
                    type="number"
                    value={resultNetto[p.id] ?? ""}
                    onChange={(e) =>
                      setResultNetto((prev) => ({
                        ...prev,
                        [p.id]: e.target.value === "" ? undefined : Number(e.target.value),
                      }))
                    }
                    placeholder="Netto"
                    className="w-24 rounded-lg border border-stone-200 bg-white px-2 py-1 text-right text-stone-900 focus:border-tdg-green focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Kategorivinnare
            </h3>
            <div className="mt-2 flex flex-col gap-2">
              {RESULT_CATEGORIES.map((c) => (
                <SelectField
                  key={c}
                  label={CATEGORY_LABELS[c]}
                  value={resultWinners[c] ?? ""}
                  onChange={(v) =>
                    setResultWinners((prev) => ({ ...prev, [c]: v === "" ? undefined : v }))
                  }
                >
                  <option value="">Inte avgjort</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </SelectField>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={registerRoundResult}
          className="mt-4 rounded-lg bg-tdg-green-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green"
        >
          {roundResults[resultRunda] ? "Uppdatera resultat" : "Registrera resultat"}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Registrerade poster {allEntries.length > 0 ? `(${allEntries.length})` : ""}
        </h2>
        {allEntries.length === 0 ? (
          <p className="rounded-xl bg-tdg-gray-light p-6 text-sm text-stone-500">
            Inga poster registrerade ännu. Använd formulären ovan för att komma igång.
          </p>
        ) : (
          <div className="overflow-x-auto overflow-hidden rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Spelare</th>
                  <th className="px-4 py-2 font-medium">Huvudkategori</th>
                  <th className="px-4 py-2 font-medium">Kategori</th>
                  <th className="px-4 py-2 text-right font-medium">Belopp</th>
                </tr>
              </thead>
              <tbody>
                {allEntries.map((e) => (
                  <tr key={e.id} className="border-t border-stone-100">
                    <td className="px-4 py-2 font-medium">{e.playerName}</td>
                    <td className="px-4 py-2 text-stone-600">
                      <span className="inline-flex items-center gap-1.5">
                        {e.huvudkategori}
                        {e.auto && (
                          <span
                            title="Beräknad automatiskt från Resultat-rutan"
                            className="rounded-full bg-tdg-gray-light px-1.5 py-0.5 text-[10px] font-semibold uppercase text-stone-500"
                          >
                            Auto
                          </span>
                        )}
                      </span>
                      <div className="text-xs text-stone-400">{e.detalj}</div>
                    </td>
                    <td className="px-4 py-2 text-stone-600">{e.kategori ?? "–"}</td>
                    <td
                      className={
                        "px-4 py-2 text-right font-semibold " +
                        (e.belopp >= 0 ? "text-tdg-green" : "text-red-600")
                      }
                    >
                      {formatSek(e.belopp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
