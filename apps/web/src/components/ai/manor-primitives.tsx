import "./manor-primitives.css";

/** Manor's pill button. Upstream dropped it from primitives; Manor's CRM and Workspace screens still use it. */
export function BuiButton({
  children,
  onClick,
  disabled,
  tone = "neutral",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "accent";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors duration-150 disabled:opacity-60"
      style={
        tone === "accent"
          ? { background: "var(--bui-accent)", color: "#090a12" }
          : {
              background: "var(--bui-hover)",
              color: "var(--bui-ink)",
              boxShadow: "var(--bui-shadow-btn)",
            }
      }
    >
      {children}
    </button>
  );
}
