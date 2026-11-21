// Runs before first paint, as a file because the app's CSP blocks inline scripts.
// Manor is dark only for now (PINNED_APPEARANCE in src/lib/ui-appearance.ts), whatever the
// system or a stored preference asks for.
(() => {
  const theme = "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#0a0a0a");
  // macOS draws regular text at 420 (see --font-weight-normal); iPads report a Mac platform too.
  const nav = typeof navigator === "object" ? navigator : undefined;
  if (nav && /^Mac/.test(nav.platform || "") && !(nav.maxTouchPoints > 1)) {
    document.documentElement.dataset.os = "mac";
  }
})();
