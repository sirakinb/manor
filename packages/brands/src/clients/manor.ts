import type { BrandConfig } from "../index.js";

export const manor: BrandConfig = {
  id: "manor",
  name: "Manor",
  title: "Manor",
  hostnames: ["manor.pentridgemedia.com"],
  // Manor is the default look: tokens.css already carries its palette.
  colors: {},
  logo: { src: "/manor-mark.png", alt: "Manor" },
  favicon: "/favicon.ico",
  appleTouchIcon: "/apple-touch-icon.png",
  icon192: "/icon-192.png",
  icon512: "/icon-512.png",
};
