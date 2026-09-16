"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Hem" },
  { href: "/historik", label: "Historik" },
  { href: "/spelare", label: "Spelare" },
  { href: "/betting-business", label: "Bokslut" },
  { href: "/utlagg", label: "Betz & Expz" },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap justify-end gap-1 text-base">
      {NAV.map((item) => {
        // "/" ska bara vara aktiv på exakt startsidan, övriga länkar
        // matchar även undersidor (t.ex. /historik/2024 markerar Historik).
        const isActive =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              "rounded-md px-4 py-2 font-medium transition hover:bg-tdg-gray-light hover:text-tdg-green " +
              (isActive ? "bg-tdg-gray-light text-tdg-green" : "text-stone-600")
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
