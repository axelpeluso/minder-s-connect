-- Add 'nail_preparation' to the allowed product categories.
-- The catalog includes Nail Glue, which doesn't fit any of the original
-- four categories. Keeping 'paint_and_slay' even though no SKU uses it yet —
-- the gel polish line is part of the brand's planned catalog.
--
-- Idempotent: safe to re-run.

alter table products drop constraint if exists products_category_check;

alter table products add constraint products_category_check
    check (category in (
        'diy_kit',
        'cuticle_care',
        'soft_gel_tips',
        'paint_and_slay',
        'nail_preparation'
    ));
