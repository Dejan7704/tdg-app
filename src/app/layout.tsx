import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tour De Golf (TDG)",
  description: "Historik, statistik och betting för Tour De Golf",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sv">
      <body className="min-h-screen bg-white text-stone-900 antialiased">
        <header className="relative z-10 border-b border-stone-200 bg-white">
          <div className="relative mx-auto max-w-5xl px-4">
            {/* Loggan är medvetet mycket större än header-raden och
                positioneras absolut, så den får hänga ned över innehållet
                nedanför (t.ex. den gröna välkomstrutan på Hem) utan att
                själv styra header-radens höjd. Den ligger utanför flödet,
                så nav-raden reserverar istället vänsterutrymme åt den
                (pl-*) och skjuts till höger. Positionerad relativt samma
                mx-auto/max-w-5xl-container som sidans innehåll, så den
                riktar in sig mot samma vänsterkant som t.ex. hero-rutan. */}
            <Link href="/" className="absolute left-4 top-2 z-10">
              <Image
                src="/brand/logo.png"
                alt="Tour De Golf"
                width={200}
                height={200}
                className="h-24 w-24 drop-shadow-lg sm:h-36 sm:w-36"
                priority
              />
            </Link>
            <div className="flex items-center justify-end gap-1 py-3 pl-28 sm:pl-44">
              <NavLinks />
            </div>
          </div>
        </header>
        {/* Extra utrymme upptill (pt-28) så loggans nedhäng (upp till 144px
            hög + 8px offset = kan gå ner till ~152px från sidans topp)
            aldrig skymmer rubriker på sidor utan hero-ruta (t.ex.
            Historik/Spelare/Bokslut) - även korta rubriker som
            annars hade hamnat helt bakom loggan. Hem-sidans gröna ruta drar
            upp sig själv med en större negativ marginal för att ändå få
            loggan att hänga ned över den, se page.tsx. */}
        <main className="mx-auto max-w-5xl px-4 pb-8 pt-28">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-8 pt-4 text-xs text-stone-400">
          Tour De Golf – sedan 2004
        </footer>
      </body>
    </html>
  );
}
