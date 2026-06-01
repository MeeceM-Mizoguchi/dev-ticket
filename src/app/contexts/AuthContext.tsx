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
  canGeneratePrompt: false,
  canAccessMembers: false,
  canAccessRoles: false,
  canAccessGroups: false,
};

interface AuthCtxType {
  userName: string;
  userRole: Role;
  userId: string;
  userPermissions: UserPermissions;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthCtxType>({
  userName: "", userRole: "developer", userId: "",
  userPermissions: { ...DEFAULT_PERMISSIONS },
  login: async () => null, logout: async () => {},
});

export function useAuth() { return useContext(AuthContext); }

async function fetchRoleBasePermissions(role: string): Promise<UserPermissions> {
  if (!isSupabaseEnabled) return { ...DEFAULT_PERMISSIONS };
  const { data } = await supabase!.from("roles").select("base_permissions").eq("name", role).maybeSingle();
  if (data?.base_permissions) return { ...DEFAULT_PERMISSIONS, ...(data.base_permissions as Partial<UserPermissions>) };
  // fallback: admin/PM get all permissions if roles table not yet seeded
  if (role === "admin" || role === "project-manager") {
    return { canCreateTicket: true, canCreateSprint: true, canEditDelete: true, canReview: true, canSkipReview: true, canGeneratePrompt: true, canAccessMembers: true, canAccessRoles: role === "admin", canAccessGroups: true };
  }
  return { ...DEFAULT_PERMISSIONS };
}

// roles テーブルの base_permissions のみを権限の根拠とする。
// profiles.permissions は旧仕様のため無視。プロジェクト固有の上書きは project_member_permissions で管理。
function resolvePermissions(basePerms: UserPermissions): UserPermissions {
  return { ...basePerms };
}

async function fetchProfile(uid: string) {
  const { data } = await supabase!.from("profiles").select("name, role, status").eq("id", uid).maybeSingle();
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
  const [userPermissions, setUserPermissions] = useState<UserPermissions>({ ...DEFAULT_PERMISSIONS });
  const [authReady, setAuthReady] = useState(!isSupabaseEnabled);

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setUserName(sessionStorage.getItem("userName") || "");
      setUserRole(sessionStorage.getItem("userRole") || "developer");
      setUserId(sessionStorage.getItem("userId") || "");
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
          setUserPermissions(perms);
          sessionStorage.setItem("isLoggedIn", "true");
          sessionStorage.setItem("userName", p.name);
          sessionStorage.setItem("userRole", p.role);
          sessionStorage.setItem("userId", session.user.id);
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
            setUserPermissions(perms);
            sessionStorage.setItem("userName", p.name);
            sessionStorage.setItem("userRole", p.role);
            sessionStorage.setItem("userId", session.user.id);
            sessionStorage.setItem("userPermissions", JSON.stringify(perms));
          }
        });
      } else {
        setUserName(""); setUserRole("developer"); setUserId("");
        setUserPermissions({ ...DEFAULT_PERMISSIONS });
        sessionStorage.removeItem("isLoggedIn");
        sessionStorage.removeItem("userName");
        sessionStorage.removeItem("userRole");
        sessionStorage.removeItem("userId");
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
    setUserName(""); setUserRole("developer"); setUserId("");
    setUserPermissions({ ...DEFAULT_PERMISSIONS });
    sessionStorage.removeItem("isLoggedIn");
    sessionStorage.removeItem("userName");
    sessionStorage.removeItem("userRole");
    sessionStorage.removeItem("userId");
    sessionStorage.removeItem("userPermissions");
  };

  if (!authReady) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#F5F6F8" }}>
      <div style={{ textAlign:"center" as const }}>
        <div style={{ width:38, height:38, borderRadius:11, background:"linear-gradient(145deg,#34D399,#059669)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px", boxShadow:"0 4px 12px rgba(5,150,105,0.35)" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3"/><path d="M14 2H10a2 2 0 0 0-2 2v3h8V4a2 2 0 0 0-2-2z"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </div>
        <p style={{ fontSize:12, color:"#A09790" }}>読み込み中...</p>
      </div>
    </div>
  );

  return (
    <AuthContext.Provider value={{ userName, userRole, userId, userPermissions, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
