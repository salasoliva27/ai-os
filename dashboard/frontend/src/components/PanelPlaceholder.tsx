interface PanelPlaceholderProps {
  name: string;
  icon?: string;
}

export function PanelPlaceholder({ name, icon }: PanelPlaceholderProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg-secondary)",
        color: "var(--color-text-muted)",
        fontFamily: "var(--font-family-mono)",
        fontSize: "14px",
        userSelect: "none",
      }}
    >
      {icon && <span style={{ marginRight: "8px", fontSize: "18px" }}>{icon}</span>}
      {name}
    </div>
  );
}
