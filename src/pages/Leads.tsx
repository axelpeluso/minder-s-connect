import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Mail, Phone, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase, type Customer } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type LeadStatus = "new" | "contacted" | "in_progress" | "done";

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  in_progress: "In progress",
  done: "Done",
};

const STATUS_CLASS: Record<LeadStatus, string> = {
  new: "bg-muted text-muted-foreground",
  contacted: "bg-primary/10 text-primary",
  in_progress: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
};

function getName(c: Customer): string {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.full_name === "string" && meta.full_name) return meta.full_name;
  if (c.email) return c.email;
  return `Anonymous #${c.id.slice(0, 6)}`;
}

function getStatus(c: Customer): LeadStatus {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const s = meta.lead_status;
  if (s === "new" || s === "contacted" || s === "in_progress" || s === "done") return s;
  return "new";
}

function scoreClass(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-700";
  if (score >= 40) return "text-amber-700";
  return "text-muted-foreground";
}

export default function Leads() {
  const [leads, setLeads] = useState<Customer[]>([]);
  const [lastContact, setLastContact] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    document.title = "Leads — Minders";
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("customers")
        .select("*")
        .order("lead_score", { ascending: false, nullsFirst: false })
        .limit(500);
      if (!active) return;
      setLeads((data as Customer[]) ?? []);

      const ids = (data ?? []).map((c: Customer) => c.id);
      if (ids.length) {
        const [{ data: fu }, { data: convos }] = await Promise.all([
          supabase
            .from("followups")
            .select("customer_id, sent_at, created_at")
            .in("customer_id", ids),
          supabase
            .from("conversations")
            .select("customer_id, last_message_at")
            .in("customer_id", ids),
        ]);
        const map: Record<string, string> = {};
        (fu ?? []).forEach((r: { customer_id: string; sent_at: string | null; created_at: string }) => {
          const t = r.sent_at ?? r.created_at;
          if (!map[r.customer_id] || new Date(t) > new Date(map[r.customer_id])) {
            map[r.customer_id] = t;
          }
        });
        (convos ?? []).forEach((r: { customer_id: string; last_message_at: string | null }) => {
          if (!r.last_message_at) return;
          if (!map[r.customer_id] || new Date(r.last_message_at) > new Date(map[r.customer_id])) {
            map[r.customer_id] = r.last_message_at;
          }
        });
        if (active) setLastContact(map);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter !== "all" && getStatus(l) !== statusFilter) return false;
      if (!q) return true;
      return (
        getName(l).toLowerCase().includes(q) ||
        (l.email ?? "").toLowerCase().includes(q) ||
        (l.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [leads, search, statusFilter]);

  async function updateStatus(lead: Customer, status: LeadStatus) {
    const meta = { ...((lead.metadata ?? {}) as Record<string, unknown>), lead_status: status };
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, metadata: meta } : l)));
    const { error } = await supabase.from("customers").update({ metadata: meta }).eq("id", lead.id);
    if (error) toast.error("Could not save status");
  }

  async function sendFollowup(lead: Customer, channel: "email" | "sms", body: string) {
    if (!body.trim()) {
      toast.error("Message is empty");
      return false;
    }
    const { error } = await supabase.from("followups").insert({
      customer_id: lead.id,
      fire_at: new Date().toISOString(),
      message_template: `[${channel}] ${body}`,
      status: "sent",
      sent_at: new Date().toISOString(),
      context_reference: channel,
    });
    if (error) {
      toast.error(`Send failed: ${error.message}`);
      return false;
    }
    toast.success(channel === "email" ? "Email logged" : "SMS logged");
    setLastContact((p) => ({ ...p, [lead.id]: new Date().toISOString() }));
    return true;
  }

  return (
    <div className="px-8 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
        <p className="text-sm text-muted-foreground">
          Prospective clients. Hover an email or phone to follow up.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="w-44">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Last contact</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Loading leads…
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No leads match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((lead) => {
              const status = getStatus(lead);
              const last = lastContact[lead.id];
              return (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">{getName(lead)}</TableCell>
                  <TableCell>
                    {lead.email ? (
                      <FollowupPopover lead={lead} channel="email" onSend={sendFollowup}>
                        <button className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-primary transition-colors">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          {lead.email}
                        </button>
                      </FollowupPopover>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {lead.phone ? (
                      <FollowupPopover lead={lead} channel="sms" onSend={sendFollowup}>
                        <button className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-primary transition-colors">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          {lead.phone}
                        </button>
                      </FollowupPopover>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={cn("text-sm font-semibold", scoreClass(lead.lead_score))}>
                      {lead.lead_score ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {last ? `${formatDistanceToNowStrict(new Date(last))} ago` : "—"}
                  </TableCell>
                  <TableCell>
                    <Select value={status} onValueChange={(v) => updateStatus(lead, v as LeadStatus)}>
                      <SelectTrigger
                        className={cn(
                          "h-7 w-32 rounded-full border-0 px-3 text-xs font-medium",
                          STATUS_CLASS[status],
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {filtered.length} of {leads.length} leads
      </p>
    </div>
  );
}

function FollowupPopover({
  lead,
  channel,
  onSend,
  children,
}: {
  lead: Customer;
  channel: "email" | "sms";
  onSend: (lead: Customer, channel: "email" | "sms", body: string) => Promise<boolean>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    const text = channel === "email" && subject ? `${subject}\n\n${body}` : body;
    const ok = await onSend(lead, channel, text);
    setSending(false);
    if (ok) {
      setBody("");
      setSubject("");
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          {channel === "email" ? <Mail className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
          <span>To: {channel === "email" ? lead.email : lead.phone}</span>
        </div>
        {channel === "email" && (
          <Input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mb-2 h-8"
          />
        )}
        <Textarea
          placeholder={channel === "email" ? "Write your email…" : "Write your SMS…"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="resize-none text-sm"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={handleSend} disabled={sending || !body.trim()}>
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
