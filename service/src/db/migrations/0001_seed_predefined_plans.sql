-- Custom SQL migration file, put your code below! --
-- Predefined plans (read-only). account_id = NULL means "available to every account".
-- Fixed ids so the README, tests and demo client can reference them.
INSERT INTO "plans" ("id", "account_id", "name", "scope", "monthly_allowance", "max_units_per_request") VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'Starter', 'account',  10000, 100),
  ('00000000-0000-0000-0000-000000000002', NULL, 'Pro',     'account', 100000, 500),
  ('00000000-0000-0000-0000-000000000003', NULL, 'Basic',   'user',      1000,  20),
  ('00000000-0000-0000-0000-000000000004', NULL, 'Premium', 'user',     10000, 100)
ON CONFLICT DO NOTHING;