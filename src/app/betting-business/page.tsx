import Link from "next/link";
import {
  getAllBusinessYears,
  getBusinessYear,
  getBusinessYears,
  getCategoryTotals,
  getSettlement,
  getUnknownParticipants,
  getYearlyTotals,
  resolveBusinessPlayer,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type BusinessYear,
} from "@/lib/business";
import { EDITIONS_MIN_YEAR, EDITIONS_MAX_YEAR, getEdition, getMainSection, getPlayer } from "@/lib/data";
import { DualAxisLineChart } from "@/components/LineChart";
import { getLiveBokslut, getSupabaseSeasonStats, type LiveBokslut } from "@/lib/liveBokslut";
import { RESULT_CATEGORIES } from "@/lib/betzExpz";
import { InfoTooltip } from "@/components/InfoTooltip";

// David bad 2026-09-23 om att ta bort "kr"-enheten i alla Bokslut-tabellernas
// belopps-celler (TotalsTable/LiveTotalsTable/SettlementTable/
// LiveSettlementTable) - tar bara onödig plats, det är ändå tydligt att det
// handlar om pengar där. `unit: false` styr det. Rond-korten (RoundCard/
// LiveRoundCard) och löptext utanför tabellerna (sweepstake-pott som rullar
// vidare, insats-raden i formuläret ovan) behåller "kr" oförändrat - det är
// inte "bokslutstabeller" och läses som hela meningar där.
function formatSek(n: number, opts?: { unit?: boolean }): string {
  const rounded = Math.round(n);
  const unit = opts?.unit ?? true;
  return (rounded > 0 ? "+" : "") + rounded.toLocaleString("sv-SE") + (unit ? " kr" : "");
}

// Kortnamn för avräkningscellen ("David H" istället för "David Hedlund") -
// David bad om detta 2026-09-23 för att spara plats. Förnamn räcker inte
// ensamt eftersom TDG har två spelare med samma förnamn (David Hedlund/David
// Malmström) - första bokstaven i efternamnet disambiguerar. "TBD" (ingen
// riktig spelare) lämnas oförändrad.
function shortName(fullName: string): string {
  if (fullName === TBD_ID) return fullName;
  const parts = fullName.trim().split(/\s+/);
  return parts.length < 2 ? (parts[0] ?? fullName) : `${parts[0]} ${parts[1][0]}`;
}

// Räknar ut föreslagna betalningar som nollställer samtliga spelares
// justering, med minsta möjliga antal transaktioner (girig matchning av
// störst skuld mot störst fordran, samma metod som t.ex. Splitwise) - David
// bad om detta 2026-09-22 för att kunna se "vem ska betala vem" direkt på
// Bokslut-sidan även för den pågående säsongen, inte bara som en manuellt
// ikryssad notering (som de avslutade årens `note`-fält). Uppdateras
// automatiskt varje gång justeringen ändras, dvs varje gång en ny post
// registreras på Betz & Expz.
//
// Omgjord 2026-09-23 på Davids begäran (se "Utlägg_Betting_Avräkning
// uppställning o logik.xlsx") - avräkningen ska uppdateras löpande under HELA
// säsongen, inte bara visa varje spelares egen preliminära ställning tills
// potten balanserar exakt. Gruppens justering summerar normalt INTE till 0
// mitt i en säsong (Golfbetting-potten betalas bara ut i takt med att
// rondresultat registreras) - girig matchning körs därför alltid, och den
// skuld som blir över när krediterna (`creditors`) tar slut markeras med en
// "TBD"-mottagare (`toId: "TBD"`) istället för att gissa fel eller döljas
// bakom en generisk "Ska betala"-text. Se `settlementDisplay()` nedan för
// hur TBD-raderna vävs in i visningstexten.
const TBD_ID = "TBD";

function settleBalances(
  rows: { playerId: string; playerName: string; justering: number }[]
): { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] {
  const creditors = rows
    .filter((r) => r.justering > 0.5)
    .map((r) => ({ id: r.playerId, name: r.playerName, amount: r.justering }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = rows
    .filter((r) => r.justering < -0.5)
    .map((r) => ({ id: r.playerId, name: r.playerName, amount: -r.justering }))
    .sort((a, b) => b.amount - a.amount);

  const transactions: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0.5) {
      transactions.push({
        fromId: debtor.id,
        fromName: debtor.name,
        toId: creditor.id,
        toName: creditor.name,
        amount: Math.round(amount),
      });
    }
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount <= 0.5) i++;
    if (creditor.amount <= 0.5) j++;
  }

  // Skuld som blir över när krediterna tar slut - normalt den del av
  // golfbetting-/sweepstake-potten som ännu inte betalats ut till någon
  // specifik vinnare. Går inte att peka ut EN mottagare för den (det beror
  // på kommande rondresultat) - markeras "TBD" istället.
  while (i < debtors.length) {
    const debtor = debtors[i];
    if (debtor.amount > 0.5) {
      transactions.push({
        fromId: debtor.id,
        fromName: debtor.name,
        toId: TBD_ID,
        toName: "TBD",
        amount: Math.round(debtor.amount),
      });
    }
    i++;
  }
  return transactions;
}

type SettlementDisplay = {
  textByPlayer: Record<string, string>;
  /** true om minst en TBD-rad förekommer (potten inte helt utbetald än) - styr en kort förklarande fotnot i UI:t. */
  hasOutstanding: boolean;
};

// Omgjord 2026-09-23 på Davids begäran: bara den som ska BETALA får text i
// sin cell, i det kompakta formatet "1,866 -> TBD" (siffra, tusentalsavgränsat
// med komma precis som i Davids exempel, inte "kr", pil till kortnamnet på
// mottagaren). Den som ska FÅ pengar behöver ingen text alls i sin cell -
// "dubbeladmin" enligt David, informationen finns redan i motpartens
// betalar-cell. Går varken att betala eller få (nollställd) visas "Kvitt".
function settlementDisplay(
  rows: { playerId: string; playerName: string; justering: number }[]
): SettlementDisplay {
  const transactions = settleBalances(rows);
  const textByPlayer: Record<string, string> = {};
  for (const r of rows) {
    const pays = transactions.filter((t) => t.fromId === r.playerId);
    const getsSomething = transactions.some((t) => t.toId === r.playerId);
    if (pays.length > 0) {
      textByPlayer[r.playerId] = pays
        .map((t) => `${t.amount.toLocaleString("en-US")} -> ${shortName(t.toName)}`)
        .join(", ");
    } else {
      textByPlayer[r.playerId] = getsSomething ? "" : "Kvitt";
    }
  }
  return { textByPlayer, hasOutstanding: transactions.some((t) => t.toId === TBD_ID) };
}

// --- Live-vy för den pågående säsongen (tillagd 2026-09-22) - samma sorts
// inforutor (rond för rond, totalt, avräkning) som de arkiverade åren nedan,
// men byggda från getLiveBokslut() (Supabase, playerId-nycklad) istället för
// en statisk business-*.json-fil (nickname-nycklad). Egna komponenter
// eftersom PlayerBadge/RoundCard/TotalsTable/SettlementTable ovan är
// hårt knutna till BusinessYear/nickname-modellen. ---

function LivePlayerLink({ playerId, playerName }: { playerId: string; playerName: string }) {
  return (
    <Link href={`/spelare/${playerId}`} className="font-medium text-tdg-green hover:underline">
      {playerName}
    </Link>
  );
}

function LiveRoundCard({
  round,
  courses,
  sweepstakeEvents,
}: {
  round: LiveBokslut["rounds"][number];
  /** Bannamn per runda för den pågående säsongen (index 0 = Runda 1), från `LiveBokslut.courses` - INTE `getEdition()`, som aldrig hittar den pågående säsongen i den statiska editions.json (den blir en "riktig" upplaga där först när säsongen avslutas). Tillagt 2026-09-22. */
  courses: string[];
  /** Sweepstake-händelser (utbetalning eller rullande pott) för just den här rundan - David bad 2026-09-23 om en synlig indikator här, se computeSweepstakeRoundInfo i betzExpz.ts. */
  sweepstakeEvents: LiveBokslut["sweepstakeEvents"];
}) {
  const course = courses[round.round - 1] || undefined;
  const roundSweepstake = sweepstakeEvents.filter((e) => e.runda === round.round);

  return (
    <div className="overflow-hidden rounded-xl bg-tdg-gray-light">
      <div className="bg-tdg-green-dark px-4 py-2 text-sm font-semibold text-white">
        Runda {round.round}
        {course && <span className="ml-2 font-normal text-white/70">· {course}</span>}
      </div>
      <div className="grid divide-y divide-white sm:grid-cols-3 sm:divide-x sm:divide-y-0 lg:grid-cols-5">
        {RESULT_CATEGORIES.map((cat) => {
          const wins = round.wins.filter((w) => w.category === cat);
          return (
            <div key={cat} className="px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
                {CATEGORY_LABELS[cat]}
              </div>
              {wins.length === 0 ? (
                <div className="mt-1 text-sm text-stone-400">–</div>
              ) : (
                <div className="mt-1 flex flex-col gap-1.5">
                  {wins.map((w, i) => (
                    <div key={i} className="flex flex-col text-sm leading-tight">
                      <LivePlayerLink playerId={w.playerId} playerName={w.playerName} />
                      <span className="text-xs text-stone-600">{formatSek(w.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {roundSweepstake.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-white px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Sweepstake</div>
          {roundSweepstake.map((e, i) =>
            e.outcome === "rolled" ? (
              <p key={i} className="text-xs text-stone-600">
                {CATEGORY_LABELS[e.category]}: ingen gissade rätt –{" "}
                <span className="font-medium text-tdg-green-dark">
                  {Math.round(e.potAmount).toLocaleString("sv-SE")} kr
                </span>{" "}
                rullar vidare till nästa runda.
              </p>
            ) : (
              <p key={i} className="text-xs text-stone-600">
                {CATEGORY_LABELS[e.category]}:{" "}
                {e.winners.map((w, wi) => (
                  <span key={wi}>
                    {wi > 0 && ", "}
                    {w.playerName} ({formatSek(w.amount)})
                  </span>
                ))}
                {e.carriedIn > 0 && (
                  <span className="text-stone-400">
                    {" "}
                    – varav {Math.round(e.carriedIn).toLocaleString("sv-SE")} kr rullat in
                  </span>
                )}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

function LiveTotalsTable({ live }: { live: LiveBokslut }) {
  const names = Object.keys(live.totals).sort(
    (a, b) =>
      Object.values(live.totals[b]).reduce((x, y) => x + (y ?? 0), 0) -
      Object.values(live.totals[a]).reduce((x, y) => x + (y ?? 0), 0)
  );

  if (names.length === 0) {
    return (
      <p className="rounded-xl bg-tdg-gray-light p-6 text-sm text-stone-500">
        Inga rondresultat registrerade än.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-stone-500">
          <tr>
            <th className="px-4 py-2 font-medium">Spelare</th>
            {RESULT_CATEGORIES.map((cat) => (
              <th key={cat} className="px-4 py-2 font-medium">
                {CATEGORY_LABELS[cat]}
              </th>
            ))}
            <th className="px-4 py-2 font-medium">Totalt vunnet</th>
          </tr>
        </thead>
        <tbody>
          {names.map((playerId) => {
            const row = live.totals[playerId];
            const sum = Object.values(row).reduce((a, b) => a + (b ?? 0), 0);
            return (
              <tr key={playerId} className="border-t border-stone-100">
                <td className="px-4 py-2">
                  <LivePlayerLink playerId={playerId} playerName={getPlayer(playerId)?.fullName ?? playerId} />
                </td>
                {RESULT_CATEGORIES.map((cat) => (
                  <td key={cat} className="px-4 py-2 text-stone-600">
                    {row[cat] ? formatSek(row[cat]!, { unit: false }) : "–"}
                  </td>
                ))}
                <td className="px-4 py-2 font-semibold">{formatSek(sum, { unit: false })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Kolumnlayout omgjord 2026-09-23 efter Davids skiss ("Utlägg_Betting_
// Avräkning uppställning o logik.xlsx") - tre grupperade sektioner
// (Primära spel (Alla) / Sidospel (Valfri) / Gemensamt) istället för en platt
// kolumnrad, för att göra det tydligare hur de olika insats-/utläggs-/
// vinstsummorna som registreras i Betz & Expz hänger ihop med
// slutsummeringen. Se LiveSettlementRow i liveBokslut.ts för fältresonemanget.
function LiveSettlementTable({ live }: { live: LiveBokslut }) {
  const rows = [...live.settlement].sort((a, b) => b.justeringTotal - a.justeringTotal);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-400">
        Data saknas
      </div>
    );
  }

  const settlement = settlementDisplay(rows.map((r) => ({ ...r, justering: r.justeringTotal })));

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-500">
            <tr>
              <th rowSpan={2} className="border-b border-stone-200 px-4 py-2 align-bottom font-medium">
                Spelare
              </th>
              <th colSpan={5} className="border-b border-stone-200 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-stone-400">
                Primära spel (Alla)
              </th>
              <th colSpan={2} className="border-b border-l border-stone-200 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-stone-400">
                Sidospel (Valfri)
              </th>
              <th colSpan={2} className="border-b border-l border-stone-200 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-stone-400">
                Gemensamt
              </th>
            </tr>
            <tr>
              <th className="border-b border-stone-200 px-4 py-2 font-medium">Utlägg</th>
              <th className="border-b border-stone-200 px-4 py-2 font-medium">Golfbetting Insats</th>
              <th className="border-b border-stone-200 px-4 py-2 font-medium">
                Snitt gemensamma kostnader
                <InfoTooltip
                  variant="light"
                  label="Om snitt gemensamma kostnader"
                  text="Gruppens totala utlägg + golfinsatser, delat jämnt över samtliga aktiva spelare - istället för att bara dra av var och ens egna, ojämna belopp. Samma summa för alla."
                />
              </th>
              <th className="border-b border-stone-200 px-4 py-2 font-medium">Golfbetting Vinster</th>
              <th className="border-b border-stone-200 px-4 py-2 font-medium">
                Justering primär
                <InfoTooltip
                  variant="light"
                  label="Om justering primär"
                  text="Utlägg + Snitt gemensamma kostnader + Golfbetting Vinster."
                />
              </th>
              <th className="border-b border-l border-stone-200 px-4 py-2 font-medium">Sweepstake (netto)</th>
              <th className="border-b border-stone-200 px-4 py-2 font-medium">Poker (netto)</th>
              <th className="border-b border-l border-stone-200 px-4 py-2 font-medium">
                Justering total
                <InfoTooltip
                  variant="light"
                  label="Om justering total"
                  text="Justering primär + Sweepstake + Poker. Positivt = ska få pengar, negativt = ska betala."
                />
              </th>
              <th className="border-b border-stone-200 px-4 py-2 font-medium">
                Avräkning
                <InfoTooltip
                  variant="light"
                  label="Om avräkning"
                  text="Vem som ska betala vem för att nollställa Justering total. En del av golfbetting-/sweepstake-potten kan ännu inte kopplas till en specifik mottagare (fler rondresultat saknas) - märks då TBD, och löser sig automatiskt allteftersom fler rundor registreras."
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerId} className="border-t border-stone-100">
                <td className="px-4 py-2">
                  <LivePlayerLink playerId={r.playerId} playerName={r.playerName} />
                </td>
                <td className="px-4 py-2 text-stone-600">{formatSek(r.utlagg, { unit: false })}</td>
                <td className="px-4 py-2 text-stone-600">{formatSek(r.golfInsats, { unit: false })}</td>
                <td className="px-4 py-2 text-stone-600">{formatSek(r.sharedCost, { unit: false })}</td>
                <td className="px-4 py-2 text-stone-600">{formatSek(r.golfbettingVinster, { unit: false })}</td>
                <td
                  className={
                    "px-4 py-2 font-medium " + (r.justeringPrimar >= 0 ? "text-tdg-green" : "text-red-600")
                  }
                >
                  {formatSek(r.justeringPrimar, { unit: false })}
                </td>
                <td className="px-4 py-2 border-l border-stone-100 text-stone-600">{formatSek(r.sweepstake, { unit: false })}</td>
                <td className="px-4 py-2 text-stone-600">{formatSek(r.poker, { unit: false })}</td>
                <td
                  className={
                    "px-4 py-2 border-l border-stone-100 font-semibold " +
                    (r.justeringTotal >= 0 ? "text-tdg-green" : "text-red-600")
                  }
                >
                  {formatSek(r.justeringTotal, { unit: false })}
                </td>
                <td className="px-4 py-2 text-stone-500">{settlement.textByPlayer[r.playerId]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {settlement.hasOutstanding && (
        <p className="text-xs text-stone-400">
          TBD = den delen av golfbetting-/sweepstake-potten är insatt men ännu inte utbetald till
          en specifik vinnare (fler rondresultat saknas) - avräkningen uppdateras automatiskt
          allteftersom fler rundor registreras.
        </p>
      )}
    </div>
  );
}

function PlayerBadge({ nickname }: { nickname: string }) {
  const { player, isUnknown } = resolveBusinessPlayer(nickname);
  if (isUnknown) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-medium">{nickname}</span>
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
          okänd
        </span>
      </span>
    );
  }
  return (
    <Link href={`/spelare/${player.id}`} className="font-medium text-tdg-green hover:underline">
      {nickname}
    </Link>
  );
}

function RoundCard({ business, round }: { business: BusinessYear; round: number }) {
  const roundData = business.rounds.find((r) => r.round === round);
  if (!roundData) return null;

  const edition = getEdition(business.year);
  const course = edition ? getMainSection(edition)?.courses[round - 1] : undefined;

  return (
    <div className="overflow-hidden rounded-xl bg-tdg-gray-light">
      <div className="bg-tdg-green-dark px-4 py-2 text-sm font-semibold text-white">
        Runda {round}
        {course && <span className="ml-2 font-normal text-white/70">· {course}</span>}
      </div>
      <div className="grid divide-y divide-white sm:grid-cols-3 sm:divide-x sm:divide-y-0 lg:grid-cols-6">
        {CATEGORY_ORDER.map((cat) => {
          const wins = roundData.wins.filter((w) => w.category === cat);
          return (
            <div key={cat} className="px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
                {CATEGORY_LABELS[cat]}
              </div>
              {wins.length === 0 ? (
                <div className="mt-1 text-sm text-stone-400">–</div>
              ) : (
                <div className="mt-1 flex flex-col gap-1.5">
                  {wins.map((w, i) => (
                    <div key={i} className="flex flex-col text-sm leading-tight">
                      <PlayerBadge nickname={w.nickname} />
                      <span className="text-xs text-stone-600">{formatSek(w.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TotalsTable({ business }: { business: BusinessYear }) {
  const totals = getCategoryTotals(business);
  const names = Object.keys(totals).sort(
    (a, b) =>
      Object.values(totals[b]).reduce((x, y) => x + (y ?? 0), 0) -
      Object.values(totals[a]).reduce((x, y) => x + (y ?? 0), 0)
  );

  return (
    <div className="overflow-x-auto overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-stone-500">
          <tr>
            <th className="px-4 py-2 font-medium">Spelare</th>
            {CATEGORY_ORDER.map((cat) => (
              <th key={cat} className="px-4 py-2 font-medium">
                {CATEGORY_LABELS[cat]}
              </th>
            ))}
            <th className="px-4 py-2 font-medium">Totalt vunnet</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => {
            const row = totals[name];
            const sum = Object.values(row).reduce((a, b) => a + (b ?? 0), 0);
            return (
              <tr key={name} className="border-t border-stone-100">
                <td className="px-4 py-2">
                  <PlayerBadge nickname={name} />
                </td>
                {CATEGORY_ORDER.map((cat) => (
                  <td key={cat} className="px-4 py-2 text-stone-600">
                    {row[cat] ? formatSek(row[cat]!, { unit: false }) : "–"}
                  </td>
                ))}
                <td className="px-4 py-2 font-semibold">{formatSek(sum, { unit: false })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SettlementTable({ business }: { business: BusinessYear }) {
  const rows = getSettlement(business).sort((a, b) => b.justering - a.justering);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-400">
        Data saknas
      </div>
    );
  }

  return (
    <div className="overflow-x-auto overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-stone-500">
          <tr>
            <th className="px-4 py-2 font-medium">Spelare</th>
            <th className="px-4 py-2 font-medium">Utlägg</th>
            <th className="px-4 py-2 font-medium">Poker</th>
            <th className="px-4 py-2 font-medium">Betting</th>
            <th className="px-4 py-2 font-medium">Betting totalt</th>
            <th className="px-4 py-2 font-medium">Justering</th>
            <th className="px-4 py-2 font-medium">Avräkning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.nickname} className="border-t border-stone-100">
              <td className="px-4 py-2">
                <PlayerBadge nickname={r.nickname} />
              </td>
              <td className="px-4 py-2 text-stone-600">{r.utlagg.toLocaleString("sv-SE")}</td>
              <td className="px-4 py-2 text-stone-600">{formatSek(r.poker, { unit: false })}</td>
              <td className="px-4 py-2 text-stone-600">{formatSek(r.betting, { unit: false })}</td>
              <td className="px-4 py-2 font-medium text-stone-700">
                {formatSek(r.poker + r.betting, { unit: false })}
              </td>
              <td
                className={
                  "px-4 py-2 font-semibold " +
                  (r.justering >= 0 ? "text-tdg-green" : "text-red-600")
                }
              >
                {formatSek(r.justering, { unit: false })}
              </td>
              <td className="px-4 py-2 text-stone-500">{r.note ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function BettingBusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = await searchParams;
  const allYears = getAllBusinessYears();
  const yearsWithData = getBusinessYears();
  // Pågående säsong, hämtad live från Supabase (David bad om detta
  // 2026-09-22) - visas som standardår när ingen ?year= anges, och som en
  // egen, tydligt märkt gren av sidan istället för de arkiverade
  // business-*.json-åren nedan. `null` om databasen (mot förmodan) inte har
  // någon öppen edition-rad - då faller sidan tillbaka på tidigare beteende.
  const live = await getLiveBokslut();
  const requestedYear = Number(resolvedSearchParams?.year);
  const defaultYear = live?.year ?? yearsWithData[0];
  const year = allYears.includes(requestedYear) ? requestedYear : defaultYear;
  const isLiveYear = live !== null && live.year === year;
  const business = getBusinessYear(year);

  // "Totalt pengaflöde per år"-diagrammet kompletteras med TDG 2026 och
  // framåt (öppen ELLER stängd säsong) direkt från Supabase - David bad om
  // detta 2026-09-23. De äldre åren kommer fortfarande oförändrat från de
  // statiska business-*.json-filerna (getYearlyTotals), se
  // getSupabaseSeasonStats i liveBokslut.ts för det fullständiga resonemanget.
  const supabaseSeasonStats = await getSupabaseSeasonStats();
  const yearlyTotals = [
    ...getYearlyTotals(),
    ...supabaseSeasonStats.map((s) => ({
      year: s.year,
      bettingTotal: s.bettingTotal,
      utlaggTotal: s.utlaggTotal,
    })),
  ];
  const chartMaxYear = supabaseSeasonStats.length
    ? Math.max(EDITIONS_MAX_YEAR, ...supabaseSeasonStats.map((s) => s.year))
    : EDITIONS_MAX_YEAR;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Bokslut</h1>
        <p className="mt-1 max-w-2xl text-stone-500">
          Golfbetting rond för rond, pokerresultat, utlägg och vem som ska betala vem –
          samlat på ett ställe per resa.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Totalt pengaflöde per år - vinstpengar & utlägg
        </h2>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <DualAxisLineChart
            left={{
              data: yearlyTotals.map((d) => ({ year: d.year, value: d.bettingTotal })),
              color: "#065f46",
              label: "Betting-vunnet totalt",
              format: "sek",
            }}
            right={{
              data: yearlyTotals.map((d) => ({ year: d.year, value: d.utlaggTotal })),
              color: "#b45309",
              label: "Utlägg totalt",
              format: "sek",
            }}
            yearDomain={{ minYear: EDITIONS_MIN_YEAR, maxYear: chartMaxYear }}
          />
        </div>
      </section>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        Välj år -{">"} detaljer nedanför
      </h2>
      <div className="flex flex-wrap gap-2 text-sm">
        {allYears.map((y) => {
          const hasData = yearsWithData.includes(y);
          const isSelected = y === year;
          const isLive = live !== null && live.year === y;
          return (
            <Link
              key={y}
              href={`/betting-business?year=${y}`}
              className={
                "relative min-w-16 rounded-xl px-3 py-2 text-center font-semibold transition " +
                (isSelected
                  ? isLive
                    ? "bg-tdg-yellow text-tdg-green-dark"
                    : "bg-tdg-green-dark text-white"
                  : isLive
                    ? "bg-tdg-green-dark/10 text-tdg-green-dark ring-1 ring-inset ring-tdg-green-dark hover:shadow-sm"
                    : hasData
                      ? "bg-tdg-gray-light text-tdg-green hover:shadow-sm"
                      : "bg-tdg-gray-light text-stone-400 hover:shadow-sm")
              }
            >
              {y}
              {isLive && (
                <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wide">
                  Pågår
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {isLiveYear && live ? (
        <>
          <div className="flex flex-col gap-1 rounded-xl bg-tdg-green-dark p-4 text-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="flex items-center text-xs font-semibold uppercase tracking-wide text-tdg-yellow">
                Pågående säsong
                <InfoTooltip
                  label="Om pågående säsong"
                  text={`Siffrorna byggs löpande från registring i Betz & Expz. Först när säsongen avslutas via "Bokslut ${live.year}" så får vi en komplett avräkning.`}
                />
              </span>
              <p className="mt-0.5 text-lg font-bold">
                TDG {live.year} <span className="font-normal text-white/80">– ej avslutad</span>
              </p>
            </div>
            <p className="text-sm text-white/80">
              {live.entryCount} {live.entryCount === 1 ? "post" : "poster"} registrerade hittills
              i Betz &amp; Expz.
            </p>
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Betting rond för rond
            </h2>
            {live.rounds.length === 0 ? (
              <p className="rounded-xl bg-tdg-gray-light p-6 text-sm text-stone-500">
                Inga rondresultat registrerade än.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {live.rounds.map((r) => (
                  <LiveRoundCard
                    key={r.round}
                    round={r}
                    courses={live.courses}
                    sweepstakeEvents={live.sweepstakeEvents}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Betting totalt {live.year}
            </h2>
            <LiveTotalsTable live={live} />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="flex items-center text-sm font-semibold uppercase tracking-wide text-stone-500">
              Utlägg, betting & avräkning {live.year}
              <InfoTooltip
                variant="light"
                label="Om betting och avräkning"
                text="Golfbetting är obligatoriskt för alla i upplagan. Poker och Sweepstake är frivilliga - regleras direkt mellan de som deltog i just den satsningen, och påverkar aldrig gruppens snittutlägg. Preliminärt tills säsongen avslutas."
              />
            </h2>
            <LiveSettlementTable live={live} />
          </section>
        </>
      ) : !business ? (
        <p className="text-stone-500">Ingen data för {year} ännu.</p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Betting rond för rond
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {business.rounds.map((r) => (
                <RoundCard key={r.round} business={business} round={r.round} />
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Betting totalt {year}
            </h2>
            <TotalsTable business={business} />
            <p className="text-xs text-stone-400">
              Insats: {business.stakePerPlayer.toLocaleString("sv-SE")} kr per spelare.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="flex items-center text-sm font-semibold uppercase tracking-wide text-stone-500">
              Utlägg, betting & avräkning {year}
              <InfoTooltip
                variant="light"
                label="Om betting och avräkning"
                text="Golfbetting är obligatoriskt för alla i upplagan. Poker är frivilligt - regleras direkt mellan de som deltog, och påverkar aldrig gruppens snittutlägg."
              />
            </h2>
            <SettlementTable business={business} />
          </section>

          {(() => {
            const unknown = getUnknownParticipants(business);
            if (unknown.length === 0) return null;
            return (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Smeknamnet {unknown.map((n) => `"${n}"`).join(", ")} i källfilen kunde inte
                kopplas till någon av de 9 kända spelarna automatiskt – flaggat som
                &quot;okänd&quot; ovan tills det är bekräftat.
              </p>
            );
          })()}
        </>
      )}
    </div>
  );
}
