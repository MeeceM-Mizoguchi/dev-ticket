// Topbar に置く通話アイコン。クリックで発信ダイアログを開く。
import { useState } from "react";
import { Phone } from "lucide-react";
import { StartCallDialog } from "./StartCallDialog";
import { useCall } from "@/app/contexts/CallContext";

export function CallButton() {
  const [open, setOpen] = useState(false);
  const { call } = useCall();
  const inCall = !!call;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={inCall ? "通話中" : "音声通話を発信"}
        style={{ position: "relative", width: 34, height: 34, borderRadius: 9, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: inCall ? "rgba(5,150,105,0.1)" : "transparent", transition: "background 0.15s" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = inCall ? "rgba(5,150,105,0.1)" : "transparent"; }}>
        <Phone style={{ width: 15, height: 15, color: inCall ? "#059669" : "#9E9690" }} />
        {inCall && <span style={{ position: "absolute", top: 5, right: 5, width: 7, height: 7, borderRadius: "50%", background: "#22C55E", border: "1.5px solid #fff" }} />}
      </button>
      {open && <StartCallDialog onClose={() => setOpen(false)} />}
    </>
  );
}
