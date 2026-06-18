import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "./AuthContext";

const LS_KEY = "devticket_org_sel";

export interface OrgEntry { id: string; name: string }

interface OrgContextValue {
  orgs: OrgEntry[];
  selectedOrgId: string | null;
  selectedOrgName: string;
  setSelectedOrg: (id: string | null) => void;
}

const OrgContext = createContext<OrgContextValue>({
  orgs: [],
  selectedOrgId: null,
  selectedOrgName: "すべての組織",
  setSelectedOrg: () => {},
});

export function useOrg() { return useContext(OrgContext); }

export function OrgProvider({ children }: { children: ReactNode }) {
  const { userRole } = useAuth();
  const isOwner = userRole === "owner";

  const [orgs, setOrgs] = useState<OrgEntry[]>([]);
  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_KEY) || null; } catch { return null; }
  });

  useEffect(() => {
    if (!isOwner || !isSupabaseEnabled) return;
    supabase!.from("organizations").select("id, name").order("name")
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        setOrgs(data);
        const saved = localStorage.getItem(LS_KEY);
        const validSaved = saved && data.find(o => o.id === saved);
        if (!validSaved) {
          // 保存済みがないか無効な場合は先頭を選択
          const firstId = data[0].id;
          setSelectedOrgIdState(firstId);
          try { localStorage.setItem(LS_KEY, firstId); } catch {}
        }
      });
  }, [isOwner]);

  const setSelectedOrg = (id: string | null) => {
    setSelectedOrgIdState(id);
    try {
      if (id) localStorage.setItem(LS_KEY, id);
      else localStorage.removeItem(LS_KEY);
    } catch {}
  };

  const selectedOrgName = orgs.find(o => o.id === selectedOrgId)?.name ?? "すべての組織";

  return (
    <OrgContext.Provider value={{ orgs, selectedOrgId, selectedOrgName, setSelectedOrg }}>
      {children}
    </OrgContext.Provider>
  );
}
