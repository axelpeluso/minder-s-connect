import { ReactNode, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, MapPin, MessagesSquare, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { seedLeadsIfEmpty } from "@/lib/seedLeads";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-primary/10 text-primary font-medium"
      : "text-sidebar-foreground hover:bg-sidebar-accent",
  );

export default function AppShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    seedLeadsIfEmpty();
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-5 py-6">
          <p className="text-base font-semibold tracking-tight text-sidebar-foreground">Bella</p>
          <p className="text-xs text-muted-foreground">Bellezza Miami</p>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          <NavLink to="/dashboard" className={linkClass}>
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </NavLink>
          <NavLink to="/leads" className={linkClass}>
            <Users className="h-4 w-4" />
            Leads
          </NavLink>
          <NavLink to="/conversations" className={linkClass}>
            <MessagesSquare className="h-4 w-4" />
            Conversations
          </NavLink>
          <NavLink to="/newsletters" className={linkClass}>
            <MapPin className="h-4 w-4" />
            Miami Local Data
          </NavLink>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
