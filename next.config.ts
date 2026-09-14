import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ingen bildoptimeringsserver antagen ännu (okänt värdskap) - undvik att
  // näste build kräver `sharp` eller en bild-CDN för de fåtal statiska
  // spelarporträtt vi lägger till i public/players/.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
