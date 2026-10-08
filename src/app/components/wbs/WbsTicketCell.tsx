// ENHA2-053 WBSの表の「チケット」列の中身。
//
// その行に紐づいたチケットを、チケット番号のチップで並べる。チップを押すと詳細パネルが開く。
// 行の高さは固定なので、セルに並べるのは2件まで。残りは「+n」を押すと一覧で出す。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import type { WbsTicketRef } from "./WbsTicketLinkDialog";

const MAX_INLINE = 2;

const chipStyle = {
  display: "inline-flex", alignItems: "center", height: 20, padding: "0 6px", fontSize: 11, fontWeight: 700,
  color: "#047857", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 5, cursor: "pointer",
  whiteSpace: "nowrap", fontFamily: "var(--font-mono)", flexShrink: 0,
} as const;

function Chip({ t, onOpen }: { t: WbsTicketRef; onOpen: (id: string) => void }) {
  return (
    // マウスを乗せるとタイトルが分かる
    <button type="button" title={t.ticket.title} onClick={() => onOpen(t.ticket.id)} style={chipStyle}>
      {t.ticket.wbs}
    </button>
  );
}

export function WbsTicketCell({ tickets, canEdit, onOpen, onAdd }: {
  tickets: WbsTicketRef[];
  canEdit: boolean;
  onOpen: (ticketId: string) => void;
  /** 「＋」を押したとき（チケット紐づけダイアログを開く） */
  onAdd: () => void;
}) {
  const moreRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<{ top: number; left: number } | null>(null);

  // 一覧は、外側を押す・スクロールする・Esc のいずれかで閉じる
  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || moreRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pop]);

  const inline = tickets.slice(0, MAX_INLINE);
  const rest = tickets.slice(MAX_INLINE);

  const toggleMore = () => {
    if (pop) { setPop(null); return; }
    const rect = moreRef.current?.getBoundingClientRect();
    if (rect) setPop({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 340) });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", minWidth: 0, overflow: "hidden" }}>
      {inline.map(t => <Chip key={t.ticket.id} t={t} onOpen={onOpen} />)}
      {rest.length > 0 && (
        <button ref={moreRef} type="button" onClick={toggleMore} title={`ほか ${rest.length} 件を表示`}
          style={{ ...chipStyle, color: "#4B5563", background: "#F3F4F6", border: "1px solid #E5E7EB", fontFamily: "inherit" }}>
          +{rest.length}
        </button>
      )}
      {canEdit && (
        <button type="button" onClick={onAdd} title="チケットを紐づける" aria-label="チケットを紐づける"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, color: "#6B6458", background: "transparent", border: "1px dashed #C9CED6", borderRadius: 5, cursor: "pointer", flexShrink: 0 }}>
          <Plus style={{ width: 11, height: 11 }} />
        </button>
      )}

      {pop && createPortal(
        <div ref={popRef} style={{ position: "fixed", top: pop.top, left: pop.left, zIndex: 250, width: 320, maxHeight: 260, overflowY: "auto", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.14)", padding: 6 }}>
          {tickets.map(t => (
            <button key={t.ticket.id} type="button" onClick={() => { setPop(null); onOpen(t.ticket.id); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", textAlign: "left", background: "transparent", border: "none", borderRadius: 6, cursor: "pointer" }}>
              <span style={{ ...chipStyle, cursor: "inherit" }}>{t.ticket.wbs}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.ticket.title}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
