import { useState, type ReactNode } from "react";

type Placement = "top" | "bottom" | "bottom-left" | "bottom-right";

const PLACEMENTS: Record<Placement, {
  box: React.CSSProperties;
  arrow: React.CSSProperties;
}> = {
  top: {
    box: { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    arrow: { top: "100%", left: "50%", transform: "translateX(-50%)", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "6px solid #1A1714" },
  },
  bottom: {
    box: { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    arrow: { bottom: "100%", left: "50%", transform: "translateX(-50%)", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "6px solid #1A1714" },
  },
  "bottom-left": {
    box: { top: "calc(100% + 8px)", right: 0 },
    arrow: { bottom: "100%", right: 14, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "6px solid #1A1714" },
  },
  "bottom-right": {
    box: { top: "calc(100% + 8px)", left: 0 },
    arrow: { bottom: "100%", left: 14, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "6px solid #1A1714" },
  },
};

export function PlanTooltip({ text, children, active = true, placement = "bottom-left" }: {
  text: string;
  children: ReactNode;
  active?: boolean;
  placement?: Placement;
}) {
  const [show, setShow] = useState(false);

  if (!active) return <>{children}</>;

  const p = PLACEMENTS[placement];

  return (
    <div
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: "absolute",
          ...p.box,
          background: "#1A1714",
          color: "#fff",
          fontSize: 11,
          fontWeight: 600,
          padding: "5px 10px",
          borderRadius: 7,
          whiteSpace: "nowrap",
          pointerEvents: "none",
          zIndex: 9999,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        }}>
          {text}
          <div style={{
            position: "absolute",
            width: 0,
            height: 0,
            ...p.arrow,
          }} />
        </div>
      )}
    </div>
  );
}
