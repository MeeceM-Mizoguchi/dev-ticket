import { useState } from "react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";

export function SaveFilterDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const isEmpty = title.trim() === "";

  const handleSave = () => {
    if (isEmpty) { setTouched(true); return; }
    onSave(title.trim());
  };

  return (
    <DialogShell
      title="フィルタを保存"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <BtnSecondary onClick={onClose}>キャンセル</BtnSecondary>
          <BtnPrimary onClick={handleSave} disabled={isEmpty}>保存</BtnPrimary>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458" }}>
          タイトル <span style={{ color: "#DC2626" }}>*</span>
        </label>
        <input
          autoFocus
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSave(); }}
          placeholder="フィルタ名を入力"
          style={{
            width: "100%", padding: "9px 12px", fontSize: 13,
            border: `1.5px solid ${touched && isEmpty ? "#DC2626" : "rgba(26,23,20,0.15)"}`,
            borderRadius: 8, outline: "none", boxSizing: "border-box" as const,
            background: "#FAFAF9", color: "#1A1714",
          }}
        />
        {touched && isEmpty && (
          <p style={{ fontSize: 11, color: "#DC2626" }}>タイトルを入力してください</p>
        )}
      </div>
    </DialogShell>
  );
}
