"use client";

import { useState } from "react";
import { players } from "@/lib/data";
import { CATEGORY_LABELS, CATEGORY_ORDER, type BettingCategory } from "@/lib/business";

// Standardbelopp för golfbetting, hämtade från samma logik/summor som i 2025
// års utfall (se business-2025.json): insatsen är en fast årlig summa per
// spelare (2 000 kr), och en vinst per kategori och runda är normalt 700 kr
// (350 kr om vinsten delas mellan två spelare - justera beloppet manuellt i
// så fall). Båda är bara förifyllda startvärden - allt går att ändra innan
// man registrerar.
const GOLF_INSATS_DEFAULT = 2000;
const GOLF_VINST_DEFAULT = 700;

const UTLAGG_KATEGORIER = ["Mat", "Dryck", "Hyrbil", "Övrigt"] as const;
type UtlaggKategori = (typeof UTLAGG_KATEGORIER)[number];

type Entry = {
  id: number;
  timestamp: number;
  playerName: string;
  huvudkategori: "Golfbetting" | "Pokerbetting" | "Utlägg";
  detalj: string;
  kategori?: string;
  belopp: number;
};

function formatSek(n: number): string {
  const rounded = Math.round(n);
  return (rounded > 0 ? "+" : "") + rounded.toLocaleString("sv-SE") + " kr";
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
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-stone-600">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
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

  // --- Golfbetting ---
  const [golfSpelare, setGolfSpelare] = useState(players[0]?.id ?? "");
  const [golfTyp, setGolfTyp] = useState<"insats" | "vinst">("vinst");
  const [golfRunda, setGolfRunda] = useState(1);
  const [golfKategori, setGolfKategori] = useState<BettingCategory>("closest");
  const [golfBelopp, setGolfBelopp] = useState(GOLF_VINST_DEFAULT);

  function handleGolfTyp(typ: "insats" | "vinst") {
    setGolfTyp(typ);
    setGolfBelopp(typ === "insats" ? GOLF_INSATS_DEFAULT : GOLF_VINST_DEFAULT);
  }

  function registerGolf() {
    const player = players.find((p) => p.id === golfSpelare);
    if (!player) return;
    const belopp = golfTyp === "insats" ? -Math.abs(golfBelopp) : Math.abs(golfBelopp);
    const detalj =
      golfTyp === "insats"
        ? "Insats"
        : `Vinst – Runda ${golfRunda}, ${CATEGORY_LABELS[golfKategori]}`;
    addEntry({ playerName: player.fullName, huvudkategori: "Golfbetting", detalj, belopp });
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
    const belopp = Math.abs(utlaggBelopp);
    addEntry({
      playerName: player.fullName,
      huvudkategori: "Utlägg",
      detalj: utlaggKategori,
      kategori: utlaggKategori,
      belopp,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Betz & Expz</h1>
        <p className="mt-1 max-w-2xl text-stone-500">
          Registrera utlägg och betting-vinster löpande under årets resa (från och med 2026).
          Insatser registreras som negativa poster, vinster och utlägg som positiva.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Golfbetting */}
        <div className="flex flex-col gap-3 rounded-xl bg-tdg-gray-light p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-tdg-green">
            Golfbetting
          </h2>
          <SelectField label="Spelare" value={golfSpelare} onChange={setGolfSpelare}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </SelectField>
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => handleGolfTyp("insats")}
              className={
                "flex-1 rounded-lg px-3 py-2 font-medium transition " +
                (golfTyp === "insats"
                  ? "bg-tdg-green-dark text-white"
                  : "bg-white text-stone-600 hover:text-tdg-green")
              }
            >
              Insats
            </button>
            <button
              type="button"
              onClick={() => handleGolfTyp("vinst")}
              className={
                "flex-1 rounded-lg px-3 py-2 font-medium transition " +
                (golfTyp === "vinst"
                  ? "bg-tdg-green-dark text-white"
                  : "bg-white text-stone-600 hover:text-tdg-green")
              }
            >
              Vinst
            </button>
          </div>
          {golfTyp === "vinst" && (
            <>
              <SelectField
                label="Runda"
                value={String(golfRunda)}
                onChange={(v) => setGolfRunda(Number(v))}
              >
                {[1, 2, 3, 4].map((r) => (
                  <option key={r} value={r}>
                    Runda {r}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Kategori"
                value={golfKategori}
                onChange={(v) => setGolfKategori(v as BettingCategory)}
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </SelectField>
            </>
          )}
          <AmountField label="Belopp (kr)" value={golfBelopp} onChange={setGolfBelopp} />
          <button
            type="button"
            onClick={registerGolf}
            className="rounded-lg bg-tdg-green px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdg-green-dark"
          >
            Registrera
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
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Registrerade poster {entries.length > 0 ? `(${entries.length})` : ""}
        </h2>
        {entries.length === 0 ? (
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
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-stone-100">
                    <td className="px-4 py-2 font-medium">{e.playerName}</td>
                    <td className="px-4 py-2 text-stone-600">
                      {e.huvudkategori}
                      {e.huvudkategori !== "Utlägg" && (
                        <div className="text-xs text-stone-400">{e.detalj}</div>
                      )}
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
