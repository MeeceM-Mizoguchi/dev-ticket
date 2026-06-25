import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "./AuthContext";
import type { PlanSettings } from "@/app/types";

export const UNLIMITED_PLAN: PlanSettings = {
  id: "system-unlimited",
  name: "無制限",
  isSystem: true,
  accountExpiresAt: null,
  maxMembers: null,
  maxProjects: null,
  maxSprintsPerProject: null,
  maxTicketsPerSprint: null,
  maxImagesPerItem: null,
  maxCommentsPerTicket: null,
  maxFiltersPerSprint: null,
  featureNotifications: true,
  featureCsvExport: true,
  featureActualMonitor: true,
  featureChildTickets: true,
  featureBulkCreate: true,
};

interface PlanContextValue {
  plan: PlanSettings;
  isLimitReached: (max: number | null, current: number) => boolean;
}

const PlanContext = createContext<PlanContextValue>({
  plan: UNLIMITED_PLAN,
  isLimitReached: () => false,
});

export function usePlan() { return useContext(PlanContext); }

function mapPlan(row: Record<string, unknown>): PlanSettings {
  return {
    id: row.id as string,
    name: row.name as string,
    isSystem: (row.is_system as boolean) ?? false,
    accountExpiresAt: (row.account_expires_at as string | null) ?? null,
    maxMembers: (row.max_members as number | null) ?? null,
    maxProjects: (row.max_projects as number | null) ?? null,
    maxSprintsPerProject: (row.max_sprints_per_project as number | null) ?? null,
    maxTicketsPerSprint: (row.max_tickets_per_sprint as number | null) ?? null,
    maxImagesPerItem: (row.max_images_per_item as number | null) ?? null,
    maxCommentsPerTicket: (row.max_comments_per_ticket as number | null) ?? null,
    maxFiltersPerSprint: (row.max_filters_per_sprint as number | null) ?? null,
    featureNotifications: (row.feature_notifications as boolean) ?? true,
    featureCsvExport: (row.feature_csv_export as boolean) ?? true,
    featureActualMonitor: (row.feature_actual_monitor as boolean) ?? true,
    featureChildTickets: (row.feature_child_tickets as boolean) ?? true,
    featureBulkCreate: (row.feature_bulk_create as boolean) ?? true,
  };
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const { userOrgId, logout } = useAuth();
  const [plan, setPlan] = useState<PlanSettings>(UNLIMITED_PLAN);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled || !userOrgId) {
      setPlan(UNLIMITED_PLAN);
      return;
    }

    const load = async () => {
      const { data: org } = await supabase!
        .from("organizations")
        .select("plan_id")
        .eq("id", userOrgId)
        .maybeSingle();

      if (!org?.plan_id) { setPlan(UNLIMITED_PLAN); return; }

      const { data: planRow } = await supabase!
        .from("plans")
        .select("*")
        .eq("id", org.plan_id)
        .maybeSingle();

      if (planRow) {
        const p = mapPlan(planRow as Record<string, unknown>);
        setPlan(p);
        if (p.accountExpiresAt && new Date(p.accountExpiresAt) < new Date()) {
          await logout();
        }
      } else {
        setPlan(UNLIMITED_PLAN);
      }
    };

    load();
    timerRef.current = setInterval(load, 5 * 60 * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [userOrgId, logout]);

  const isLimitReached = (max: number | null, current: number) => {
    if (max === null) return false;
    return current >= max;
  };

  return (
    <PlanContext.Provider value={{ plan, isLimitReached }}>
      {children}
    </PlanContext.Provider>
  );
}
