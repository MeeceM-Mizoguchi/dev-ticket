// ナレッジノート: フォルダ名の入力ダイアログ。
//
// window.prompt はブラウザ標準の見た目になり、アプリの中で明らかに浮く。
// 他の画面と同じ DialogShell を使う。

import { useEffect, useRef, useState } from "react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";

export function FolderNameDialog({
  mode, initialName = "", existingNames, onSubmit, onClose,
}: {
  mode: "create" | "rename";
  initialName?: string;
  /** 重複チェック用。自分自身は呼び出し側で除いておく */
  existingNames: string[];
  onSubmit: (name: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inputWrapRef = useRef<HTMLDivElement>(null);

  // 開いた直後に入力できるようにする（prompt と同じ操作感を保つ）
  useEffect(() => {
    const el = inputWrapRef.current?.querySelector("input");
    el?.focus();
    el?.select();
  }, []);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("フォルダ名を入力してください"); return; }
    if (trimmed.length > 40) { setError("40文字以内で入力してください"); return; }
    if (existingNames.some(n => n === trimmed)) { setError("同じ名前のフォルダがあります"); return; }
    setSaving(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={mode === "create" ? "フォルダを作成" : "フォルダ名を変更"}
      size="sm"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
          <BtnPrimary onClick={() => void submit()} disabled={saving || !name.trim()}>
            {saving ? "保存中..." : mode === "create" ? "作成する" : "変更する"}
          </BtnPrimary>
        </div>
      }
    >
      <div
        ref={inputWrapRef}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
        }}
      >
        <FieldInput
          label="フォルダ名"
          required
          placeholder="設計書 / 議事録 / 参考資料 など"
          value={name}
          onChange={v => { setName(v); if (error) setError(""); }}
          error={error}
        />
        <p style={{ fontSize: 11.5, color: "#A09790", marginTop: 10, lineHeight: 1.7 }}>
          資料を種類ごとに仕分けられます。フォルダのチェックを入れると、
          その中の資料をまとめて検索の対象にできます。
        </p>
      </div>
    </DialogShell>
  );
}
