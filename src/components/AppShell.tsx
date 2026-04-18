import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LogOut, MessagesSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function AppShell({ children }: { children: ReactNode }) {
  const { agent, signOut } = useAuth();
  const navigate = useNavigate();

  const onSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-56 flex-col border-r border-border bg-sidebar">
        <div className="px-5 py-5">
          <p className="text-base font-semibold tracking-tight text-sidebar-foreground">Minders</p>
          <p className="text-xs text-muted-foreground">Bellezza Miami</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <NavLink
            to="/conversations"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent",
              )
            }
          >
            <MessagesSquare className="h-4 w-4" />
            Conversations
          </NavLink>
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 px-2 text-xs text-muted-foreground">
            <p className="truncate font-medium text-sidebar-foreground">
              {agent?.display_name ?? agent?.email}
            </p>
            {agent?.display_name && <p className="truncate">{agent.email}</p>}
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onSignOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
