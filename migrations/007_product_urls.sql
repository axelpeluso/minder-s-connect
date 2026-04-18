-- Store the real Bellezza storefront product URL on each product so
-- send_checkout_link returns a page the customer can actually buy from
-- (instead of an empty cart page).
-- Also refresh match_products to return url in search results.
-- Idempotent: safe to re-run.

alter table products add column if not exists url text;

update products set url = 'https://bellezza.miami/products/diy-kit-coffin-shape'
  where sku = 'bz-diy-coffin';
update products set url = 'https://bellezza.miami/products/diy-kit-square-shape-1'
  where sku = 'bz-diy-square';
update products set url = 'https://bellezza.miami/products/diy-kit-almond-shape-copy'
  where sku = 'bz-diy-almond';
update products set url = 'https://bellezza.miami/products/coffin-long'
  where sku = 'bz-tips-coffin-long';
update products set url = 'https://bellezza.miami/products/square-long-soft-gel-tips'
  where sku = 'bz-tips-square-long';
update products set url = 'https://bellezza.miami/products/nail-glue'
  where sku = 'bz-glue-toxic-free';
update products set url = 'https://bellezza.miami/products/lavender-cuticle-oil'
  where sku = 'bz-cuticle-lavender';
update products set url = 'https://bellezza.miami/products/coconut-cuticle-oil'
  where sku = 'bz-cuticle-coconut';
update products set url = 'https://bellezza.miami/products/rose-cuticle-oil'
  where sku = 'bz-cuticle-rose';

-- Recreate match_products to include url in the output columns.
drop function if exists match_products(vector, int, text, text, text, text[], boolean);

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
    url text,
    description text,
    similarity float
)
language sql stable as $$
    select p.id, p.sku, p.name, p.category, p.shape, p.color, p.finish,
           p.tags, p.price_cents, p.in_stock, p.url, p.description,
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
