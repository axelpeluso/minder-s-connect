import { useEffect, useMemo, useRef, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Check, CheckCheck, Paperclip, Search, Send, Smile } from "lucide-react";
import { toast } from "sonner";
import { supabase, type Conversation, type Customer } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type Row = Conversation & { customer: Customer | null };

type Message = {
  id: string;
  conversation_id: string;
  role: string;
  content: string | null;
  audio_url: string | null;
  image_url: string | null;
  created_at: string;
};

function customerName(c: Customer | null, customerId: string) {
  const meta = (c?.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.full_name === "string" && meta.full_name) return meta.full_name;
  if (c?.email) return c.email;
  if (c?.phone) return c.phone;
  return `Anonymous #${customerId.slice(0, 6)}`;
}

function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function formatListTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
}

function formatBubbleTime(iso: string) {
  return format(new Date(iso), "HH:mm");
}

function formatDayDivider(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMMM d, yyyy");
}

const AVATAR_COLORS = [
  "bg-pink-200 text-pink-900",
  "bg-purple-200 text-purple-900",
  "bg-amber-200 text-amber-900",
  "bg-emerald-200 text-emerald-900",
  "bg-sky-200 text-sky-900",
  "bg-rose-200 text-rose-900",
];

function avatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export default function Conversations() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Conversations — Minders";
  }, []);

  // Load conversations + last message preview
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("conversations")
        .select(
          `id, customer_id, status, handoff_summary, handoff_suggested_reply,
           entry_page, started_at, last_message_at, closed_at,
           customer:customers ( id, email, phone, preferred_language, lead_score,
             nail_shape, color_family, finish, experience_level,
             occasion, urgency_days, budget_range, intent, hema_concerns,
             past_reactions, sensitive_skin, lead_factors, metadata,
             created_at, updated_at )`,
        )
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (!active) return;
      const list = (data as unknown as Row[]) ?? [];
      setRows(list);
      setLoading(false);
      if (list.length && !selectedId) setSelectedId(list[0].id);

      // Fetch latest message preview per conversation
      const ids = list.map((r) => r.id);
      if (ids.length) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("conversation_id, content, created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false })
          .limit(500);
        const map: Record<string, string> = {};
        (msgs ?? []).forEach((m: { conversation_id: string; content: string | null }) => {
          if (!map[m.conversation_id] && m.content) map[m.conversation_id] = m.content;
        });
        if (active) setPreviews(map);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load messages for selected conversation
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let active = true;
    setLoadingMsgs(true);
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, conversation_id, role, content, audio_url, image_url, created_at")
        .eq("conversation_id", selectedId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (!active) return;
      setMessages((data as Message[]) ?? []);
      setLoadingMsgs(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    })();

    const channel = supabase
      .channel(`msgs:${selectedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = customerName(r.customer, r.customer_id).toLowerCase();
      const preview = (previews[r.id] ?? "").toLowerCase();
      return name.includes(q) || preview.includes(q);
    });
  }, [rows, search, previews]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  async function sendMessage() {
    if (!selectedId || !composer.trim() || sending) return;
    const text = composer.trim();
    setSending(true);
    const { error } = await supabase.from("messages").insert({
      conversation_id: selectedId,
      role: "agent",
      content: text,
    });
    setSending(false);
    if (error) {
      toast.error(`Send failed: ${error.message}`);
      return;
    }
    setComposer("");
  }

  // Group messages by day for dividers
  const groupedMessages = useMemo(() => {
    const groups: Array<{ day: string; items: Message[] }> = [];
    messages.forEach((m) => {
      const day = formatDayDivider(m.created_at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(m);
      else groups.push({ day, items: [m] });
    });
    return groups;
  }, [messages]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Chat list */}
      <aside className="flex w-80 flex-col border-r border-border bg-card">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 rounded-full border-border bg-muted/50 pl-9 focus-visible:ring-1"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">No chats.</div>
          )}
          {filtered.map((r) => {
            const name = customerName(r.customer, r.customer_id);
            const preview = previews[r.id] ?? "No messages yet";
            const isSelected = r.id === selectedId;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors",
                  isSelected ? "bg-primary/10" : "hover:bg-muted/50",
                )}
              >
                <Avatar className="h-12 w-12 shrink-0">
                  <AvatarFallback className={cn("text-sm font-semibold", avatarColor(r.customer_id))}>
                    {initials(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatListTime(r.last_message_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-muted-foreground">{preview}</p>
                    {r.status === "handoff" && (
                      <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                        !
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Chat pane */}
      <section className="flex flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a chat to start messaging
          </div>
        ) : (
          <>
            {/* Header */}
            <header className="flex items-center gap-3 border-b border-border bg-card px-5 py-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className={cn("text-sm font-semibold", avatarColor(selected.customer_id))}>
                  {initials(customerName(selected.customer, selected.customer_id))}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {customerName(selected.customer, selected.customer_id)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selected.status === "active"
                    ? "online"
                    : selected.status === "handoff"
                      ? "needs attention"
                      : "last seen recently"}
                </p>
              </div>
              {selected.customer?.lead_score != null && (
                <div className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  Score {selected.customer.lead_score}
                </div>
              )}
            </header>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, hsl(var(--muted)) 1px, transparent 0)",
                backgroundSize: "24px 24px",
              }}
            >
              {loadingMsgs && (
                <div className="text-center text-xs text-muted-foreground">Loading messages…</div>
              )}
              {!loadingMsgs && messages.length === 0 && (
                <div className="text-center text-xs text-muted-foreground">No messages yet</div>
              )}
              <div className="mx-auto flex max-w-3xl flex-col gap-1">
                {groupedMessages.map((group) => (
                  <div key={group.day} className="flex flex-col gap-1">
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                        {group.day}
                      </span>
                    </div>
                    {group.items.map((m, i) => {
                      const isAgent = m.role === "agent" || m.role === "assistant";
                      const prev = group.items[i - 1];
                      const sameSender = prev && (prev.role === "agent" || prev.role === "assistant") === isAgent;
                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "flex",
                            isAgent ? "justify-end" : "justify-start",
                            sameSender ? "mt-0.5" : "mt-2",
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[75%] rounded-2xl px-3 py-2 shadow-sm",
                              isAgent
                                ? "rounded-br-sm bg-primary text-primary-foreground"
                                : "rounded-bl-sm bg-card text-card-foreground",
                            )}
                          >
                            {m.image_url && (
                              <img
                                src={m.image_url}
                                alt=""
                                className="mb-1 max-h-64 rounded-lg object-cover"
                              />
                            )}
                            {m.content && (
                              <p className="whitespace-pre-wrap break-words text-sm leading-snug">
                                {m.content}
                              </p>
                            )}
                            <div
                              className={cn(
                                "mt-0.5 flex items-center justify-end gap-1 text-[10px]",
                                isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
                              )}
                            >
                              <span>{formatBubbleTime(m.created_at)}</span>
                              {isAgent &&
                                (i === group.items.length - 1 ? (
                                  <CheckCheck className="h-3 w-3" />
                                ) : (
                                  <Check className="h-3 w-3" />
                                ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Composer */}
            <div className="border-t border-border bg-card px-4 py-3">
              <div className="mx-auto flex max-w-3xl items-end gap-2">
                <button
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Attach"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <div className="flex flex-1 items-end gap-2 rounded-3xl bg-muted/50 px-4 py-2">
                  <textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Message"
                    rows={1}
                    className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Emoji"
                  >
                    <Smile className="h-5 w-5" />
                  </button>
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!composer.trim() || sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
