-- Minders / Bellezza Miami — Postgres schema
-- Backs the seven tools declared in prompts/system.md.
-- Requires: postgres >= 14, pgvector extension.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- =========================================================================
-- Agents (dashboard operators who handle handoffs)
-- =========================================================================
create table if not exists agents (
    id          uuid primary key default gen_random_uuid(),
    email       text unique not null,
    name        text not null,
    role        text not null default 'agent' check (role in ('admin', 'agent')),
    created_at  timestamptz not null default now()
);

-- =========================================================================
-- Customers (CRM record written by extract_profile + update_lead_score)
-- =========================================================================
create table if not exists customers (
    id              uuid primary key default gen_random_uuid(),
    name            text,
    email           text unique,
    phone           text unique,
    preferred_language text check (preferred_language in ('en','es')) default 'en',

    -- product preferences
    nail_shape      text check (nail_shape in ('square','almond','coffin','round','oval')),
    color_family    text,
    finish          text,
    experience_level text check (experience_level in ('beginner','intermediate','advanced')),

    -- event / purchase signals
    occasion        text,
    urgency_days    int,
    budget_range    text,
    intent          text check (intent in ('browsing','considering','ready_to_buy','purchased','lost')),

    -- health / sensitivity
    hema_concerns   boolean default false,
    past_reactions  boolean default false,
    sensitive_skin  boolean default false,

    -- qualification
    lead_score      int check (lead_score between 0 and 100),
    lead_factors    jsonb,

    -- anything else Bella extracts that isn't a first-class column
    metadata        jsonb default '{}'::jsonb,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists customers_intent_idx on customers (intent);
create index if not exists customers_lead_score_idx on customers (lead_score desc);

-- History of score changes so we can explain/audit qualification
create table if not exists lead_score_events (
    id              bigserial primary key,
    customer_id     uuid not null references customers(id) on delete cascade,
    score           int not null,
    factors         jsonb not null,
    reason          text,
    created_at      timestamptz not null default now()
);
create index if not exists lead_score_events_customer_idx on lead_score_events (customer_id, created_at desc);

-- =========================================================================
-- Conversations + messages
-- =========================================================================
create table if not exists conversations (
    id              uuid primary key default gen_random_uuid(),
    customer_id     uuid references customers(id) on delete set null,
    status          text not null default 'active'
                      check (status in ('active','handoff','closed')),
    handoff_summary text,
    handoff_suggested_reply text,
    entry_page      text,
    started_at      timestamptz not null default now(),
    last_message_at timestamptz not null default now(),
    closed_at       timestamptz
);
create index if not exists conversations_status_idx on conversations (status);
create index if not exists conversations_customer_idx on conversations (customer_id);

create table if not exists messages (
    id              bigserial primary key,
    conversation_id uuid not null references conversations(id) on delete cascade,
    role            text not null check (role in ('user','assistant','tool','system')),
    content         text,
    tool_name       text,
    tool_input      jsonb,
    tool_output     jsonb,
    audio_url       text,
    image_url       text,
    created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);

-- =========================================================================
-- Products (search_products target) + brand knowledge (search_brand_knowledge)
-- Embedding dim 1536 matches OpenAI text-embedding-3-small / Voyage voyage-3.
-- Adjust the dim if you pick a different embedder.
-- =========================================================================
create table if not exists products (
    id              uuid primary key default gen_random_uuid(),
    sku             text unique,
    name            text not null,
    category        text check (category in ('diy_kit','cuticle_care','soft_gel_tips','paint_and_slay','nail_preparation')),
    shape           text check (shape in ('square','almond','coffin','round','oval')),
    color           text,
    finish          text,
    tags            text[] default '{}',
    price_cents     int not null,
    currency        text not null default 'USD',
    in_stock        boolean not null default true,
    shopify_variant_id text,
    description     text,
    embedding       vector(1536),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists products_category_idx on products (category);
create index if not exists products_tags_idx on products using gin (tags);
create index if not exists products_embedding_idx on products
    using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table if not exists brand_knowledge (
    id              uuid primary key default gen_random_uuid(),
    topic           text,                       -- e.g. 'hema_free', 'returns', 'application'
    title           text,
    body            text not null,
    source_url      text,
    embedding       vector(1536),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists brand_knowledge_topic_idx on brand_knowledge (topic);
create index if not exists brand_knowledge_embedding_idx on brand_knowledge
    using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- =========================================================================
-- Follow-ups (schedule_followup)
-- =========================================================================
create table if not exists followups (
    id              uuid primary key default gen_random_uuid(),
    customer_id     uuid not null references customers(id) on delete cascade,
    conversation_id uuid references conversations(id) on delete set null,
    fire_at         timestamptz not null,
    context_reference text not null,
    message_template  text not null,
    status          text not null default 'pending'
                      check (status in ('pending','sent','cancelled','failed')),
    sent_at         timestamptz,
    created_at      timestamptz not null default now()
);
create index if not exists followups_due_idx on followups (status, fire_at)
    where status = 'pending';

-- =========================================================================
-- Checkout links (send_checkout_link — event log for attribution)
-- =========================================================================
create table if not exists checkout_links (
    id              uuid primary key default gen_random_uuid(),
    customer_id     uuid references customers(id) on delete set null,
    conversation_id uuid references conversations(id) on delete set null,
    product_ids     uuid[] not null,
    url             text not null,
    note            text,
    clicked_at      timestamptz,
    converted_at    timestamptz,
    created_at      timestamptz not null default now()
);
create index if not exists checkout_links_conversation_idx on checkout_links (conversation_id);

-- =========================================================================
-- RPC: vector search over products (filters match search_products tool spec)
-- =========================================================================
create or replace function match_products(
    query_embedding vector(1536),
    match_count     int default 5,
    f_category      text default null,
    f_shape         text default null,
    f_color         text default null,
    f_tags          text[] default null,
    f_in_stock      boolean default null
)
returns table (
    id uuid,
    sku text,
    name text,
    category text,
    shape text,
    color text,
    finish text,
    tags text[],
    price_cents int,
    in_stock boolean,
    description text,
    similarity float
)
language sql stable as $$
    select p.id, p.sku, p.name, p.category, p.shape, p.color, p.finish,
           p.tags, p.price_cents, p.in_stock, p.description,
           1 - (p.embedding <=> query_embedding) as similarity
    from products p
    where (f_category is null or p.category = f_category)
      and (f_shape    is null or p.shape    = f_shape)
      and (f_color    is null or p.color    = f_color)
      and (f_tags     is null or p.tags @> f_tags)
      and (f_in_stock is null or p.in_stock = f_in_stock)
    order by p.embedding <=> query_embedding
    limit match_count;
$$;

-- =========================================================================
-- RPC: vector search over brand knowledge
-- =========================================================================
create or replace function match_brand_knowledge(
    query_embedding vector(1536),
    match_count     int default 3
)
returns table (
    id uuid,
    topic text,
    title text,
    body text,
    source_url text,
    similarity float
)
language sql stable as $$
    select k.id, k.topic, k.title, k.body, k.source_url,
           1 - (k.embedding <=> query_embedding) as similarity
    from brand_knowledge k
    order by k.embedding <=> query_embedding
    limit match_count;
$$;

-- =========================================================================
-- Touch triggers for updated_at
-- =========================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists customers_touch on customers;
create trigger customers_touch before update on customers
    for each row execute function set_updated_at();

drop trigger if exists products_touch on products;
create trigger products_touch before update on products
    for each row execute function set_updated_at();

drop trigger if exists brand_knowledge_touch on brand_knowledge;
create trigger brand_knowledge_touch before update on brand_knowledge
    for each row execute function set_updated_at();

-- =========================================================================
-- Row Level Security
-- All tables exposed via PostgREST. Backend uses service_role (bypasses RLS).
-- No policies defined → anon/authenticated keys cannot read or write.
-- Add policies later if/when the widget needs direct Supabase access.
-- =========================================================================
alter table agents             enable row level security;
alter table customers          enable row level security;
alter table lead_score_events  enable row level security;
alter table conversations      enable row level security;
alter table messages           enable row level security;
alter table products           enable row level security;
alter table brand_knowledge    enable row level security;
alter table followups          enable row level security;
alter table checkout_links     enable row level security;
