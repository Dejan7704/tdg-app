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

// Vilket år Betz & Expz-sidan börjar på (David bekräftat 2026-09-19) - sidan
// byggdes "från och med 2026", och ingen säsong har stängts än.
const SEASON_START_YEAR = 2026;

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
// Sweepstakens automatiska utbetalning (se computeAutoEntries nedan).
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

// En avslutad säsongs alla rådata - det som arkiveras när man trycker
// "Bokslut <år>" (se avsnittet om säsongsbyte längre ner). Samma råformer
// som det löpande state:t (entries/sweepstakeBets/roundResults), så samma
// beräkningsfunktioner (computeAutoEntries m.fl.) kan återanvändas för att
// visa upp ett arkiverat år precis som det såg ut när det stängdes.
type SeasonSnapshot = {
  year: number;
  entries: Entry[];
  sweepstakeBets: SweepstakeBet[];
  roundResults: Record<number, RoundResult>;
};

function formatSek(n: number): string {
  const rounded = Math.round(n);
  return (rounded > 0 ? "+" : "") + rounded.toLocaleString("sv-SE") + " kr";
}

function playerName(id: string): string {
  return players.find((p) => p.id === id)?.fullName ?? id;
}

// Automatiskt framräknade poster - golfbetting-vinster (en per kategori som
// fått en vinnare i Resultat-rutan) och sweepstake-utbetalningar (löst mot
// samma facit). Ren funktion av roundResults+sweepstakeBets (ingen egen
// state) så den kan användas både för den pågående säsongen (i en useMemo
// nedan) och för att rendera ett arkiverat års ögonblicksbild oförändrad.
//
// Sweepstaken rullar vidare (David 2026-09-19): gissar ingen rätt på en
// avgjord runda betalas potten inte ut - den läggs istället ovanpå nästa
// rundas pott för SAMMA kategori. Därför måste rundorna gås igenom i
// ordning 1->4 per kategori (inte i den ordning de råkar registrerats) med
// en löpande `carry`-summa. En runda utan registrerat facit än (ingen
// vinnare satt för kategorin) varken betalar ut eller rullar vidare - dess
// insatser väntar orörda tills rundan avgörs.
function computeAutoEntries(
  roundResults: Record<number, RoundResult>,
  sweepstakeBets: SweepstakeBet[]
): Entry[] {
  const out: Entry[] = [];
  let syntheticId = -1;

  for (const kategori of RESULT_CATEGORIES) {
    let carry = 0;
    for (let runda = 1; runda <= 4; runda++) {
      const result = roundResults[runda];
      const winnerId = result?.winners[kategori];
      if (!winnerId) continue; // inte avgjort än - rör varken utbetalning eller carry

      // Golfbetting-vinst - schablonbeloppet (700 kr), samma som tidigare
      // manuella standardvärde.
      out.push({
        id: syntheticId--,
        timestamp: 0,
        playerName: playerName(winnerId),
        huvudkategori: "Golfbetting",
        detalj: `Vinst – Runda ${runda}, ${CATEGORY_LABELS[kategori]}`,
        kategori: CATEGORY_LABELS[kategori],
        belopp: GOLF_VINST_DEFAULT,
        auto: true,
      });

      // Sweepstake: potten = den här rundans insatser + allt som ev.
      // rullat med från tidigare rundor som ingen gissade rätt på.
      const betsR = sweepstakeBets.filter((b) => b.runda === runda && b.kategori === kategori);
      const pot = betsR.reduce((sum, b) => sum + b.belopp, 0) + carry;
      if (pot === 0) continue; // varken nya insatser eller något att rulla vidare

      const winners = betsR.filter((b) => b.gissningId === winnerId);
      if (winners.length === 0) {
        // Ingen gissade rätt - hela potten (inkl. ev. tidigare rullning)
        // rullar vidare till nästa runda i samma kategori. Sista rundan
        // (4) har ingen "nästa" att rulla till - potten blir stående
        // outbetald, flaggas inte särskilt i UI:t idag.
        carry = pot;
        continue;
      }

      const rolledIn = carry;
      carry = 0;
      const payoutEach = pot / winners.length;
      for (const w of winners) {
        out.push({
          id: syntheticId--,
          timestamp: 0,
          playerName: playerName(w.bettorId),
          huvudkategori: "Sweepstake",
          detalj: `Vinst – Runda ${runda}, ${CATEGORY_LABELS[kategori]} (gissade ${playerName(
            winnerId
          )}${winners.length > 1 ? `, delad mellan ${winners.length}` : ""}${
            rolledIn > 0 ? `, varav ${formatSek(rolledIn).replace("+", "")} rullat från tidigare runda` : ""
          })`,
          kategori: CATEGORY_LABELS[kategori],
          belopp: payoutEach,
          auto: true,
        });
      }
    }
  }
  return out;
}

// Sweepstake-insatserna visas också i tabellen (manuellt registrerade, till
// skillnad från vinsterna ovan som räknas fram) - egen funktion av samma
// anledning som computeAutoEntries.
function computeSweepstakeInsatsEntries(sweepstakeBets: SweepstakeBet[]): Entry[] {
  return sweepstakeBets.map((b) => ({
    id: 1_000_000 + b.id, // eget nummerspann så det aldrig krockar med manuella/auto-id:n
    timestamp: 0,
    playerName: playerName(b.bettorId),
    huvudkategori: "Sweepstake" as const,
    detalj: `Insats – Runda ${b.runda}, ${CATEGORY_LABELS[b.kategori]} (gissar ${playerName(
      b.gissningId
    )})`,
    kategori: CATEGORY_LABELS[b.kategori],
    belopp: -b.belopp,
  }));
}

// Slår ihop manuella poster + de två automatiskt framräknade grupperna ovan
// till en enda, sorterad lista - samma logik oavsett om det gäller den
// pågående säsongen eller ett arkiverat års ögonblicksbild.
function buildAllEntries(
  entries: Entry[],
  sweepstakeBets: SweepstakeBet[],
  roundResults: Record<number, RoundResult>
): Entry[] {
  const autoEntries = computeAutoEntries(roundResults, sweepstakeBets);
  const sweepstakeInsatsEntries = computeSweepstakeInsatsEntries(sweepstakeBets);
  return [...entries, ...sweepstakeInsatsEntries, ...autoEntries].sort((a, b) => {
    // Manuella poster (har ett riktigt timestamp) sorteras nyast-först;
    // automatiska poster (timestamp 0) samlas sist i listan, i den
    // ordning de räknades fram (rond/kategori).
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return 0;
  });
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

// Den delade poster-tabellen - används både för den pågående säsongens
// löpande lista och för att visa upp ett arkiverat års ögonblicksbild
// (read-only i praktiken i båda fallen, arkivvyn har bara inga formulär
// ovanför sig att lägga till fler poster ifrån).
function EntriesTable({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl bg-tdg-gray-light p-6 text-sm text-stone-500">
        Inga poster registrerade.
      </p>
    );
  }
  return (
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
          {entries.map((e) => (
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

  // --- Säsong: pågående år + arkiv över avslutade år (David bad om detta
  // 2026-09-19, eftersom sidan ska återanvändas år efter år) ---
  // Sidan rensas och blir "öppen" för nästa år så fort man trycker
  // "Bokslut <år>" och bekräftar - årets rådata (entries/sweepstakeBets/
  // roundResults) sparas orörda i `archive` så de kan bläddras fram igen,
  // precis som de såg ut vid stängningen. Rent React-state fortfarande (ingen
  // databas ännu) - archive-listan försvinner vid en sidomladdning precis
  // som allt annat på sidan gör idag.
  const [activeYear, setActiveYear] = useState(SEASON_START_YEAR);
  const [archive, setArchive] = useState<SeasonSnapshot[]>([]);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [viewingArchiveYear, setViewingArchiveYear] = useState<number | null>(null);

  function closeSeason() {
    setArchive((prev) => [{ year: activeYear, entries, sweepstakeBets, roundResults }, ...prev]);
    setEntries([]);
    setNextId(1);
    setSweepstakeBets([]);
    setNextBetId(1);
    setRoundResults({});
    setResultRunda(1);
    setResultNetto({});
    setResultWinners({});
    setActiveYear((y) => y + 1);
    setConfirmingClose(false);
  }

  const autoEntries = useMemo(
    () => computeAutoEntries(roundResults, sweepstakeBets),
    [roundResults, sweepstakeBets]
  );
  const sweepstakeInsatsEntries = useMemo(
    () => computeSweepstakeInsatsEntries(sweepstakeBets),
    [sweepstakeBets]
  );
  const allEntries = useMemo(
    () =>
      [...entries, ...sweepstakeInsatsEntries, ...autoEntries].sort((a, b) => {
        if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
        return 0;
      }),
    [entries, sweepstakeInsatsEntries, autoEntries]
  );

  const viewingSnapshot = archive.find((s) => s.year === viewingArchiveYear) ?? null;
  const archivedEntries = useMemo(
    () =>
      viewingSnapshot
        ? buildAllEntries(viewingSnapshot.entries, viewingSnapshot.sweepstakeBets, viewingSnapshot.roundResults)
        : [],
    [viewingSnapshot]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Betz & Expz</h1>
        <p className="mt-1 max-w-2xl text-stone-500">
          Registrera utlägg och betting löpande under årets resa. Insatser registreras som
          negativa poster, vinster och utlägg som positiva. Golfbetting-vinster och
          Sweepstake-utbetalningar räknas fram automatiskt så fort ett rondresultat registrerats
          nedan.
        </p>
      </div>

      {/* Säsongsindikator - visar vilket års tävling formulären nedanför
          gäller just nu, och knappen som avslutar/arkiverar den. */}
      <div className="flex flex-col gap-3 rounded-xl bg-tdg-green-dark p-4 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-white/70">
            Pågående säsong
          </span>
          <p className="mt-0.5 text-lg font-bold">
            TDG {activeYear} <span className="font-normal text-white/80">– Öppen</span>
          </p>
        </div>
        {!confirmingClose ? (
          <button
            type="button"
            onClick={() => setConfirmingClose(true)}
            className="self-start rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25 sm:self-auto"
          >
            Bokslut {activeYear}
          </button>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg bg-white/10 p-3 sm:max-w-sm">
            <p className="text-sm text-white/90">
              Säker på att avsluta TDG {activeYear}? Alla registrerade poster arkiveras och sidan
              rensas för TDG {activeYear + 1}.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeSeason}
                className="rounded-lg bg-tdg-yellow px-3 py-1.5 text-sm font-semibold text-tdg-green-dark transition hover:opacity-90"
              >
                Ja, avsluta TDG {activeYear}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className="rounded-lg border border-white/40 px-3 py-1.5 text-sm text-white transition hover:bg-white/10"
              >
                Avbryt
              </button>
            </div>
          </div>
        )}
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
          <EntriesTable entries={allEntries} />
        )}
      </section>

      {/* Arkiverade säsonger - byggs upp allteftersom man trycker
          "Bokslut <år>" ovan. Read-only vy av ett tidigare års alla poster,
          exakt som de såg ut vid stängningen. */}
      {archive.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Arkiverade säsonger
          </h2>
          <div className="flex flex-wrap gap-2">
            {archive.map((s) => (
              <button
                key={s.year}
                type="button"
                onClick={() => setViewingArchiveYear((y) => (y === s.year ? null : s.year))}
                className={
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition " +
                  (viewingArchiveYear === s.year
                    ? "bg-tdg-green-dark text-white"
                    : "bg-tdg-gray-light text-stone-600 hover:text-tdg-green")
                }
              >
                TDG {s.year}
              </button>
            ))}
          </div>
          {viewingSnapshot && (
            <div className="mt-1">
              <p className="mb-2 text-xs text-stone-500">
                {archivedEntries.length} poster registrerade för TDG {viewingSnapshot.year}.
              </p>
              <EntriesTable entries={archivedEntries} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
