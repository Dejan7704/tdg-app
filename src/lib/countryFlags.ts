// Flagg-emoji för de länder TDG spelats i (se `country`-fältet i
// `src/data/editions.json`). Nyckeln är exakt den svenska landsbenämning som
// används i datan, så uppslaget bara är en enkel lookup, inget
// landskodsbibliotek behövs för de sju värden som faktiskt förekommer.
//
// "Skottland" har ingen ISO-landskod och därmed ingen vanlig flagg-emoji -
// den skotska flaggan byggs istället av en Unicode-"tag-sekvens"
// (🏴 + dolda tag-tecken för "gbsct") som stöds brett i moderna appar/OS
// (iOS/macOS, moderna Android, WhatsApp m.fl.). David bad uttryckligen om
// den riktiga skotska flaggan 2026-09-22 istället för Storbritanniens.
const SCOTLAND_FLAG = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";

const COUNTRY_FLAGS: Record<string, string> = {
  Sverige: "🇸🇪",
  Irland: "🇮🇪",
  Italien: "🇮🇹",
  Portugal: "🇵🇹",
  Skottland: SCOTLAND_FLAG,
  Spanien: "🇪🇸",
};

export function getCountryFlag(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRY_FLAGS[country] ?? null;
}
