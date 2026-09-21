"use client";

import { useEffect, useMemo, useState } from "react";
import { players } from "@/lib/data";
import { CATEGORY_LABELS, CATEGORY_ORDER, type BettingCategory } from "@/lib/business";
import {
  supabase,
  type EditionRow,
  type EntryRow,
  type RoundResultRow,
  type SweepstakeBetRow,
} from "@/lib/supabase";

// Standardbelopp för golfbetting, hämtade från samma logik/summor som i 2025
// års utfall (se business-2025.json): insatsen är en fast årlig summa per
// spelare (2 000 kr). Vinstbeloppet (700 kr) är inte längre något man
// registrerar manuellt (se nedan) - det används bara som standardsumman för
// de vinster som räknas fram automatiskt från Resultat-rutan.
const GOLF_INSATS_DEFAULT = 2000;
const GOLF_VINST_DEFAULT = 700;

// Vilket år Betz & Expz-sidan börjar på (David bekräftat 2026-09-19) - sidan
// byggdes "från och med 2026". Används bara om databasen mot förmodan saknar
// en öppen säsong helt (t.ex. ett helt tomt projekt) - i normalfallet finns
// alltid en öppen edition-rad (skapad av migrationen eller senaste Bokslut).
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

// --- UI-typer (oförändrade sedan innan databaskopplingen) - motsvarande
// databasrader mappas om till dessa vid inläsning, se map*()-funktionerna
// nedan, så att all beräkningslogik (computeAutoEntries m.fl.) kan vara
// exakt oförändrad. ---
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

type RoundResult = {
  runda: number;
  netto: Record<string, number | undefined>;
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

function mapEntryRow(row: EntryRow): Entry {
  return {
    id: row.id,
    timestamp: new Date(row.created_at).getTime(),
    playerName: row.player_name,
    huvudkategori: row.huvudkategori,
    detalj: row.detalj,
    kategori: row.kategori ?? undefined,
    belopp: row.belopp,
  };
}

function mapSweepstakeBetRow(row: SweepstakeBetRow): SweepstakeBet {
  return {
    id: row.id,
    bettorId: row.bettor_id,
    runda: row.runda,
    kategori: row.kategori as Exclude<BettingCategory, "sweepstake">,
    gissningId: row.gissning_id,
    belopp: row.belopp,
  };
}

function mapRoundResultRows(rows: RoundResultRow[]): Record<number, RoundResult> {
  const out: Record<number, RoundResult> = {};
  for (const row of rows) {
    out[row.runda] = { runda: row.runda, netto: row.netto, winners: row.winners };
  }
  return out;
}

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
// state) så den kan användas både för den pågående säsongen och för att
// rendera ett arkiverat års ögonblicksbild oförändrad.
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

      const betsR = sweepstakeBets.filter((b) => b.runda === runda && b.kategori === kategori);
      const pot = betsR.reduce((sum, b) => sum + b.belopp, 0) + carry;
      if (pot === 0) continue;

      const winners = betsR.filter((b) => b.gissningId === winnerId);
      if (winners.length === 0) {
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
        className={
          "rounded-lg border px-3 py-2 focus:border-tdg-green focus:outline-none " +
          (value === ""
            ? "border-stone-200 bg-stone-100 text-stone-400"
            : "border-stone-200 bg-white text-stone-900")
        }
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
  // --- Databaskoppling (Supabase) - laddas in vid sidladdning ---
  // `editions` = samtliga år (öppna + stängda), `activeEdition` = den med
  // status "open" (ska alltid finnas exakt en). Poster/satsningar/resultat
  // för den aktiva säsongen laddas in separat och hålls i eget state, precis
  // som tidigare - skillnaden är att alla ändringar nu även skrivs till
  // databasen (Supabase), inte bara till React-state.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sweepstakeBets, setSweepstakeBets] = useState<SweepstakeBet[]>([]);
  const [roundResults, setRoundResults] = useState<Record<number, RoundResult>>({});

  // Kort bekräftelse-toast som visas efter en lyckad registrering (David bad
  // om detta 2026-09-21 - annars syns inte att en post faktiskt sparats utan
  // att man rullar ner till "Registrerade poster" längst ner). Försvinner
  // automatiskt efter någon sekund.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  function showToast(message: string) {
    setToast(message);
  }

  const activeEdition = editions.find((e) => e.status === "open") ?? null;
  const activeYear = activeEdition?.year ?? SEASON_START_YEAR;

  // De spelare som faktiskt är med i den aktiva upplagan (David bad om detta
  // 2026-09-21) - styr rullistorna i formulären nedan så att den/de som inte
  // är med ett givet år inte behöver bläddras förbi. Redan registrerade
  // poster/facit påverkas inte om man ändrar valet i efterhand - playerName()
  // ovan slår fortfarande upp mot samtliga 9 spelare, så historik visas rätt.
  const nonParticipants = activeEdition?.non_participants ?? [];
  const activePlayers = useMemo(
    () => players.filter((p) => !nonParticipants.includes(p.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeEdition?.id, JSON.stringify(nonParticipants)]
  );

  async function toggleParticipant(playerId: string) {
    if (!activeEdition) return;
    const current = activeEdition.non_participants ?? [];
    const isCurrentlyOut = current.includes(playerId);
    const updated = isCurrentlyOut
      ? current.filter((id) => id !== playerId)
      : [...current, playerId];
    if (updated.length >= players.length) {
      alert("Minst en spelare måste vara med i tävlingen.");
      return;
    }
    const { data, error } = await supabase
      .from("editions")
      .update({ non_participants: updated })
      .eq("id", activeEdition.id)
      .select()
      .single();
    if (error) {
      console.error(error);
      alert("Kunde inte spara deltagarvalet - försök igen.");
      return;
    }
    const updatedEdition = data as EditionRow;
    setEditions((prev) => prev.map((e) => (e.id === updatedEdition.id ? updatedEdition : e)));
  }

  async function loadEditionData(editionId: number) {
    const [entriesRes, betsRes, resultsRes] = await Promise.all([
      supabase.from("entries").select("*").eq("edition_id", editionId),
      supabase.from("sweepstake_bets").select("*").eq("edition_id", editionId),
      supabase.from("round_results").select("*").eq("edition_id", editionId),
    ]);
    if (entriesRes.error) throw entriesRes.error;
    if (betsRes.error) throw betsRes.error;
    if (resultsRes.error) throw resultsRes.error;

    setEntries((entriesRes.data as EntryRow[]).map(mapEntryRow));
    setSweepstakeBets((betsRes.data as SweepstakeBetRow[]).map(mapSweepstakeBetRow));
    setRoundResults(mapRoundResultRows(resultsRes.data as RoundResultRow[]));
  }

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        setLoadError(null);
        const { data: editionRows, error } = await supabase
          .from("editions")
          .select("*")
          .order("year", { ascending: true });
        if (error) throw error;
        setEditions(editionRows as EditionRow[]);

        const open = (editionRows as EditionRow[]).find((e) => e.status === "open");
        if (open) {
          await loadEditionData(open.id);
        }
      } catch (err) {
        console.error(err);
        setLoadError(
          "Kunde inte läsa in data från databasen. Kontrollera internetuppkopplingen och ladda om sidan."
        );
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addEntry(entry: Omit<Entry, "id" | "timestamp">): Promise<boolean> {
    if (!activeEdition) return false;
    const { data, error } = await supabase
      .from("entries")
      .insert({
        edition_id: activeEdition.id,
        player_name: entry.playerName,
        huvudkategori: entry.huvudkategori,
        detalj: entry.detalj,
        kategori: entry.kategori ?? null,
        belopp: entry.belopp,
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      alert("Kunde inte spara posten - försök igen.");
      return false;
    }
    setEntries((prev) => [mapEntryRow(data as EntryRow), ...prev]);
    return true;
  }

  // --- Golfbetting (bara insats - vinster räknas fram automatiskt, se Resultat-rutan) ---
  const [golfSpelare, setGolfSpelare] = useState("");
  const [golfBelopp, setGolfBelopp] = useState(GOLF_INSATS_DEFAULT);
  const [golfSubmitting, setGolfSubmitting] = useState(false);

  async function registerGolfInsats() {
    const player = activePlayers.find((p) => p.id === golfSpelare);
    if (!player || golfSubmitting) return;
    setGolfSubmitting(true);
    const ok = await addEntry({
      playerName: player.fullName,
      huvudkategori: "Golfbetting",
      detalj: "Insats",
      belopp: -Math.abs(golfBelopp),
    });
    setGolfSubmitting(false);
    if (ok) {
      setGolfSpelare("");
      setGolfBelopp(GOLF_INSATS_DEFAULT);
      showToast(`Insats registrerad för ${player.fullName}`);
    }
  }

  // --- Pokerbetting ---
  const [pokerSpelare, setPokerSpelare] = useState("");
  const [pokerTyp, setPokerTyp] = useState<"insats" | "vinst">("vinst");
  const [pokerBelopp, setPokerBelopp] = useState(0);
  const [pokerSubmitting, setPokerSubmitting] = useState(false);

  async function registerPoker() {
    const player = activePlayers.find((p) => p.id === pokerSpelare);
    if (!player || pokerSubmitting) return;
    setPokerSubmitting(true);
    const belopp = pokerTyp === "insats" ? -Math.abs(pokerBelopp) : Math.abs(pokerBelopp);
    const detalj = pokerTyp === "insats" ? "Insats" : "Vinst";
    const ok = await addEntry({ playerName: player.fullName, huvudkategori: "Pokerbetting", detalj, belopp });
    setPokerSubmitting(false);
    if (ok) {
      setPokerSpelare("");
      setPokerTyp("vinst");
      setPokerBelopp(0);
      showToast(`${detalj} registrerad för ${player.fullName}`);
    }
  }

  // --- Utlägg ---
  const [utlaggSpelare, setUtlaggSpelare] = useState("");
  const [utlaggKategori, setUtlaggKategori] = useState<UtlaggKategori>("Mat");
  const [utlaggBelopp, setUtlaggBelopp] = useState(0);
  const [utlaggSubmitting, setUtlaggSubmitting] = useState(false);

  async function registerUtlagg() {
    const player = activePlayers.find((p) => p.id === utlaggSpelare);
    if (!player || utlaggSubmitting) return;
    setUtlaggSubmitting(true);
    const ok = await addEntry({
      playerName: player.fullName,
      huvudkategori: "Utlägg",
      detalj: utlaggKategori,
      kategori: utlaggKategori,
      belopp: Math.abs(utlaggBelopp),
    });
    setUtlaggSubmitting(false);
    if (ok) {
      setUtlaggSpelare("");
      setUtlaggKategori("Mat");
      setUtlaggBelopp(0);
      showToast(`Utlägg registrerat för ${player.fullName}`);
    }
  }

  // --- Sweepstake (fri insats, ingen Vinst-knapp - utbetalningen räknas fram
  // automatiskt nedan när Resultat-rutans facit finns för samma runda+kategori) ---
  const [sweepBettor, setSweepBettor] = useState("");
  const [sweepRunda, setSweepRunda] = useState(1);
  const [sweepKategori, setSweepKategori] = useState<Exclude<BettingCategory, "sweepstake">>(
    RESULT_CATEGORIES[0]
  );
  const [sweepGissning, setSweepGissning] = useState("");
  const [sweepBelopp, setSweepBelopp] = useState(0);
  const [sweepSubmitting, setSweepSubmitting] = useState(false);

  // Om någon av de valda spelarna i rullistorna ovan plockas bort ur årets
  // deltagarlista (se Deltagare-rutan), rensa valet istället för att lämna
  // kvar ett val som inte längre syns. Ett tomt val ("") rörs INTE här -
  // rullistorna startar medvetet tomma (David bad om detta 2026-09-21) så
  // att man alltid gör ett aktivt val, det ska inte fyllas i automatiskt.
  useEffect(() => {
    if (activePlayers.length === 0) return;
    const activeIds = new Set(activePlayers.map((p) => p.id));
    if (golfSpelare && !activeIds.has(golfSpelare)) setGolfSpelare("");
    if (pokerSpelare && !activeIds.has(pokerSpelare)) setPokerSpelare("");
    if (utlaggSpelare && !activeIds.has(utlaggSpelare)) setUtlaggSpelare("");
    if (sweepBettor && !activeIds.has(sweepBettor)) setSweepBettor("");
    if (sweepGissning && !activeIds.has(sweepGissning)) setSweepGissning("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlayers]);

  async function registerSweepstake() {
    if (!activeEdition || sweepSubmitting) return;
    setSweepSubmitting(true);
    const { data, error } = await supabase
      .from("sweepstake_bets")
      .insert({
        edition_id: activeEdition.id,
        bettor_id: sweepBettor,
        runda: sweepRunda,
        kategori: sweepKategori,
        gissning_id: sweepGissning,
        belopp: Math.abs(sweepBelopp),
      })
      .select()
      .single();
    setSweepSubmitting(false);
    if (error) {
      console.error(error);
      alert("Kunde inte spara satsningen - försök igen.");
      return;
    }
    setSweepstakeBets((prev) => [...prev, mapSweepstakeBetRow(data as SweepstakeBetRow)]);
    const bettorName = playerName(sweepBettor);
    setSweepBettor("");
    setSweepRunda(1);
    setSweepKategori(RESULT_CATEGORIES[0]);
    setSweepGissning("");
    setSweepBelopp(0);
    showToast(`Sweepstake-satsning registrerad för ${bettorName}`);
  }

  // --- Resultat per golfrunda ("facit") ---
  const [resultRunda, setResultRunda] = useState(1);
  const [resultNetto, setResultNetto] = useState<Record<string, number | undefined>>({});
  const [resultWinners, setResultWinners] = useState<
    Partial<Record<Exclude<BettingCategory, "sweepstake">, string>>
  >({});
  const [resultSubmitting, setResultSubmitting] = useState(false);

  // Byter man rondval i Resultat-rutan laddas ett redan registrerat facit för
  // den rundan in i formuläret igen (så man kan komplettera/rätta det),
  // annars börjar man om från ett tomt formulär för en ny runda.
  function selectResultRunda(runda: number) {
    setResultRunda(runda);
    const existing = roundResults[runda];
    setResultNetto(existing?.netto ?? {});
    setResultWinners(existing?.winners ?? {});
  }

  async function registerRoundResult() {
    if (!activeEdition || resultSubmitting) return;
    setResultSubmitting(true);
    const { data, error } = await supabase
      .from("round_results")
      .upsert(
        {
          edition_id: activeEdition.id,
          runda: resultRunda,
          netto: resultNetto,
          winners: resultWinners,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "edition_id,runda" }
      )
      .select()
      .single();
    setResultSubmitting(false);
    if (error) {
      console.error(error);
      alert("Kunde inte spara resultatet - försök igen.");
      return;
    }
    const row = data as RoundResultRow;
    setRoundResults((prev) => ({
      ...prev,
      [row.runda]: { runda: row.runda, netto: row.netto, winners: row.winners },
    }));
    showToast(`Resultat för Runda ${row.runda} sparat`);
  }

  // --- Säsong: pågående år + arkiv över avslutade år (David bad om detta
  // 2026-09-19, eftersom sidan ska återanvändas år efter år). Sedan
  // databaskopplingen (2026-09-21) motsvaras "Bokslut <år>" av att den
  // aktiva edition-raden markeras "closed" och en ny edition-rad skapas för
  // nästa år - se "Föreslagen datamodell" i projektdokumentet. ---
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closingInProgress, setClosingInProgress] = useState(false);
  const [viewingArchiveYear, setViewingArchiveYear] = useState<number | null>(null);
  const [archiveData, setArchiveData] = useState<
    Record<number, { entries: Entry[]; sweepstakeBets: SweepstakeBet[]; roundResults: Record<number, RoundResult> }>
  >({});
  const [archiveLoading, setArchiveLoading] = useState(false);

  const closedEditions = editions.filter((e) => e.status === "closed").sort((a, b) => b.year - a.year);

  async function closeSeason() {
    if (!activeEdition) return;
    setClosingInProgress(true);
    try {
      const { error: closeError } = await supabase
        .from("editions")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", activeEdition.id);
      if (closeError) throw closeError;

      const { data: newEdition, error: insertError } = await supabase
        .from("editions")
        .insert({ year: activeEdition.year + 1, status: "open" })
        .select()
        .single();
      if (insertError) throw insertError;

      setEditions((prev) => [
        ...prev.map((e) => (e.id === activeEdition.id ? { ...e, status: "closed" as const } : e)),
        newEdition as EditionRow,
      ]);
      setEntries([]);
      setSweepstakeBets([]);
      setRoundResults({});
      setResultRunda(1);
      setResultNetto({});
      setResultWinners({});
      setConfirmingClose(false);
    } catch (err) {
      console.error(err);
      alert("Kunde inte avsluta säsongen - försök igen.");
    } finally {
      setClosingInProgress(false);
    }
  }

  async function viewArchiveYear(edition: EditionRow) {
    if (viewingArchiveYear === edition.year) {
      setViewingArchiveYear(null);
      return;
    }
    setViewingArchiveYear(edition.year);
    if (archiveData[edition.id]) return; // redan inläst
    setArchiveLoading(true);
    try {
      const [entriesRes, betsRes, resultsRes] = await Promise.all([
        supabase.from("entries").select("*").eq("edition_id", edition.id),
        supabase.from("sweepstake_bets").select("*").eq("edition_id", edition.id),
        supabase.from("round_results").select("*").eq("edition_id", edition.id),
      ]);
      if (entriesRes.error) throw entriesRes.error;
      if (betsRes.error) throw betsRes.error;
      if (resultsRes.error) throw resultsRes.error;

      setArchiveData((prev) => ({
        ...prev,
        [edition.id]: {
          entries: (entriesRes.data as EntryRow[]).map(mapEntryRow),
          sweepstakeBets: (betsRes.data as SweepstakeBetRow[]).map(mapSweepstakeBetRow),
          roundResults: mapRoundResultRows(resultsRes.data as RoundResultRow[]),
        },
      }));
    } catch (err) {
      console.error(err);
      alert("Kunde inte läsa in det arkiverade året - försök igen.");
      setViewingArchiveYear(null);
    } finally {
      setArchiveLoading(false);
    }
  }

  const allEntries = useMemo(
    () => buildAllEntries(entries, sweepstakeBets, roundResults),
    [entries, sweepstakeBets, roundResults]
  );

  const viewingEdition = closedEditions.find((e) => e.year === viewingArchiveYear) ?? null;
  const viewingSnapshot = viewingEdition ? archiveData[viewingEdition.id] ?? null : null;
  const archivedEntries = useMemo(
    () =>
      viewingSnapshot
        ? buildAllEntries(viewingSnapshot.entries, viewingSnapshot.sweepstakeBets, viewingSnapshot.roundResults)
        : [],
    [viewingSnapshot]
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Betz & Expz</h1>
        </div>
        <p className="rounded-xl bg-tdg-gray-light p-6 text-sm text-stone-500">Laddar…</p>
      </div>
    );
  }

  if (loadError || !activeEdition) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Betz & Expz</h1>
        </div>
        <p className="rounded-xl bg-red-50 p-6 text-sm text-red-700">
          {loadError ?? "Ingen öppen säsong hittades i databasen."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Betz & Expz</h1>
        <p className="mt-1 max-w-2xl text-stone-500">
          Registrera utlägg och betting löpande under årets resa. Insatser registreras som
          negativa poster, vinster och utlägg som positiva. Golfbetting-vinster och
          Sweepstake-utbetalningar räknas fram automatiskt så fort ett rondresultat registrerats
          nedan. Allt sparas löpande i databasen och syns direkt för alla.
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
                disabled={closingInProgress}
                className="rounded-lg bg-tdg-yellow px-3 py-1.5 text-sm font-semibold text-tdg-green-dark transition hover:opacity-90 disabled:opacity-60"
              >
                {closingInProgress ? "Avslutar…" : `Ja, avsluta TDG ${activeYear}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                disabled={closingInProgress}
                className="rounded-lg border border-white/40 px-3 py-1.5 text-sm text-white transition hover:bg-white/10"
              >
                Avbryt
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Deltagare - vilka av de 9 spelarna som är med i årets upplaga (David
          bad om detta 2026-09-21). Bocka ur den/de som inte är med, så
          försvinner de från rullistorna i formulären nedan - man slipper då
          bläddra förbi dem varje gång. Redan registrerade poster/facit
          påverkas inte om man ändrar valet i efterhand. */}
      <section className="rounded-xl bg-tdg-gray-light p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">
          Deltagare TDG {activeYear}
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          Klicka på den/de som inte är med i år - de försvinner då från rullistorna nedan.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {players.map((p) => {
            const participating = !nonParticipants.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleParticipant(p.id)}
                className={
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition " +
                  (participating
                    ? "bg-tdg-green-dark text-tdg-yellow"
                    : "bg-white text-stone-400 hover:text-stone-600")
                }
              >
                {participating && (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 flex-shrink-0">
                    <path
                      fillRule="evenodd"
                      d="M16.704 5.29a1 1 0 010 1.415l-7.5 7.5a1 1 0 01-1.415 0l-3.5-3.5a1 1 0 111.415-1.415L8.5 12.086l6.79-6.79a1 1 0 011.415 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {p.fullName}
              </button>
            );
          })}
        </div>
      </section>

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
            <option value="">Välj spelare…</option>
            {activePlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </SelectField>
          <AmountField label="Insats (kr)" value={golfBelopp} onChange={setGolfBelopp} />
          <button
            type="button"
            onClick={registerGolfInsats}
            disabled={golfSubmitting || !golfSpelare}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark disabled:opacity-60"
          >
            {golfSubmitting ? "Registrerar…" : "Registrera insats"}
          </button>
        </div>

        {/* Pokerbetting */}
        <div className="flex flex-col gap-3 rounded-xl bg-tdg-gray-light p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">
            Pokerbetting
          </h2>
          <SelectField label="Spelare" value={pokerSpelare} onChange={setPokerSpelare}>
            <option value="">Välj spelare…</option>
            {activePlayers.map((p) => (
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
            disabled={pokerSubmitting || !pokerSpelare}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark disabled:opacity-60"
          >
            {pokerSubmitting ? "Registrerar…" : "Registrera"}
          </button>
        </div>

        {/* Utlägg */}
        <div className="flex flex-col gap-3 rounded-xl bg-tdg-gray-light p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">Utlägg</h2>
          <SelectField label="Spelare" value={utlaggSpelare} onChange={setUtlaggSpelare}>
            <option value="">Välj spelare…</option>
            {activePlayers.map((p) => (
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
            disabled={utlaggSubmitting || !utlaggSpelare}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark disabled:opacity-60"
          >
            {utlaggSubmitting ? "Registrerar…" : "Registrera"}
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
            <option value="">Välj spelare…</option>
            {activePlayers.map((p) => (
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
            <option value="">Välj spelare…</option>
            {activePlayers.map((p) => (
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
            disabled={sweepSubmitting || !sweepBettor || !sweepGissning}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark disabled:opacity-60"
          >
            {sweepSubmitting ? "Registrerar…" : "Registrera satsning"}
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
              {activePlayers.map((p) => (
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
                  {activePlayers.map((p) => (
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
          disabled={resultSubmitting}
          className="mt-4 rounded-lg bg-tdg-green-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green disabled:opacity-60"
        >
          {resultSubmitting
            ? "Sparar…"
            : roundResults[resultRunda]
              ? "Uppdatera resultat"
              : "Registrera resultat"}
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

      {/* Arkiverade säsonger - en rad per stängd edition i databasen. Läses
          in on demand (lazy) första gången man klickar på ett år, så
          sidladdningen bara behöver hämta den pågående säsongens data. */}
      {closedEditions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Arkiverade säsonger
          </h2>
          <div className="flex flex-wrap gap-2">
            {closedEditions.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => viewArchiveYear(e)}
                className={
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition " +
                  (viewingArchiveYear === e.year
                    ? "bg-tdg-green-dark text-white"
                    : "bg-tdg-gray-light text-stone-600 hover:text-tdg-green")
                }
              >
                TDG {e.year}
              </button>
            ))}
          </div>
          {viewingArchiveYear !== null && (
            <div className="mt-1">
              {archiveLoading && !viewingSnapshot ? (
                <p className="rounded-xl bg-tdg-gray-light p-6 text-sm text-stone-500">Laddar…</p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-stone-500">
                    {archivedEntries.length} poster registrerade för TDG {viewingArchiveYear}.
                  </p>
                  <EntriesTable entries={archivedEntries} />
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* Bekräftelse-toast - visas kort efter en lyckad registrering, se
          showToast() ovan. Fast positionerad så den syns oavsett hur långt
          ner på sidan man scrollat. */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-tdg-green-dark px-4 py-2.5 text-sm font-semibold text-tdg-yellow shadow-lg"
        >
          <span className="mr-1.5 inline-block">✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
