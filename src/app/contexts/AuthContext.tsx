import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { Role, UserPermissions } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { MEMBERS } from "@/app/data/mock";

const DEFAULT_PERMISSIONS: UserPermissions = {
  canCreateTicket: false,
  canCreateSprint: false,
  canEditDelete: false,
  canReview: false,
  canSkipReview: false,
  canAccessMembers: false,
  canAccessRoles: false,
  canAccessGroups: false,
  canAccessAdminSettings: false,
  canAccessWiki: false,
  canAccessBacklog: false,
  canAccessMinutes: false,
  canAccessOrganization: false,
  canUpdateAnnouncement: false,
  canAccessReports: false,
  wikiPermission: "none",
  backlogPermission: "none",
  minutesPermission: "none",
};

interface AuthCtxType {
  userName: string;
  userRole: Role;
  userId: string;
  userOrgId: string | null;
  userPermissions: UserPermissions;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthCtxType>({
  userName: "", userRole: "developer", userId: "", userOrgId: null,
  userPermissions: { ...DEFAULT_PERMISSIONS },
  login: async () => null, logout: async () => {},
});

export function useAuth() { return useContext(AuthContext); }

async function fetchRoleBasePermissions(role: string): Promise<UserPermissions> {
  if (!isSupabaseEnabled) return { ...DEFAULT_PERMISSIONS };
  // ownerは常に全権限（DBのrolesテーブルに依存しない）
  if (role === "owner") {
    return {
      ...DEFAULT_PERMISSIONS,
      canCreateTicket: true, canCreateSprint: true, canEditDelete: true, canReview: true, canSkipReview: true,
      canAccessMembers: true, canAccessRoles: true, canAccessGroups: true, canAccessAdminSettings: true,
      canAccessWiki: true, canAccessBacklog: true, canAccessMinutes: true, canAccessOrganization: true,
      canUpdateAnnouncement: true, canAccessReports: true,
      wikiPermission: "edit", backlogPermission: "edit", minutesPermission: "edit",
    };
  }
  const { data } = await supabase!.from("roles").select("base_permissions").eq("name", role).maybeSingle();
  if (data?.base_permissions) return { ...DEFAULT_PERMISSIONS, ...(data.base_permissions as Partial<UserPermissions>) };
  // fallback: admin/PMがrolesテーブル未seededの場合
  if (role === "admin" || role === "project-manager") {
    return {
      ...DEFAULT_PERMISSIONS,
      canCreateTicket: true, canCreateSprint: true, canEditDelete: true, canReview: true, canSkipReview: true,
      canAccessMembers: true, canAccessRoles: role === "admin", canAccessGroups: true, canAccessAdminSettings: role === "admin",
      canAccessWiki: true, canAccessBacklog: true, canAccessMinutes: true, canAccessReports: true,
      wikiPermission: "edit", backlogPermission: "edit", minutesPermission: "edit",
    };
  }
  return { ...DEFAULT_PERMISSIONS };
}

// roles テーブルの base_permissions のみを権限の根拠とする。
// profiles.permissions は旧仕様のため無視。プロジェクト固有の上書きは project_member_permissions で管理。
function resolvePermissions(basePerms: UserPermissions): UserPermissions {
  return { ...basePerms };
}

async function fetchProfile(uid: string) {
  const { data } = await supabase!.from("profiles").select("name, role, status, organization_id").eq("id", uid).maybeSingle();
  return data ?? null;
}

async function activateIfInvited(uid: string, status: string) {
  if (status === "invited") {
    await supabase!.from("profiles").update({ status: "active" }).eq("id", uid);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<Role>("developer");
  const [userId, setUserId] = useState("");
  const [userOrgId, setUserOrgId] = useState<string | null>(null);
  const [userPermissions, setUserPermissions] = useState<UserPermissions>({ ...DEFAULT_PERMISSIONS });
  const [authReady, setAuthReady] = useState(!isSupabaseEnabled);

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setUserName(sessionStorage.getItem("userName") || "");
      setUserRole(sessionStorage.getItem("userRole") || "developer");
      setUserId(sessionStorage.getItem("userId") || "");
      setUserOrgId(sessionStorage.getItem("userOrgId") || null);
      const savedPerms = sessionStorage.getItem("userPermissions");
      if (savedPerms) {
        try { setUserPermissions(JSON.parse(savedPerms)); } catch { /* ignore */ }
      }
      return;
    }
    const authTimer = setTimeout(() => setAuthReady(true), 5000);
    supabase!.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(authTimer);
      if (session) {
        const p = await fetchProfile(session.user.id);
        if (p) {
          await activateIfInvited(session.user.id, p.status);
          const role = p.role as Role;
          const basePerms = await fetchRoleBasePermissions(role);
          const perms = resolvePermissions(basePerms);
          setUserName(p.name); setUserRole(role); setUserId(session.user.id);
          setUserOrgId(p.organization_id ?? null);
          setUserPermissions(perms);
          sessionStorage.setItem("isLoggedIn", "true");
          sessionStorage.setItem("userName", p.name);
          sessionStorage.setItem("userRole", p.role);
          sessionStorage.setItem("userId", session.user.id);
          sessionStorage.setItem("userOrgId", p.organization_id ?? "");
          sessionStorage.setItem("userPermissions", JSON.stringify(perms));
        }
      }
      setAuthReady(true);
    }).catch(() => { clearTimeout(authTimer); setAuthReady(true); });

    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      if (session) {
        fetchProfile(session.user.id).then(async p => {
          if (p) {
            await activateIfInvited(session.user.id, p.status);
            const role = p.role as Role;
            const basePerms = await fetchRoleBasePermissions(role);
            const perms = resolvePermissions(basePerms);
            setUserName(p.name); setUserRole(role); setUserId(session.user.id);
            setUserOrgId(p.organization_id ?? null);
            setUserPermissions(perms);
            sessionStorage.setItem("userName", p.name);
            sessionStorage.setItem("userRole", p.role);
            sessionStorage.setItem("userId", session.user.id);
            sessionStorage.setItem("userOrgId", p.organization_id ?? "");
            sessionStorage.setItem("userPermissions", JSON.stringify(perms));
          }
        });
      } else {
        setUserName(""); setUserRole("developer"); setUserId(""); setUserOrgId(null);
        setUserPermissions({ ...DEFAULT_PERMISSIONS });
        sessionStorage.removeItem("isLoggedIn");
        sessionStorage.removeItem("userName");
        sessionStorage.removeItem("userRole");
        sessionStorage.removeItem("userId");
        sessionStorage.removeItem("userOrgId");
        sessionStorage.removeItem("userPermissions");
      }
    });
    return () => { clearTimeout(authTimer); subscription.unsubscribe(); };
  }, []);

  const login = async (email: string, password: string): Promise<string | null> => {
    if (!isSupabaseEnabled) {
      await new Promise(r => setTimeout(r, 650));
      const member = MEMBERS.find(m => m.email === email);
      if (member && password === "password") {
        const role = member.role as Role;
        const perms = resolvePermissions({ ...DEFAULT_PERMISSIONS });
        setUserName(member.name); setUserRole(role); setUserId(member.id);
        setUserPermissions(perms);
        sessionStorage.setItem("isLoggedIn", "true");
        sessionStorage.setItem("userName", member.name);
        sessionStorage.setItem("userRole", member.role);
        sessionStorage.setItem("userId", member.id);
        sessionStorage.setItem("userPermissions", JSON.stringify(perms));
        return null;
      }
      return "メールアドレスまたはパスワードが正しくありません。";
    }
    const { data, error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    if (data.session) sessionStorage.setItem("isLoggedIn", "true");
    return null;
  };

  const logout = async () => {
    if (isSupabaseEnabled) await supabase!.auth.signOut();
    setUserName(""); setUserRole("developer"); setUserId(""); setUserOrgId(null);
    setUserPermissions({ ...DEFAULT_PERMISSIONS });
    sessionStorage.removeItem("isLoggedIn");
    sessionStorage.removeItem("userName");
    sessionStorage.removeItem("userRole");
    sessionStorage.removeItem("userId");
    sessionStorage.removeItem("userOrgId");
    sessionStorage.removeItem("userPermissions");
  };

  if (!authReady) return (
    <div style={{ position:"fixed", inset:0, background:"linear-gradient(135deg, #ffffff 0%, #f0fdf4 50%, #ecfdf5 100%)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, overflow:"hidden" }}>
      <style>{`
        @keyframes sp-orb1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(60px,-40px) scale(1.15)} 66%{transform:translate(-30px,50px) scale(0.9)} }
        @keyframes sp-orb2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-70px,30px) scale(0.85)} 66%{transform:translate(40px,-60px) scale(1.1)} }
        @keyframes sp-orb3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(50px,50px) scale(1.2)} }
        @keyframes sp-ring { 0%{transform:translate(-50%,-50%) scale(0.8);opacity:0.6} 100%{transform:translate(-50%,-50%) scale(2.8);opacity:0} }
        @keyframes sp-logo { 0%{transform:scale(0.55);opacity:0} 65%{transform:scale(1.07);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes sp-text { 0%{opacity:0;transform:translateY(10px)} 100%{opacity:1;transform:translateY(0)} }
        @keyframes sp-shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes sp-dot { 0%,80%,100%{transform:translateY(0) scale(0.7);opacity:0.3} 40%{transform:translateY(-8px) scale(1.1);opacity:1} }
      `}</style>

      {/* 背景オーブ */}
      <div style={{ position:"absolute", top:"15%", left:"20%", width:500, height:500, borderRadius:"50%", background:"radial-gradient(circle, rgba(52,211,153,0.35) 0%, transparent 68%)", animation:"sp-orb1 9s ease-in-out infinite", pointerEvents:"none" }} />
      <div style={{ position:"absolute", bottom:"15%", right:"15%", width:600, height:600, borderRadius:"50%", background:"radial-gradient(circle, rgba(16,185,129,0.25) 0%, transparent 68%)", animation:"sp-orb2 11s ease-in-out infinite", pointerEvents:"none" }} />
      <div style={{ position:"absolute", top:"55%", left:"5%", width:350, height:350, borderRadius:"50%", background:"radial-gradient(circle, rgba(20,184,166,0.2) 0%, transparent 68%)", animation:"sp-orb3 13s ease-in-out infinite", pointerEvents:"none" }} />

      {/* 中央コンテンツ */}
      <div style={{ textAlign:"center" as const, position:"relative" }}>

        {/* 波紋リング */}
        {[0, 0.6, 1.2].map(d => (
          <div key={d} style={{ position:"absolute", top:"28px", left:"50%", width:72, height:72, borderRadius:"50%", border:"2px solid rgba(5,150,105,0.4)", animation:`sp-ring 2.4s ease-out ${d}s infinite`, pointerEvents:"none" }} />
        ))}

        {/* ロゴ */}
        <div style={{ width:72, height:72, borderRadius:20, background:"linear-gradient(145deg,#34D399,#059669)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto", boxShadow:"0 8px 40px rgba(5,150,105,0.4), 0 0 0 1px rgba(52,211,153,0.3)", animation:"sp-logo 0.75s cubic-bezier(0.175,0.885,0.32,1.275) both", position:"relative", zIndex:1 }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3"/><path d="M14 2H10a2 2 0 0 0-2 2v3h8V4a2 2 0 0 0-2-2z"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </div>

        {/* ブランド名 */}
        <div style={{ marginTop:20, fontSize:26, fontWeight:800, letterSpacing:"-0.5px", background:"linear-gradient(90deg, #059669 0%, #0d9488 50%, #059669 100%)", backgroundSize:"200% auto", WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent", animation:"sp-text 0.5s ease-out 0.3s both, sp-shimmer 3s linear 1s infinite" }}>
          Dev Ticket
        </div>

        {/* ローディングドット */}
        <div style={{ display:"flex", justifyContent:"center", gap:10, marginTop:28 }}>
          {[0, 0.2, 0.4].map(d => (
            <div key={d} style={{ width:9, height:9, borderRadius:"50%", background:"#059669", animation:`sp-dot 1.4s ease-in-out ${d}s infinite` }} />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <AuthContext.Provider value={{ userName, userRole, userId, userOrgId, userPermissions, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
