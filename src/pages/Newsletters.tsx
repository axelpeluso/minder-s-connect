import { useEffect, useMemo, useState } from "react";
import { Calendar, CloudSun, Megaphone, Search, Sparkles, Tag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Category = "event" | "trend" | "weather" | "promo";

type Newsletter = {
  id: string;
  date: string; // ISO
  category: Category;
  title: string;
  neighborhood: string;
  summary: string;
  body: string;
  tags: string[];
};

const CATEGORY_META: Record<Category, { label: string; icon: typeof Calendar; class: string }> = {
  event: { label: "Event", icon: Calendar, class: "bg-primary/10 text-primary ring-1 ring-primary/20" },
  trend: { label: "Trend", icon: Sparkles, class: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
  weather: { label: "Weather", icon: CloudSun, class: "bg-amber-50 text-amber-800 ring-1 ring-amber-200" },
  promo: { label: "Promo", icon: Megaphone, class: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
};

const NEWSLETTERS: Newsletter[] = [
  {
    id: "n1",
    date: "2026-04-15",
    category: "event",
    title: "Miami Beach Pride Weekend — pitch bold neons",
    neighborhood: "South Beach",
    summary: "Pride weekend brings 130k+ visitors to Ocean Drive. Spike in last-minute bookings expected Thu–Sun.",
    body:
      "Pride weekend (Apr 17–19) historically drives a 38% lift in walk-ins on Lincoln Rd. Promote rainbow chrome tips, neon french, and gel extensions. Recommend the Bellezza 'Glow Kit' bundle for clients asking about long-lasting wear under sun + sweat.",
    tags: ["Pride", "South Beach", "Neon", "Walk-ins"],
  },
  {
    id: "n2",
    date: "2026-04-14",
    category: "weather",
    title: "Humidity climbs to 78% — push HEMA-free top coats",
    neighborhood: "Miami-Dade",
    summary: "7-day forecast: 84°F avg, afternoon storms Tue/Wed. Lift-prone formulas should be steered away from.",
    body:
      "Bella should proactively recommend humidity-resistant finishes (matte rubber base, hard gel) to clients in Brickell and Wynwood. Avoid suggesting builder-in-a-bottle this week — return rate jumps 12% above 75% humidity.",
    tags: ["Humidity", "Top coat", "HEMA-free"],
  },
  {
    id: "n3",
    date: "2026-04-12",
    category: "trend",
    title: "TikTok 'Cafecito chrome' is trending in Little Havana",
    neighborhood: "Little Havana",
    summary: "Caramel-mocha chrome with cinnamon micro-glitter. +420% search vol locally in 7 days.",
    body:
      "Position the Bellezza 'Cortadito' palette (mocha, caramel, cream) for Saturday bookings. Pair with almond shape recommendations. Spanish-speaking clients responding well to the name 'Cafecito chrome' — translate in Bella's Spanish replies.",
    tags: ["Chrome", "TikTok", "Little Havana", "ES"],
  },
  {
    id: "n4",
    date: "2026-04-10",
    category: "promo",
    title: "Mother's Day prep — bundle 'Mami & Me'",
    neighborhood: "Miami-wide",
    summary: "30 days out. Past 2 years: 2.3x lead volume in the 10 days before May 10.",
    body:
      "Launch the 'Mami & Me' duo bundle now. Bella should mention it to any lead with intent=buy_kit and language=es. Free express shipping inside 33xxx zip codes through May 8.",
    tags: ["Mother's Day", "Bundle", "Spanish"],
  },
  {
    id: "n5",
    date: "2026-04-08",
    category: "event",
    title: "Miami Grand Prix May 2–4 — racing reds in demand",
    neighborhood: "Miami Gardens",
    summary: "F1 weekend pulls premium spenders. Brickell hotels at 96% occupancy. High AOV opportunity.",
    body:
      "Push Bellezza 'Pole Position' (deep racing red) and checker-flag nail art kits. Bella should fast-track handoffs for any lead with budget_range=premium and urgency<7 days.",
    tags: ["F1", "Brickell", "Premium"],
  },
  {
    id: "n6",
    date: "2026-04-05",
    category: "trend",
    title: "Coral & terracotta replacing pastels for spring",
    neighborhood: "Coral Gables",
    summary: "Coral Gables bridal clients shifting away from soft pinks toward warm corals.",
    body:
      "Recommend the Bellezza 'Sunset Gables' trio for bridal trial bookings. Past 30 days: 64% of bridal handoffs picked coral over blush when shown side-by-side.",
    tags: ["Bridal", "Coral Gables", "Spring"],
  },
];

const TABS: { value: "all" | Category; label: string }[] = [
  { value: "all", label: "All" },
  { value: "event", label: "Events" },
  { value: "trend", label: "Trends" },
  { value: "weather", label: "Weather" },
  { value: "promo", label: "Promos" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Newsletters() {
  useEffect(() => {
    document.title = "Bella · Miami Local Data";
  }, []);

  const [tab, setTab] = useState<"all" | Category>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(NEWSLETTERS[0].id);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NEWSLETTERS.filter((n) => {
      if (tab !== "all" && n.category !== tab) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.summary.toLowerCase().includes(q) ||
        n.neighborhood.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [tab, query]);

  const selected = NEWSLETTERS.find((n) => n.id === selectedId) ?? filtered[0] ?? NEWSLETTERS[0];

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Miami Local Data</h1>
        <p className="text-sm text-muted-foreground">
          Weekly briefings on local events, weather and trends Bella can use in conversations.
        </p>
      </header>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search neighborhood, tag…"
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* List */}
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No newsletters match your filters.
              </CardContent>
            </Card>
          ) : (
            filtered.map((n) => {
              const meta = CATEGORY_META[n.category];
              const Icon = meta.icon;
              const isActive = selected?.id === n.id;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className={cn(
                    "group block w-full rounded-lg border bg-card p-4 text-left transition-all hover:shadow-sm",
                    isActive ? "border-primary/40 ring-2 ring-primary/20" : "border-border",
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", meta.class)}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{n.neighborhood}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{formatDate(n.date)}</span>
                  </div>
                  <p className="text-sm font-semibold leading-snug text-foreground">{n.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.summary}</p>
                </button>
              );
            })
          )}
        </div>

        {/* Reader */}
        <Card className="h-fit lg:sticky lg:top-6">
          <CardContent className="p-6">
            {selected && (
              <article>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {(() => {
                    const meta = CATEGORY_META[selected.category];
                    const Icon = meta.icon;
                    return (
                      <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium", meta.class)}>
                        <Icon className="h-3.5 w-3.5" />
                        {meta.label}
                      </span>
                    );
                  })()}
                  <span className="text-xs text-muted-foreground">{selected.neighborhood}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{formatDate(selected.date)}</span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-foreground">{selected.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{selected.summary}</p>
                <div className="my-5 h-px bg-border" />
                <p className="text-sm leading-relaxed text-foreground">{selected.body}</p>
                {selected.tags.length > 0 && (
                  <div className="mt-5 flex flex-wrap items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    {selected.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
