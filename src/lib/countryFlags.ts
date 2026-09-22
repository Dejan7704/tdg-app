// Flagg-emoji för de länder TDG spelats i (se `country`-fältet i
// `src/data/editions.json`). Nyckeln är exakt den svenska landsbenämning som
// används i datan, så uppslaget bara är en enkel lookup, inget
// landskodsbibliotek behövs för de sju värden som faktiskt förekommer.
//
// "Skottland" har ingen egen flagg-emoji i Unicode-standarden (den skotska
// flaggan kräver en s.k. tag-sekvens som stöds ojämnt mellan enheter/appar,
// t.ex. i delade länkar via WhatsApp) - Storbritanniens flagga används
// istället, samma genväg som brukar användas i den här typen av sammanhang.
const COUNTRY_FLAGS: Record<string, string> = {
  Sverige: "🇸🇪",
  Irland: "🇮🇪",
  Italien: "🇮🇹",
  Portugal: "🇵🇹",
  Skottland: "🇬🇧",
  Spanien: "🇪🇸",
};

export function getCountryFlag(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRY_FLAGS[country] ?? null;
}
