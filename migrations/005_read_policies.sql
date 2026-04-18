-- Allow the anon role to SELECT from dashboard-relevant tables.
-- Writes stay restricted (service_role bypasses RLS; no other roles get INSERT/UPDATE).
-- Idempotent: drop-then-create so re-runs are safe.

drop policy if exists "anon read" on customers;
create policy "anon read" on customers
    for select to anon using (true);

drop policy if exists "anon read" on conversations;
create policy "anon read" on conversations
    for select to anon using (true);

drop policy if exists "anon read" on messages;
create policy "anon read" on messages
    for select to anon using (true);

drop policy if exists "anon read" on lead_score_events;
create policy "anon read" on lead_score_events
    for select to anon using (true);

drop policy if exists "anon read" on followups;
create policy "anon read" on followups
    for select to anon using (true);

drop policy if exists "anon read" on checkout_links;
create policy "anon read" on checkout_links
    for select to anon using (true);

drop policy if exists "anon read" on brand_knowledge;
create policy "anon read" on brand_knowledge
    for select to anon using (true);

drop policy if exists "anon read" on products;
create policy "anon read" on products
    for select to anon using (true);
