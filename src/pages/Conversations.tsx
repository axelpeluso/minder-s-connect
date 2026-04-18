import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { Search } from "lucide-react";
import { supabase, type Conversation, type Customer } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
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

type Row = Conversation & { customer: Customer | null };

const STATUSES = ["active", "idle", "handoff"] as const;

function scoreClass(score: number | null) {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 75) return "bg-score-high text-white";
  if (score >= 40) return "bg-score-mid text-white";
  return "bg-score-low text-white";
}

function statusClass(status: string) {
  switch (status) {
    case "active":
      return "bg-secondary/15 text-secondary border-secondary/30";
    case "handoff":
      return "bg-primary/10 text-primary border-primary/30";
    case "idle":
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function anonName(customerId: string) {
  return `Anonymous #${customerId.slice(0, 6)}`;
}

export default function Conversations() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [language, setLanguage] = useState<string>("all");
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [search, setSearch] = useState("");
  const [matchedConvIds, setMatchedConvIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    document.title = "Conversations — Minders";
  }, []);

  // Initial load
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("conversations")
        .select(
          `id, customer_id, status, intent, message_count, last_message_at,
           assigned_agent_id, handoff_at, created_at, summary,
           customer:customers ( id, display_name, preferred_language, lead_score,
             email, phone, nail_shape, color_family, finish, experience_level,
             occasion, urgency_days, budget_range, hema_concerns, past_reactions,
             sensitive_skin, tags )`,
        )
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(500);

      if (!active) return;
      if (err) {
        setError(err.message);
      } else {
        setRows((data as unknown as Row[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Realtime: conversations + customers
  useEffect(() => {
    const channel = supabase
      .channel("conversations-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            setRows((prev) => prev.filter((r) => r.id !== (payload.old as Conversation).id));
            return;
          }
          const next = payload.new as Conversation;
          // Need customer joined — fetch single row enriched
          const { data } = await supabase
            .from("conversations")
            .select(
              `id, customer_id, status, intent, message_count, last_message_at,
               assigned_agent_id, handoff_at, created_at, summary,
               customer:customers ( id, display_name, preferred_language, lead_score,
                 email, phone, nail_shape, color_family, finish, experience_level,
                 occasion, urgency_days, budget_range, hema_concerns, past_reactions,
                 sensitive_skin, tags )`,
            )
            .eq("id", next.id)
            .maybeSingle();
          if (!data) return;
          setRows((prev) => {
            const without = prev.filter((r) => r.id !== next.id);
            return [data as unknown as Row, ...without].sort((a, b) => {
              const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
              const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
              return bt - at;
            });
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "customers" },
        (payload) => {
          const c = payload.new as Customer;
          setRows((prev) =>
            prev.map((r) => (r.customer_id === c.id ? { ...r, customer: c } : r)),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Search across messages.content -> conversation_ids
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setMatchedConvIds(null);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("messages")
        .select("conversation_id")
        .ilike("content", `%${q}%`)
        .limit(500);
      if (!active) return;
      setMatchedConvIds(new Set((data ?? []).map((m: { conversation_id: string }) => m.conversation_id)));
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [search]);

  const languages = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.customer?.preferred_language && set.add(r.customer.preferred_language));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (language !== "all" && r.customer?.preferred_language !== language) return false;
      const score = r.customer?.lead_score ?? 0;
      if (score < scoreRange[0] || score > scoreRange[1]) return false;
      if (q) {
        const name = (r.customer?.display_name ?? anonName(r.customer_id)).toLowerCase();
        const matchName = name.includes(q);
        const matchMsg = matchedConvIds?.has(r.id) ?? false;
        if (!matchName && !matchMsg) return false;
      }
      return true;
    });
  }, [rows, statusFilter, language, scoreRange, search, matchedConvIds]);

  return (
    <div className="px-8 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Conversations</h1>
        <p className="text-sm text-muted-foreground">
          Live customer chats handled by the bot. Take over any time.
        </p>
      </header>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="w-40">
          <p className="mb-1 text-xs text-muted-foreground">Status</p>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-40">
          <p className="mb-1 text-xs text-muted-foreground">Language</p>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {languages.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[220px] flex-1">
          <p className="mb-1 text-xs text-muted-foreground">
            Lead score: {scoreRange[0]}–{scoreRange[1]}
          </p>
          <Slider
            min={0}
            max={100}
            step={5}
            value={scoreRange}
            onValueChange={(v) => setScoreRange([v[0], v[1]] as [number, number])}
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Lang</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead>Last message</TableHead>
              <TableHead className="text-right">Msgs</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Loading conversations…
                </TableCell>
              </TableRow>
            )}
            {!loading && error && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-destructive">
                  {error}
                </TableCell>
              </TableRow>
            )}
            {!loading && !error && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No conversations match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => {
              const name = r.customer?.display_name || anonName(r.customer_id);
              return (
                <TableRow
                  key={r.id}
                  onClick={() => navigate(`/conversations/${r.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell>
                    {r.customer?.preferred_language ? (
                      <Badge variant="outline" className="font-normal uppercase">
                        {r.customer.preferred_language}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-[2rem] items-center justify-center rounded-full px-2 text-xs font-semibold",
                        scoreClass(r.customer?.lead_score ?? null),
                      )}
                    >
                      {r.customer?.lead_score ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.intent ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.last_message_at
                      ? `${formatDistanceToNowStrict(new Date(r.last_message_at))} ago`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm">{r.message_count ?? 0}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize",
                        statusClass(r.status),
                      )}
                    >
                      {r.status}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {filtered.length} of {rows.length} conversations · live
      </p>
    </div>
  );
}
