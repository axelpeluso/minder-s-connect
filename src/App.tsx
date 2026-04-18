import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppShell from "@/components/AppShell";
import Conversations from "./pages/Conversations";
import Dashboard from "./pages/Dashboard";
import Leads from "./pages/Leads";
import Newsletters from "./pages/Newsletters";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <AppShell>
                <Dashboard />
              </AppShell>
            }
          />
          <Route
            path="/leads"
            element={
              <AppShell>
                <Leads />
              </AppShell>
            }
          />
          <Route
            path="/conversations"
            element={
              <AppShell>
                <Conversations />
              </AppShell>
            }
          />
          <Route
            path="/newsletters"
            element={
              <AppShell>
                <Newsletters />
              </AppShell>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
