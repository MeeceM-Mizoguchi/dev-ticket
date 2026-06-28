import { X, Plus } from "lucide-react";
import { useTabs, MAX_TABS } from "@/app/contexts/TabContext";

// Mac/iPad 版のアプリ内タブバー。ブラウザのタブを模した見た目。
export function TabBar() {
  const tabs = useTabs();
  if (!tabs) return null;

  const { tabs: list, activeId, activateTab, closeTab, openTab } = tabs;
  const canClose = list.length > 1;
  const canAdd = list.length < MAX_TABS;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        height: 40,
        flexShrink: 0,
        padding: "0 8px",
        background: "#ECECEC",
        borderBottom: "1px solid rgba(26,23,20,0.10)",
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      {list.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            onClick={() => activateTab(t.id)}
            onAuxClick={(e) => {
              // 中クリックで閉じる(ブラウザ同等)
              if (e.button === 1 && canClose) {
                e.preventDefault();
                closeTab(t.id);
              }
            }}
            title={t.path}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              maxWidth: 220,
              minWidth: 120,
              height: 32,
              padding: "0 8px 0 12px",
              borderRadius: "10px 10px 0 0",
              background: active ? "#FFFFFF" : "transparent",
              border: active ? "1px solid rgba(26,23,20,0.10)" : "1px solid transparent",
              borderBottom: "none",
              cursor: "pointer",
              userSelect: "none",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.55)";
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: 12.5,
                fontWeight: active ? 700 : 500,
                color: active ? "#1A1714" : "#6B6458",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t.title}
            </span>
            {canClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                aria-label="タブを閉じる"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  flexShrink: 0,
                  color: "#9E9690",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(26,23,20,0.08)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <X style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        );
      })}
      {canAdd && (
        <button
          onClick={() => openTab("/dashboard")}
          aria-label="新しいタブ"
          title="新しいタブ (⌘T)"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            marginBottom: 2,
            marginLeft: 4,
            borderRadius: 8,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            flexShrink: 0,
            color: "#6B6458",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(26,23,20,0.08)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <Plus style={{ width: 16, height: 16 }} />
        </button>
      )}
    </div>
  );
}
