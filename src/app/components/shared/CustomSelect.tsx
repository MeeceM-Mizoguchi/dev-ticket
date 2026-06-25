import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Plus } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  color?: string;
  bg?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  // 新規項目をバックエンドに追加するための関数
  onAddOption?: (newLabel: string) => Promise<string | null>;
}

export function CustomSelect({ value, options, onChange, placeholder = "選択してください", onAddOption }: Props) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(o => o.value === value);

  // インライン追加機能用のステートとRef
  const [isInputMode, setIsInputMode] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      setIsInputMode(false);
      setInputValue("");
    }
    setOpen(o => !o);
  };

  // 新規項目を実際にコミットする処理
  const handleAddSubmit = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isAdding) return;

    setIsAdding(true);
    try {
      if (onAddOption) {
        const newId = await onAddOption(trimmed);
        if (newId) {
          onChange(newId); // 新しく追加された項目を選択状態にする
        }
      } else {
        onChange(trimmed);
      }
      setOpen(false); // プルダウンを閉じる
    } catch (err) {
      console.error("Failed to add option:", err);
    } finally {
      setIsAdding(false);
      setIsInputMode(false);
      setInputValue("");
    }
  };

  // キーボード（Enter）イベントハンドラー
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 注意点: IME入力中の変換確定 Enterの時は発火させない
    if (e.nativeEvent.isComposing || e.key !== "Enter") return;
    
    e.preventDefault();
    handleAddSubmit();
  };

  // 入力モードに切り替わったら自動でテキストボックスにフォーカスを当てる
  useEffect(() => {
    if (isInputMode) {
      inputRef.current?.focus();
    }
  }, [isInputMode]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // 🌟 修正: スクリロール時に勝手に閉じてしまうバグを修正
  useEffect(() => {
    if (!open) return;
    const h = (e: Event) => {
      // スクロールされた要素が、プルダウンのリスト（dropdownRef）の内部だった場合は閉じずにスルーする
      if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("scroll", h, true); // キャプチャモードで外側のスクロールを監視
    window.addEventListener("resize", h);
    return () => {
      window.removeEventListener("scroll", h, true);
      window.removeEventListener("resize", h);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px",
          background: open ? "#FFF" : "#F7F8F9",
          border: `1.5px solid ${open ? "rgba(5,150,105,0.5)" : "rgba(26,23,20,0.12)"}`,
          borderRadius: 9, cursor: "pointer", outline: "none",
          boxShadow: open ? "0 0 0 3px rgba(5,150,105,0.08)" : "none",
          transition: "all 0.15s", textAlign: "left" as const,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {selected ? (
            selected.color ? (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 13, fontWeight: 500, color: "#1A1714", whiteSpace: "nowrap",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: selected.color, display: "inline-block", flexShrink: 0 }} />
                {selected.label}
              </span>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 500, color: "#1A1714", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{selected.label}</span>
            )
          ) : (
            <span style={{ fontSize: 13, color: "#C9C4BB", whiteSpace: "nowrap" }}>{placeholder}</span>
          )}
        </span>
        <ChevronDown style={{
          width: 12, height: 12, color: "#B0A9A4", flexShrink: 0,
          transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s",
        }} />
      </button>

      {open && dropPos && (
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            zIndex: 9999,
            background: "#FFF",
            border: "1px solid rgba(26,23,20,0.12)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            overflow: "hidden",
            maxHeight: "320px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 選択肢リストの領域（ここだけがスクロールする） */}
          <div style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
            {options.map(opt => {
              const isSel = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(v => opt.value); onChange(opt.value); setOpen(false); }}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "9px 12px",
                    background: isSel ? "#ECFDF5" : "transparent",
                    border: "none", cursor: "pointer", textAlign: "left" as const,
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSel ? "#ECFDF5" : "transparent"; }}
                >
                  {opt.color ? (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 13, fontWeight: 500, color: "#1A1714", flex: 1,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: opt.color, display: "inline-block", flexShrink: 0 }} />
                      {opt.label}
                    </span>
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 500, color: isSel ? "#059669" : "#1A1714", flex: 1 }}>{opt.label}</span>
                  )}
                  {isSel && <Check style={{ width: 12, height: 12, color: "#059669", flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>

          {/* 最下部の固定配置追加エリア（その場追加を行う onAddOption を渡したプルダウンのみ表示） */}
          {onAddOption && (
          <div style={{ borderTop: "1px solid rgba(26,23,20,0.08)", background: "#FAFAF9", padding: "4px", flexShrink: 0 }}>
            {isInputMode ? (
              <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px" }}>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="新しい項目名..."
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isAdding}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    fontSize: "13px",
                    border: "1.5px solid rgba(5,150,105,0.5)",
                    borderRadius: "6px",
                    outline: "none",
                    background: "#FFF",
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddSubmit}
                  disabled={!inputValue.trim() || isAdding}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    fontWeight: 700,
                    background: inputValue.trim() ? "#059669" : "#E6E4E0",
                    color: inputValue.trim() ? "#FFF" : "#A09790",
                    border: "none",
                    borderRadius: "6px",
                    cursor: inputValue.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  {isAdding ? "..." : "追加"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsInputMode(true)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: 8,
                  padding: "9px 12px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#6B6458",
                  background: "transparent",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "all 0.1s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(26,23,20,0.04)"; (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}
              >
                <Plus style={{ width: 14, height: 14, color: "#6B6458", flexShrink: 0 }} />
                新しく追加する
              </button>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}