import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type Agent } from "@/lib/supabase";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  agent: Agent | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listener first (per Supabase auth best practice)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setAgent(null);
        setLoading(false);
      } else {
        // Defer agent lookup to avoid blocking the callback
        setTimeout(() => loadAgent(s.user.email ?? ""), 0);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user.email) {
        loadAgent(s.user.email);
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const loadAgent = async (email: string) => {
    const { data } = await supabase
      .from("agents")
      .select("id, email, display_name")
      .eq("email", email)
      .maybeSingle();
    setAgent((data as Agent) ?? null);
    setLoading(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAgent(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, agent, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
