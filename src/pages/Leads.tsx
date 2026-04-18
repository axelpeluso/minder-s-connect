import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Mail, Phone, Plus, Search, Send } from "lucide-react";
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
import { cn } from "@/lib/utils";

type LeadStatus = "new" | "contacted" | "in_progress" | "done";

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  in_progress: "In progress",
  done: "Done",
};

const STATUS_CLASS: Record<LeadStatus, string> = {
  new: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  contacted: "bg-primary/10 text-primary ring-1 ring-primary/20",
  in_progress: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  done: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
};

const STATUSES: LeadStatus[] = ["new", "contacted", "in_progress", "done"];

type ColumnKey =
  | "full_name"
  | "email"
  | "phone"
  | "preferred_language"
  | "intent"
  | "lead_score"
  | "last_contact"
  | "status";

type Column = {
  key: ColumnKey;
  label: string;
  width: string;
  type: "text" | "number" | "select" | "readonly" | "status" | "contact";
  options?: string[];
  meta?: boolean; // stored in metadata JSON
  editable: boolean;
};

const COLUMNS: Column[] = [
  { key: "full_name", label: "Name", width: "min-w-[180px]", type: "text", meta: true, editable: true },
  { key: "email", label: "Email", width: "min-w-[220px]", type: "contact", editable: true },
  { key: "phone", label: "Phone", width: "min-w-[160px]", type: "contact", editable: true },
  { key: "preferred_language", label: "Lang", width: "w-[80px]", type: "select", options: ["en", "es", "pt"], editable: true },
  { key: "intent", label: "Intent", width: "min-w-[140px]", type: "select", options: ["buy_kit", "buy_refill", "browse", "info"], editable: true },
  { key: "lead_score", label: "Score", width: "w-[80px]", type: "number", editable: true },
  { key: "last_contact", label: "Last contact", width: "min-w-[140px]", type: "readonly", editable: false },
  { key: "status", label: "Status", width: "w-[140px]", type: "status", meta: true, editable: true },
];

function getMeta(c: Customer): Record<string, unknown> {
  return (c.metadata ?? {}) as Record<string, unknown>;
}

function getCellValue(c: Customer, col: Column): string {
  if (col.key === "full_name") {
    const v = getMeta(c).full_name;
    return typeof v === "string" ? v : "";
  }
  if (col.key === "status") {
    const s = getMeta(c).lead_status;
    if (typeof s === "string" && STATUSES.includes(s as LeadStatus)) return s;
    return "new";
  }
  const v = (c as unknown as Record<string, unknown>)[col.key];
  return v == null ? "" : String(v);
}

function getStatus(c: Customer): LeadStatus {
  return getCellValue(c, COLUMNS.find((c) => c.key === "status")!) as LeadStatus;
}

function getName(c: Customer): string {
  const n = getCellValue(c, COLUMNS[0]);
  return n || c.email || `Anonymous #${c.id.slice(0, 6)}`;
}

export default function Leads() {
  const [leads, setLeads] = useState<Customer[]>([]);
  const [lastContact, setLastContact] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editing, setEditing] = useState<{ row: string; col: ColumnKey } | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

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
          supabase.from("followups").select("customer_id, sent_at, created_at").in("customer_id", ids),
          supabase.from("conversations").select("customer_id, last_message_at").in("customer_id", ids),
        ]);
        const map: Record<string, string> = {};
        (fu ?? []).forEach((r: { customer_id: string; sent_at: string | null; created_at: string }) => {
          const t = r.sent_at ?? r.created_at;
          if (!map[r.customer_id] || new Date(t) > new Date(map[r.customer_id])) map[r.customer_id] = t;
        });
        (convos ?? []).forEach((r: { customer_id: string; last_message_at: string | null }) => {
          if (!r.last_message_at) return;
          if (!map[r.customer_id] || new Date(r.last_message_at) > new Date(map[r.customer_id]))
            map[r.customer_id] = r.last_message_at;
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

  function startEdit(row: Customer, col: Column) {
    if (!col.editable) return;
    setEditing({ row: row.id, col: col.key });
    setDraft(getCellValue(row, col));
  }

  async function commitEdit() {
    if (!editing) return;
    const lead = leads.find((l) => l.id === editing.row);
    const col = COLUMNS.find((c) => c.key === editing.col);
    if (!lead || !col) {
      setEditing(null);
      return;
    }
    const current = getCellValue(lead, col);
    if (draft === current) {
      setEditing(null);
      return;
    }

    let patch: Record<string, unknown> = {};
    let optimistic: Customer = { ...lead };

    if (col.meta) {
      const metaKey = col.key === "full_name" ? "full_name" : "lead_status";
      const newMeta = { ...getMeta(lead), [metaKey]: draft };
      patch = { metadata: newMeta };
      optimistic = { ...lead, metadata: newMeta };
    } else if (col.type === "number") {
      const num = draft === "" ? null : Number(draft);
      if (num != null && Number.isNaN(num)) {
        toast.error("Must be a number");
        setEditing(null);
        return;
      }
      patch = { [col.key]: num };
      optimistic = { ...lead, [col.key]: num } as Customer;
    } else {
      const val = draft === "" ? null : draft;
      patch = { [col.key]: val };
      optimistic = { ...lead, [col.key]: val } as Customer;
    }

    setLeads((prev) => prev.map((l) => (l.id === lead.id ? optimistic : l)));
    setEditing(null);

    const { error } = await supabase.from("customers").update(patch).eq("id", lead.id);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l)));
    }
  }

  function cancelEdit() {
    setEditing(null);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit();
    }
  }

  async function addRow() {
    setAdding(true);
    const { data, error } = await supabase
      .from("customers")
      .insert({
        metadata: { full_name: "New lead", lead_status: "new", seeded: false },
        preferred_language: "en",
        lead_score: 0,
      })
      .select()
      .single();
    setAdding(false);
    if (error || !data) {
      toast.error(error?.message ?? "Could not create");
      return;
    }
    setLeads((prev) => [data as Customer, ...prev]);
    setEditing({ row: (data as Customer).id, col: "full_name" });
    setDraft("New lead");
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
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Editable spreadsheet. Click a cell to edit · Enter to save · Esc to cancel.
          </p>
        </div>
        <Button onClick={addRow} disabled={adding} size="sm">
          <Plus className="h-4 w-4" />
          Add lead
        </Button>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-md border border-border bg-card p-1">
          {(["all", ...STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "all" ? "All" : STATUS_LABEL[s as LeadStatus]}
            </button>
          ))}
        </div>
      </div>

      {/* Spreadsheet */}
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border">
              <th className="w-12 px-3 py-3 text-left text-[11px] font-normal uppercase tracking-wider text-muted-foreground">
                ID
              </th>
              {COLUMNS.map((col) => {
                const numeric = col.type === "number";
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "px-3 py-3 text-[11px] font-normal uppercase tracking-wider text-muted-foreground",
                      numeric ? "text-right" : "text-left",
                      col.width,
                    )}
                  >
                    {col.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
...
            {filtered.map((lead, idx) => (
              <tr
                key={lead.id}
                className={cn(
                  "group border-b border-border/60 transition-colors hover:bg-primary/[0.03]",
                  idx % 2 === 1 && "bg-muted/20",
                )}
              >
                <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">
                  {String(9700 - idx).padStart(4, "0")}
                </td>
                {COLUMNS.map((col) => {
                  const isEditing = editing?.row === lead.id && editing.col === col.key;
                  const value = getCellValue(lead, col);
                  const numeric = col.type === "number";
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "p-0 align-middle",
                        numeric && "text-right",
                        isEditing && "ring-2 ring-inset ring-primary",
                      )}
                      onClick={() => !isEditing && startEdit(lead, col)}
                    >
                      <CellRenderer
                        col={col}
                        value={value}
                        lead={lead}
                        isEditing={isEditing}
                        draft={draft}
                        setDraft={setDraft}
                        onCommit={commitEdit}
                        onCancel={cancelEdit}
                        onKey={handleKey}
                        inputRef={inputRef}
                        lastContact={lastContact[lead.id]}
                        onSendFollowup={sendFollowup}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {filtered.length} of {leads.length} leads
      </p>
    </div>
  );
}

function CellRenderer({
  col,
  value,
  lead,
  isEditing,
  draft,
  setDraft,
  onCommit,
  onCancel,
  onKey,
  inputRef,
  lastContact,
  onSendFollowup,
}: {
  col: Column;
  value: string;
  lead: Customer;
  isEditing: boolean;
  draft: string;
  setDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onKey: (e: KeyboardEvent) => void;
  inputRef: React.RefObject<HTMLInputElement | HTMLSelectElement>;
  lastContact: string | undefined;
  onSendFollowup: (lead: Customer, channel: "email" | "sms", body: string) => Promise<boolean>;
}) {
  // Editing modes
  if (isEditing && (col.type === "text" || col.type === "number" || col.type === "contact")) {
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        autoFocus
        type={col.type === "number" ? "number" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKey}
        className="h-9 w-full bg-transparent px-3 text-sm outline-none"
      />
    );
  }
  if (isEditing && (col.type === "select" || col.type === "status")) {
    const options = col.type === "status" ? STATUSES : col.options ?? [];
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          // commit on change for selects
          setTimeout(onCommit, 0);
        }}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-9 w-full bg-transparent px-3 text-sm outline-none"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {col.type === "status" ? STATUS_LABEL[o as LeadStatus] : o}
          </option>
        ))}
      </select>
    );
  }

  // Read-only display modes
  if (col.type === "status") {
    const s = (value || "new") as LeadStatus;
    return (
      <div className="px-3 py-2.5">
        <span
          className={cn(
            "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            STATUS_CLASS[s],
          )}
        >
          {STATUS_LABEL[s]}
        </span>
      </div>
    );
  }

  if (col.key === "last_contact") {
    return (
      <div className="px-3 py-2.5 text-sm text-muted-foreground">
        {lastContact ? `${formatDistanceToNowStrict(new Date(lastContact))} ago` : "—"}
      </div>
    );
  }

  if (col.type === "contact" && value) {
    const channel = col.key === "email" ? "email" : "sms";
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="truncate text-sm">{value}</span>
        <FollowupPopover lead={lead} channel={channel} onSend={onSendFollowup}>
          <button
            onClick={(e) => e.stopPropagation()}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
            aria-label={`Send ${channel}`}
          >
            {channel === "email" ? <Mail className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
          </button>
        </FollowupPopover>
      </div>
    );
  }

  if (col.key === "lead_score") {
    const n = value ? Number(value) : null;
    const cls =
      n == null ? "text-muted-foreground" : n >= 75 ? "text-emerald-700" : n >= 40 ? "text-amber-700" : "text-rose-600";
    return <div className={cn("px-3 py-2.5 text-right text-sm font-semibold tabular-nums", cls)}>{value || "—"}</div>;
  }

  if (col.key === "full_name") {
    return (
      <div className="px-3 py-2.5 text-sm font-semibold text-foreground">
        {value || "—"}
      </div>
    );
  }

  return (
    <div className={cn("px-3 py-2.5 text-sm", !value && "text-muted-foreground")}>
      {value || "—"}
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
      <PopoverContent align="end" className="w-80 p-3" onClick={(e) => e.stopPropagation()}>
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
