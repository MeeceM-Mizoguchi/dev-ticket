// ENHA2-053 WBSの名前を入力するダイアログ（新規作成・名前変更で共通）。
import { useRef, useState } from "react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { submitOnEnter } from "@/app/lib/submitKey";
import { inputCls, labelCls } from "@/app/lib/helpers";

export function WbsSheetNameDialog({ mode, initialName, onSubmit, onClose }: {
  mode: "create" | "rename";
  initialName: string;
  /** 保存できたら true を返す。false のときはダイアログを開いたままにする */
  onSubmit: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  // 連打・Enter とボタンの同時押しで二重に作らないためのガード（state だけだとすり抜ける）
  const savingRef = useRef(false);
  const trimmed = name.trim();
  const canSave = !!trimmed && !saving;

  const handleSave = async () => {
    if (!trimmed || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (await onSubmit(trimmed)) onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <DialogShell title={mode === "create" ? "新しいWBSを作成" : "WBSの名前を変更"} size="sm" minHeight={0}
      onClose={saving ? () => {} : onClose} busy={saving}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
        <BtnPrimary onClick={handleSave} disabled={!trimmed} loading={saving}>{mode === "create" ? "作成する" : "変更する"}</BtnPrimary>
      </>}>
      <div>
        <label className={labelCls}>WBSの名前</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80}
          placeholder="例：リプレイス計画"
          onKeyDown={submitOnEnter(handleSave, { enabled: canSave })}
          className={inputCls} />
      </div>
      {mode === "create" && (
        <p style={{ fontSize: 12, color: "#A09790", lineHeight: 1.7 }}>
          3段（大項目・中項目・小項目）、プロジェクトの全メンバーに公開、既定の5つのステータスで始まります。あとから変更できます。
        </p>
      )}
    </DialogShell>
  );
}
