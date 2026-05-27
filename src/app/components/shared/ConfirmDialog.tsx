import { DialogShell } from "./DialogShell";
import { BtnSecondary } from "./BtnSecondary";

export function ConfirmDialog({ message, onConfirm, onClose }: { message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <DialogShell title="削除の確認" onClose={onClose}
      footer={<>
        <BtnSecondary onClick={onClose}>キャンセル</BtnSecondary>
        <button type="button" onClick={() => { onConfirm(); onClose(); }}
          style={{ padding:"9px 20px", background:"#DC2626", color:"#fff", fontSize:13, fontWeight:700, borderRadius:10, border:"none", cursor:"pointer", boxShadow:"0 2px 8px rgba(220,38,38,0.30)" }}>
          削除する
        </button>
      </>}>
      <p style={{ fontSize:14, color:"#1A1714", lineHeight:1.7 }}>{message}</p>
      <p style={{ fontSize:12, color:"#A09790" }}>この操作は取り消せません。</p>
    </DialogShell>
  );
}
