// Runs before first paint, as a file because the app's CSP blocks inline scripts.
// Manor is dark only for now (PINNED_APPEARANCE in src/lib/ui-appearance.ts), whatever the
// system or a stored preference asks for.
(() => {
  const theme = "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#fcfcfc" : "#0a0a0a");
})();
