"use client";

import { useState } from "react";

// Liten (i)-ikon som visar en förklarande text i en popup-ruta - både vid
// hover (mus, desktop) och vid klick/tap (mobil, där hover inte finns).
//
// Hover hanteras helt i CSS (Tailwinds group-hover) - inget JS-state
// inblandat där, så det fungerar exakt som en vanlig CSS-hover ska. Klick/tap
// styrs separat av ett React-state (`open`) som "nålar fast" rutan synlig -
// tänkt för mobil, där hover inte finns. De två är medvetet oberoende: en
// tidigare version lät musen-över också sätta state:t, men då kunde ett
// vanligt musklick (som både triggar hover OCH click) råka slå av och på
// state:t i samma interaktion så rutan aldrig hann synas - därför separerade
// spår istället.
//
// Byggd generisk (tar bara `text` + ev. `label`) så den går att återanvända
// om fler ställen i appen får behov av en kort förklarande tooltip, inte bara
// "Projected winner"-raden på Hem-sidan den skapades för (2026-09-19).
//
// `variant` styr ikonens färg: "dark" (standard) är gjord för att synas på en
// mörk/färgad bakgrund (som Hem-sidans gröna ruta), "light" är till för en
// ljus bakgrund (som Betz & Expz-rutorna, tillagt 2026-09-21).
export function InfoTooltip({
  text,
  label = "Mer information",
  variant = "dark",
}: {
  text: string;
  label?: string;
  variant?: "dark" | "light";
}) {
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const buttonClass =
    variant === "dark"
      ? "border-white/50 text-white/80 hover:border-white hover:text-white"
      : "border-tdg-green text-tdg-green hover:border-tdg-green-dark hover:text-tdg-green-dark";

  return (
    <span className="group relative inline-flex items-center align-middle">
      <button
        type="button"
        onClick={() => setPinnedOpen((o) => !o)}
        onBlur={() => setPinnedOpen(false)}
        aria-label={label}
        aria-expanded={pinnedOpen}
        className={`ml-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none transition ${buttonClass}`}
      >
        i
      </button>
      <span
        role="tooltip"
        className={`absolute left-0 top-full z-20 mt-2 w-64 max-w-[80vw] rounded-lg bg-white p-3 text-xs font-normal leading-relaxed text-stone-700 shadow-lg ring-1 ring-stone-200 ${
          pinnedOpen ? "block" : "hidden group-hover:block"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
