// Datumlogik för nästa TDG-säsong (David bad om detta 2026-10-02, direkt
// efter att TDG 2026 avslutades via "Bokslut 2026" på Betz & Expz-sidan).
//
// Bakgrund: "Bokslut {år}"-knappen skapar OMEDELBART nästa års öppna
// edition-rad i Supabase (se closeSeason() i utlagg/page.tsx) - annars
// skulle registrering för nästa säsong inte gå att starta förrän någon rört
// kod. Men David tyckte det blev fel att t.ex. "2027 öppen"/"2027 pågående"
// och "Projected winner 2027" dök upp överallt i appen redan i början av
// oktober, samma dag som TDG 2026 avslutades - långt innan nästa års resa
// ens är planerad (deltagare/land/banor bestäms normalt apr-jul).
//
// Lösning, Davids egen beskrivning (bekräftad 2026-10-02): en tre-stegs fas
// per upplaga, byggd på två signaler som redan finns i datamodellen - inget
// nytt databasfält behövdes:
//
//   1. "locked"   - innan 1 mars upplagans år. Ingenting om säsongen visas
//                   någonstans i appen, oavsett om Upplaga-rutan råkat
//                   sparas tidigare (skyddar mot att någon fyller i land i
//                   förtid, t.ex. i januari).
//   2. "upcoming" - 1 mars eller senare, men Upplaga-rutans "Spara"-knapp
//                   (som sätter `editions.country` m.fl. på en gång, se
//                   saveUpplagaDetails i utlagg/page.tsx) har ännu inte
//                   tryckts för den här upplagan (`country` är null/tomt).
//   3. "active"   - Upplaga sparad (`country` ifyllt) - säsongen är nu
//                   fullt "pågående" överallt i appen.
//
// Deltagare-rutan har ingen egen "Spara"-knapp (sparar varje klick direkt),
// så den har inget eget färdigt-tillstånd att läsa av - `country` (satt
// tillsammans med rundantal/banor i SAMMA Upplaga-spara-anrop) används
// därför som den enda signalen för "David har satt ihop säsongen", i linje
// med att Deltagare-rutan ligger alldeles ovanför Upplaga-rutan i samma
// arbetsflöde.
//
// Betz & Expz-sidans egen säsongsrubrik har en enklare tvåstegslogik (bara
// "upcoming"/"active", ingen 1 mars-spärr) - där ska registreringsformulären
// alltid gå att använda så fort "Bokslut"-knappen tryckts, bara rubrikens
// ordval ändras (se utlagg/page.tsx) - så den använder bara
// isSeasonConfigured() direkt, inte getSeasonPhase().

/** Månad (0-indexerad, dvs 2 = mars) då nästa säsong tidigast blir synlig. */
export const SEASON_UNLOCK_MONTH = 2; // mars
export const SEASON_UNLOCK_DAY = 1;

/** True från och med 1 mars `year`, annars false. */
export function isSeasonUnlocked(year: number, now: Date = new Date()): boolean {
  const threshold = new Date(year, SEASON_UNLOCK_MONTH, SEASON_UNLOCK_DAY);
  return now.getTime() >= threshold.getTime();
}

/** True så fort Upplaga-rutans "Spara"-knapp tryckts för upplagan (land ifyllt). */
export function isSeasonConfigured(country: string | null | undefined): boolean {
  return country != null && country.trim().length > 0;
}

export type SeasonPhase = "locked" | "upcoming" | "active";

/**
 * Hela fas-logiken i en funktion - se filkommentaren högst upp för
 * resonemanget. `now` kan skickas in explicit för tester, annars dagens
 * datum.
 */
export function getSeasonPhase(
  year: number,
  country: string | null | undefined,
  now: Date = new Date()
): SeasonPhase {
  if (!isSeasonUnlocked(year, now)) return "locked";
  if (!isSeasonConfigured(country)) return "upcoming";
  return "active";
}

// --- Romerska upplagenummer ---
// TDG-arkivets editions.json har redan ett `roman`-fält per historiskt år,
// satt för hand (I för 2004, II för 2005, osv, sekventiellt ett steg per
// upplaga/år - bekräftat genom att läsa samtliga 22 värden). Den här
// funktionen beräknar SAMMA numrering dynamiskt för ett år som ännu inte
// finns i den statiska filen (dvs ett Supabase-år) - används för att
// generera "TDG XXIII" åt ett just avslutat (men ännu inte arkiverat) år
// på Historik-sidan, se David 2026-10-02: "istället för Avslutad 2026 ska
// det stå TDG XXIII, vilket ska genereras så fort man gjort Bokslut".
const ROMAN_VALUES: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function toRoman(num: number): string {
  let n = Math.max(0, Math.round(num));
  let result = "";
  for (const [value, symbol] of ROMAN_VALUES) {
    while (n >= value) {
      result += symbol;
      n -= value;
    }
  }
  return result;
}

/** Första TDG-upplagan var 2004 ("TDG I") - samma ankare som editions.json. */
const FIRST_EDITION_YEAR = 2004;

export function editionRoman(year: number): string {
  return toRoman(year - FIRST_EDITION_YEAR + 1);
}
