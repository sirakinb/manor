import type { BrandConfig } from "../index.js";

export const jrh: BrandConfig = {
  id: "jrh",
  name: "Jackson Rental Homes",
  title: "Jackson Rental Homes",
  hostnames: ["jrhmanor.agentworkspace.cloud"],
  // Teal-dark take on the Manor shell, drawn from jacksonrentalhomesllc.com
  // (#004f4f primary teal, #0b2d2d deep teal, warm neutrals).
  colors: {
    page: "#041010",
    sidebar: "#071615",
    main: "#081817",
    panel: "#051312",
    hairline: "#14302d",
    "hairline-strong": "#1e4440",
    surface: "#0d2422",
    "surface-2": "#123230",
    accent: "#1f8a8a",
    "accent-strong": "#17706f",
    "accent-soft": "#7fc7c4",
  },
  logo: { src: "/brands/jrh/mark-white.png", alt: "Jackson Rental Homes", wide: true },
  favicon: "/brands/jrh/favicon.png",
  appleTouchIcon: "/brands/jrh/apple-touch-icon.png",
  icon192: "/brands/jrh/icon-192.png",
  icon512: "/brands/jrh/icon-512.png",
};
