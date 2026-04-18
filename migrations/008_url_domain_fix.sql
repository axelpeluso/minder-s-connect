-- Switch product URLs from bellezza.miami to bellezzamiami.com (canonical domain).
-- Idempotent: only updates rows still on the old domain.

update products
   set url = replace(url, 'https://bellezza.miami/', 'https://bellezzamiami.com/')
 where url like 'https://bellezza.miami/%';
