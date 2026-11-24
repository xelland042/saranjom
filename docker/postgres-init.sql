-- Runs once, when the compose database is first created.
-- The app connects as this role: it owns no tables, so row-level security applies to it.
-- Migrations (as the owner, open_erp) grant it what it needs. Development password only.
CREATE ROLE open_erp_app LOGIN PASSWORD 'open_erp_app';
