import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query(`
    BEGIN;
    REVOKE cloudsqlsuperuser FROM relay_app;
    ALTER ROLE relay_app NOCREATEDB NOCREATEROLE;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT CONNECT ON DATABASE relay TO relay_app;
    GRANT USAGE ON SCHEMA relay TO relay_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA relay TO relay_app;
    REVOKE INSERT, UPDATE, DELETE ON relay.schema_migrations FROM relay_app;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA relay TO relay_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA relay GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO relay_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA relay GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO relay_app;
    COMMIT;
  `);
  console.log('Runtime database role restricted to application data access.');
} catch (error) {
  console.error('Database privilege configuration failed.', { code: /^[A-Z0-9]{5}$/.test(String(error?.code)) ? error.code : 'UNKNOWN' });
  process.exitCode = 1;
} finally { await pool.end(); }
