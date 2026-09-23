"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { players } from "@/lib/data";
import { CATEGORY_LABELS, type BettingCategory } from "@/lib/business";
import { InfoTooltip } from "@/components/InfoTooltip";
import { KNOWN_COUNTRIES } from "@/lib/countryFlags";
import {
  supabase,
  type EditionRow,
  type EntryRow,
  type RoundResultRow,
  type SweepstakeBetRow,
} from "@/lib/supabase";
import {
  GOLF_INSATS_DEFAULT,
  SEASON_START_YEAR,
  RESULT_CATEGORIES,
  formatSek,
  playerName,
  roundNumbers,
  mapEntryRow,
  mapSweepstakeBetRow,
  mapRoundResultRows,
  buildAllEntries,
  type Entry,
  type RoundResult,
  type SweepstakeBet,
} from "@/lib/betzExpz";

// "Boende", "Golfbil/vagn" och "Taxi" tillagda 2026-09-23 på Davids begäran -
// "Övrigt" hålls medvetet sist som en catch-all-kategori.
const UTLAGG_KATEGORIER = [
  "Mat",
  "Dryck",
  "Hyrbil",
  "Boende",
  "Golfbil/vagn",
  "Taxi",
  "Övrigt",
] as const;
type UtlaggKategori = (typeof UTLAGG_KATEGORIER)[number];

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

// Fritextfält - används av "Upplaga"-rutan (land, bannamn per runda). En
// valfri `list`-prop kopplar ett <datalist> (se land-fältet nedan) utan att
// hindra att man skriver in något som inte finns i listan.
function TextField({
  label,
  value,
  onChange,
  placeholder,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  list?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-stone-600">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        list={list}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 focus:border-tdg-green focus:outline-none"
      />
    </label>
  );
}

// Belopp visas med tusentalsavgränsare medan man skriver (David bad om
// detta 2026-09-21) - därför ett textfält (inte type="number", som inte kan
// visa mellanslag i talet) som formaterar värdet med sv-SE-lokalen och
// tolkar bort allt utom siffror igen när man skriver.
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
        type="text"
        inputMode="numeric"
        value={value === 0 ? "" : value.toLocaleString("sv-SE")}
        placeholder={placeholder}
        onChange={(e) => {
          const digitsOnly = e.target.value.replace(/\D/g, "");
          onChange(digitsOnly === "" ? 0 : Number(digitsOnly));
        }}
        className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 focus:border-tdg-green focus:outline-none"
      />
    </label>
  );
}

// Hopfällbar ruta - David bad om detta 2026-09-23 eftersom sidan blivit
// ganska lång på mobil och man ofta bara vill åt EN av funktionsrutorna
// (t.ex. bara registrera ett pokerresultat) utan att scrolla förbi allt
// annat. Startar hopfälld (bara rubriken syns), och varje ruta har sitt
// eget oberoende state - flera kan vara öppna samtidigt, det är medvetet
// ingen "ren" accordion (där en ruta stängs när en annan öppnas), eftersom
// man ofta vill fylla i t.ex. både Golfbetting och Resultat-rutan i samma
// svep. Gäller både mobil och desktop, för enkelhetens skull (samma
// komponent/beteende överallt) - även om själva problemet (lång scroll) är
// störst på mobil. Kommer INTE ihåg vilken ruta som var öppen mellan
// sidladdningar (ren React-state) - kan läggas till senare om det visar sig
// irriterande i praktiken.
//
// I hopfällt läge ska rutan fortfarande se ut/kännas som toppen av den
// befintliga gröna/gråa rutan (David var tydlig med detta, med en
// skärmdump som referens) - därför ligger `bg-tdg-gray-light`/`rounded-xl`
// på den YTTRE containern (oavsett öppet/stängt läge), inte bara på
// innehållet. Hela rubrikraden är klickbar (inte bara en liten pil), för
// att vara lättare att träffa på mobilen.
function CollapsibleSection({
  title,
  extra,
  defaultOpen = false,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl bg-tdg-gray-light">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="flex cursor-pointer select-none items-center justify-between gap-2 p-4"
      >
        <span className="flex items-center text-sm font-semibold uppercase tracking-wide text-tdg-green">
          {title}
          {extra && (
            // stopPropagation så ett klick på t.ex. (i)-ikonen inte också
            // fäller till/från hela rutan.
            <span onClick={(e) => e.stopPropagation()}>{extra}</span>
          )}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={
            "h-5 w-5 flex-shrink-0 text-tdg-green transition-transform " +
            (open ? "rotate-180" : "")
          }
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      {open && <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

// Ordningen grupperna visas i - David bad om detta 2026-09-23 ("Golfbetting,
// poker, sweepstake, utlägg").
const HUVUDKATEGORI_ORDER: Entry["huvudkategori"][] = [
  "Golfbetting",
  "Pokerbetting",
  "Sweepstake",
  "Utlägg",
];

// Den delade poster-tabellen - används både för den pågående säsongens
// löpande lista och för att visa upp ett arkiverat års ögonblicksbild
// (read-only i praktiken i båda fallen, arkivvyn har bara inga formulär
// ovanför sig att lägga till fler poster ifrån).
//
// Omgjord 2026-09-23 på Davids begäran: Huvudkategori är inte längre en egen
// kolumn utan en grupperande underrubrik-rad (Golfbetting/Pokerbetting/
// Sweepstake/Utlägg, i den ordningen) - varje registrering hamnar i
// Kategori-kolumnen direkt under sin huvudkategori. En ny Datum-kolumn visar
// när posten registrerades. De automatiskt framräknade posterna (golfbetting-
// vinster, sweepstake-utbetalningar, se computeAutoEntries i betzExpz.ts) har
// inget eget registreringstillfälle - de räknas fram på nytt varje gång sidan
// laddas, det finns ingen riktig "created_at" att visa - därför "–" i
// Datum-kolumnen för dem (samma poster som redan är märkta med "Auto"-badgen).
// `onRequestDelete` skickas bara in från den pågående säsongens tabell
// (se call sites längre ner) - arkivvyn för stängda år får ingen
// radera-knapp, den ska förbli read-only. David bad om radera-knappen
// 2026-09-23, framförallt för att kunna rätta felregistreringar (t.ex.
// dubbla golfbetting-insatser) själv utan att behöva be mig ändra direkt i
// databasen.
function EntriesTable({
  entries,
  onRequestDelete,
}: {
  entries: Entry[];
  onRequestDelete?: (entry: Entry) => void;
}) {
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
            <th className="px-4 py-2 font-medium">Kategori</th>
            <th className="px-4 py-2 font-medium">Datum</th>
            <th className="px-4 py-2 text-right font-medium">Belopp</th>
            {onRequestDelete && (
              <th className="px-3 py-2">
                <span className="sr-only">Åtgärd</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {HUVUDKATEGORI_ORDER.map((huvudkategori) => {
            const group = entries.filter((e) => e.huvudkategori === huvudkategori);
            if (group.length === 0) return null;
            return (
              <Fragment key={huvudkategori}>
                <tr className="border-t border-stone-200 bg-tdg-gray-light">
                  <td
                    colSpan={onRequestDelete ? 5 : 4}
                    className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-tdg-green"
                  >
                    {huvudkategori} ({group.length})
                  </td>
                </tr>
                {group.map((e) => (
                  <tr key={e.id} className="border-t border-stone-100">
                    <td className="px-4 py-2 font-medium">{e.playerName}</td>
                    <td className="px-4 py-2 text-stone-600">
                      <span className="inline-flex items-center gap-1.5">
                        {e.kategori ?? e.detalj}
                        {e.auto && (
                          <span
                            title="Beräknad automatiskt från Resultat-rutan"
                            className="rounded-full bg-tdg-gray-light px-1.5 py-0.5 text-[10px] font-semibold uppercase text-stone-500"
                          >
                            Auto
                          </span>
                        )}
                      </span>
                      {e.kategori && e.detalj !== e.kategori && (
                        <div className="text-xs text-stone-400">{e.detalj}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-stone-500">
                      {e.timestamp > 0 ? new Date(e.timestamp).toLocaleDateString("sv-SE") : "–"}
                    </td>
                    <td
                      className={
                        "px-4 py-2 text-right font-semibold " +
                        (e.belopp >= 0 ? "text-tdg-green" : "text-red-600")
                      }
                    >
                      {formatSek(e.belopp)}
                    </td>
                    {onRequestDelete && (
                      <td className="px-3 py-2 text-right">
                        {e.deletable && (
                          <button
                            type="button"
                            onClick={() => onRequestDelete(e)}
                            title="Radera post"
                            aria-label={`Radera ${e.kategori ?? e.detalj} för ${e.playerName}`}
                            className="rounded-lg p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-600"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className="h-4 w-4"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </Fragment>
            );
          })}
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

  // --- Upplaga: land, antal rundor och bannamn per runda (David bad om
  // detta 2026-09-22 - nytt för TDG 2026 är att bara 3 rundor spelas, inte 4
  // som tidigare alltid antogs). Styr Sweepstakets och Resultat-rutans
  // rondval nedan samt Historik-sidans live-vy (flagga + bannamn per runda).
  // Eget "utkast"-state (inte direkt bundet till activeEdition) så man kan
  // skriva klart land/banor innan man trycker Spara, precis som de andra
  // formulären - synkas om från activeEdition när säsongen byts (Bokslut).
  const [draftCountry, setDraftCountry] = useState("");
  const [draftRoundCount, setDraftRoundCount] = useState(4);
  const [draftCourses, setDraftCourses] = useState<string[]>([]);
  const [upplagaSubmitting, setUpplagaSubmitting] = useState(false);

  useEffect(() => {
    if (!activeEdition) return;
    setDraftCountry(activeEdition.country ?? "");
    setDraftRoundCount(activeEdition.round_count ?? 4);
    setDraftCourses(activeEdition.courses ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEdition?.id]);

  function setDraftRoundCountAndResizeCourses(n: number) {
    setDraftRoundCount(n);
    setDraftCourses((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("");
      return next;
    });
  }

  function setDraftCourse(index: number, value: string) {
    setDraftCourses((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function saveUpplagaDetails() {
    if (!activeEdition || upplagaSubmitting) return;
    setUpplagaSubmitting(true);
    const courses = roundNumbers(draftRoundCount).map((r) => (draftCourses[r - 1] ?? "").trim());
    const { data, error } = await supabase
      .from("editions")
      .update({
        country: draftCountry.trim() || null,
        round_count: draftRoundCount,
        courses,
      })
      .eq("id", activeEdition.id)
      .select()
      .single();
    setUpplagaSubmitting(false);
    if (error) {
      console.error(error);
      alert("Kunde inte spara upplagans detaljer - försök igen.");
      return;
    }
    const updatedEdition = data as EditionRow;
    setEditions((prev) => prev.map((e) => (e.id === updatedEdition.id ? updatedEdition : e)));
    showToast(`Upplagans detaljer sparade för TDG ${updatedEdition.year}`);
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

  // --- Radera post (David bad om detta 2026-09-23, som ett sätt att själv
  // kunna rätta felregistreringar - t.ex. sin egen dubbla golfbetting-insats
  // - utan att behöva be mig ändra direkt i databasen).Föregås alltid av en
  // bekräftelse-popup (se modalen längst ner i JSX:en), aldrig en direkt
  // radering vid klick. `deletingEntry.deletable` pekar ut vilken tabell och
  // vilket id posten faktiskt ligger på (entries eller sweepstake_bets) - se
  // Entry["deletable"] i betzExpz.ts. Auto-poster (golfbetting-vinster,
  // sweepstake-utbetalningar) saknar `deletable` och får aldrig någon
  // radera-knapp i EntriesTable ovan, de finns bara framräknade i minnet.
  const [deletingEntry, setDeletingEntry] = useState<Entry | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  async function confirmDeleteEntry() {
    if (!deletingEntry?.deletable || deleteSubmitting) return;
    setDeleteSubmitting(true);
    const { table, id } = deletingEntry.deletable;
    const { error } = await supabase.from(table).delete().eq("id", id);
    setDeleteSubmitting(false);
    if (error) {
      console.error(error);
      alert("Kunde inte radera posten - försök igen.");
      return;
    }
    if (table === "entries") {
      setEntries((prev) => prev.filter((e) => e.deletable?.table !== "entries" || e.deletable.id !== id));
    } else {
      setSweepstakeBets((prev) => prev.filter((b) => b.id !== id));
    }
    showToast(`${deletingEntry.kategori ?? deletingEntry.detalj} raderad för ${deletingEntry.playerName}`);
    setDeletingEntry(null);
  }

  // --- Golfbetting (bara insats - vinster räknas fram automatiskt, se Resultat-rutan) ---
  // Bara EN insats per spelare och säsong tillåts (David bad om detta
  // 2026-09-21) - så fort en spelare har en registrerad Golfbetting-insats
  // (huvudkategori+detalj) för den aktiva säsongen försvinner den ur
  // rullistan här, samma sätt som Deltagare-valet filtrerar bort spelare.
  const golfRegisteredIds = useMemo(
    () =>
      new Set(
        entries
          .filter((e) => e.huvudkategori === "Golfbetting" && e.detalj === "Insats")
          .map((e) => players.find((p) => p.fullName === e.playerName)?.id)
          .filter((id): id is string => Boolean(id))
      ),
    [entries]
  );
  const golfEligiblePlayers = useMemo(
    () => activePlayers.filter((p) => !golfRegisteredIds.has(p.id)),
    [activePlayers, golfRegisteredIds]
  );

  // Insatsen är alltid samma för alla spelare i en given upplaga (kan
  // variera år från år) - David förtydligade 2026-09-23 att golfbetting-
  // insatsen aldrig är valfri, alla som deltar måste lägga in den. Rutan
  // förenklad därför till EN summa + EN bekräftelseknapp istället för att
  // registrera spelare för spelare - vilka spelare det gäller är redan
  // beslutat via Deltagare-rutan (golfEligiblePlayers) innan man kommer hit.
  const [golfBelopp, setGolfBelopp] = useState(GOLF_INSATS_DEFAULT);
  const [golfSubmitting, setGolfSubmitting] = useState(false);

  async function registerGolfInsatsForAll() {
    if (!activeEdition || golfEligiblePlayers.length === 0 || golfSubmitting) return;
    setGolfSubmitting(true);
    const belopp = -Math.abs(golfBelopp);
    const { data, error } = await supabase
      .from("entries")
      .insert(
        golfEligiblePlayers.map((p) => ({
          edition_id: activeEdition.id,
          player_name: p.fullName,
          huvudkategori: "Golfbetting" as const,
          detalj: "Insats",
          kategori: null,
          belopp,
        }))
      )
      .select();
    setGolfSubmitting(false);
    if (error) {
      console.error(error);
      alert("Kunde inte registrera insatsen - försök igen.");
      return;
    }
    const antalSpelare = golfEligiblePlayers.length;
    setEntries((prev) => [...(data as EntryRow[]).map(mapEntryRow), ...prev]);
    setGolfBelopp(GOLF_INSATS_DEFAULT);
    showToast(`Insats om ${golfBelopp.toLocaleString("sv-SE")} kr registrerad för ${antalSpelare} spelare`);
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

  // Om antalet rundor minskas i Upplaga-rutan (t.ex. till 3 för TDG 2026)
  // efter att ett rondval redan gjorts här eller i Sweepstake ovan, dra ner
  // de valen så de inte pekar på en runda som inte längre finns.
  useEffect(() => {
    const max = activeEdition?.round_count ?? 4;
    setSweepRunda((prev) => Math.min(prev, max));
    if (resultRunda > max) selectResultRunda(max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEdition?.round_count]);

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
    () => buildAllEntries(entries, sweepstakeBets, roundResults, activeEdition?.round_count ?? 4),
    [entries, sweepstakeBets, roundResults, activeEdition?.round_count]
  );

  const viewingEdition = closedEditions.find((e) => e.year === viewingArchiveYear) ?? null;
  const viewingSnapshot = viewingEdition ? archiveData[viewingEdition.id] ?? null : null;
  const archivedEntries = useMemo(
    () =>
      viewingSnapshot
        ? buildAllEntries(
            viewingSnapshot.entries,
            viewingSnapshot.sweepstakeBets,
            viewingSnapshot.roundResults,
            viewingEdition?.round_count ?? 4
          )
        : [],
    [viewingSnapshot, viewingEdition?.round_count]
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

      {/* Upplaga: land, antal rundor och bannamn per runda (David bad om
          detta 2026-09-22 - nytt för TDG 2026 är att bara 3 rundor spelas,
          inte 4 som tidigare alltid antogs). Styr Sweepstakets och
          Resultat-rutans rondval ovan/nedan, samt Historik-sidans live-vy
          (flagga + bannamn per runda). Eget utkast-state, sparas explicit
          med en knapp (inte varje knapptryck) eftersom bannamnen är fritext. */}
      <section className="rounded-xl bg-tdg-gray-light p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">
          Upplaga TDG {activeYear}
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          Land, antal rundor och bannamn - styr rondvalen ovan/nedan samt Historik-sidan.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="max-w-xs flex-1">
            <TextField
              label="Land"
              value={draftCountry}
              onChange={setDraftCountry}
              placeholder="T.ex. Spanien"
              list="known-countries"
            />
            <datalist id="known-countries">
              {KNOWN_COUNTRIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-stone-600">Antal rundor</span>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDraftRoundCountAndResizeCourses(n)}
                  className={
                    "h-9 w-9 rounded-lg text-sm font-semibold transition " +
                    (draftRoundCount === n
                      ? "bg-tdg-green-dark text-white"
                      : "bg-white text-stone-600 hover:text-tdg-green")
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {roundNumbers(draftRoundCount).map((r) => (
            <TextField
              key={r}
              label={`Bana - Runda ${r}`}
              value={draftCourses[r - 1] ?? ""}
              onChange={(v) => setDraftCourse(r - 1, v)}
              placeholder="Namn på golfbana"
            />
          ))}
        </div>
        <button
          type="button"
          onClick={saveUpplagaDetails}
          disabled={upplagaSubmitting}
          className="mt-3 rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark disabled:opacity-60"
        >
          {upplagaSubmitting ? "Sparar…" : "Spara"}
        </button>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Golfbetting - bara insats, samma summa för alla spelare */}
        <CollapsibleSection title="Golfbetting">
          <p className="text-xs text-stone-500">
            Insatsen är alltid samma för alla spelare i årets upplaga (men kan ändras år från
            år). Vinster per kategori räknas fram automatiskt från Resultat-rutan längst ner, som
            en jämn andel av den totala insatspotten.
          </p>
          {golfEligiblePlayers.length > 0 ? (
            <>
              <AmountField
                label={`Årets insats per spelare (kr) - gäller ${golfEligiblePlayers.length} spelare`}
                value={golfBelopp}
                onChange={setGolfBelopp}
              />
              <button
                type="button"
                onClick={registerGolfInsatsForAll}
                disabled={golfSubmitting}
                className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark disabled:opacity-60"
              >
                {golfSubmitting
                  ? "Registrerar…"
                  : `Bekräfta insats för ${golfEligiblePlayers.length} spelare`}
              </button>
            </>
          ) : (
            <p className="rounded-lg bg-white px-3 py-2 text-sm text-stone-500">
              Alla spelare har redan registrerat sin insats för TDG {activeYear}.
            </p>
          )}
        </CollapsibleSection>

        {/* Pokerbetting */}
        <CollapsibleSection title="Pokerbetting">
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
          <AmountField
            label="Belopp (kr)"
            value={pokerBelopp}
            onChange={setPokerBelopp}
            placeholder="Valfri summa"
          />
          <button
            type="button"
            onClick={registerPoker}
            disabled={pokerSubmitting || !pokerSpelare}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark disabled:opacity-60"
          >
            {pokerSubmitting ? "Registrerar…" : "Registrera"}
          </button>
        </CollapsibleSection>

        {/* Utlägg */}
        <CollapsibleSection title="Utlägg">
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
          <AmountField
            label="Belopp (kr)"
            value={utlaggBelopp}
            onChange={setUtlaggBelopp}
            placeholder="Valfri summa"
          />
          <button
            type="button"
            onClick={registerUtlagg}
            disabled={utlaggSubmitting || !utlaggSpelare}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark disabled:opacity-60"
          >
            {utlaggSubmitting ? "Registrerar…" : "Registrera"}
          </button>
        </CollapsibleSection>

        {/* Sweepstake - fri insats, ingen Vinst-knapp */}
        <CollapsibleSection
          title="Sweepstake"
          extra={
            <InfoTooltip
              variant="light"
              label="Om Sweepstake"
              text="Valfritt sidospel, oberoende av golfbettingens insats. Gissa vem som vinner en kategori en given runda - vinnaren (eller de som gissat rätt, delat lika) tar hem hela potten automatiskt när rondresultatet registrerats."
            />
          }
        >
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
            {roundNumbers(activeEdition.round_count).map((r) => (
              <option key={r} value={r}>
                Runda {r}
                {activeEdition.courses[r - 1] ? ` – ${activeEdition.courses[r - 1]}` : ""}
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
        </CollapsibleSection>
      </div>

      {/* Resultat per golfrunda - facit som golfbetting-vinsterna och
          sweepstake-utbetalningarna ovan räknas fram från. Egen sektion
          (inte del av 3-kolumnsgridden) eftersom den rymmer mycket mer
          innehåll (alla 9 spelares nettoscore + 5 kategorivinnare) än de
          andra rutorna. */}
      <CollapsibleSection title="Resultat per golfrunda">
        <p className="text-xs text-stone-500">
          Facit för en runda - nettoscore för samtliga 9 spelare, plus vem som vann varje
          betting-kategori. Poängbogey (tävlingens officiella huvudresultat) registreras inte
          här, det hanteras separat som idag.
        </p>

        <div className="max-w-xs">
          <SelectField
            label="Runda"
            value={String(resultRunda)}
            onChange={(v) => selectResultRunda(Number(v))}
          >
            {roundNumbers(activeEdition.round_count).map((r) => (
              <option key={r} value={r}>
                Runda {r}
                {activeEdition.courses[r - 1] ? ` – ${activeEdition.courses[r - 1]}` : ""}
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
      </CollapsibleSection>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Registrerade poster {allEntries.length > 0 ? `(${allEntries.length})` : ""}
        </h2>
        {allEntries.length === 0 ? (
          <p className="rounded-xl bg-tdg-gray-light p-6 text-sm text-stone-500">
            Inga poster registrerade ännu. Använd formulären ovan för att komma igång.
          </p>
        ) : (
          <EntriesTable entries={allEntries} onRequestDelete={setDeletingEntry} />
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

      {/* Radera-bekräftelse - popup som David bad om 2026-09-23, öppnas via
          papperskorgs-knappen i EntriesTable ovan (bara på pågående säsongs
          tabell, se onRequestDelete). Ingen radering sker förrän man
          uttryckligen bekräftar här. */}
      {deletingEntry && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
          onClick={() => !deleteSubmitting && setDeletingEntry(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-stone-900">Radera post?</h3>
            <p className="mt-2 text-sm text-stone-600">
              Vill du radera{" "}
              <span className="font-medium text-stone-900">
                {deletingEntry.kategori ?? deletingEntry.detalj}
              </span>{" "}
              ({formatSek(deletingEntry.belopp)}) för{" "}
              <span className="font-medium text-stone-900">{deletingEntry.playerName}</span>? Detta går
              inte att ångra.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingEntry(null)}
                disabled={deleteSubmitting}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-60"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={confirmDeleteEntry}
                disabled={deleteSubmitting}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {deleteSubmitting ? "Raderar…" : "Ja, radera"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
