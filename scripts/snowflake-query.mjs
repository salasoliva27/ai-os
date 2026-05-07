#!/usr/bin/env node
// One-shot Snowflake query runner. Reuses the dashboard-bridge connection
// settings (USERNAME_PASSWORD_MFA + cached MFA token) so repeat invocations
// inside the 4h credential window skip the Duo push.
//
// Usage:
//   node scripts/snowflake-query.mjs "SELECT current_user();"
//   echo "SELECT 1;" | node scripts/snowflake-query.mjs --stdin
//
// Output: JSON { ok, rows, columns, rowCount, elapsedMs } on stdout.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(here, "..", "dashboard");
const require = createRequire(path.join(dashboardDir, "package.json"));
const snowflake = require("snowflake-sdk");
try { snowflake.configure({ logLevel: "OFF" }); } catch {}

const args = process.argv.slice(2);
let sql;
if (args[0] === "--stdin") {
  sql = fs.readFileSync(0, "utf-8");
} else if (args[0] === "--file" && args[1]) {
  sql = fs.readFileSync(args[1], "utf-8");
} else if (args.length > 0) {
  sql = args.join(" ");
} else {
  console.error("usage: snowflake-query.mjs <SQL> | --stdin | --file <path>");
  process.exit(2);
}
if (sql.charCodeAt(0) === 0xFEFF) sql = sql.slice(1);

const need = ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PASSWORD"];
const missing = need.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const conn = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT,
  username: process.env.SNOWFLAKE_USER,
  password: process.env.SNOWFLAKE_PASSWORD,
  warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  database: process.env.SNOWFLAKE_DATABASE,
  schema: process.env.SNOWFLAKE_SCHEMA,
  role: process.env.SNOWFLAKE_ROLE,
  authenticator: "USERNAME_PASSWORD_MFA",
  clientRequestMfaToken: true,
  clientStoreTemporaryCredential: true,
  retryTimeout: 30,
});

const connectPromise = new Promise((resolve, reject) => {
  conn.connect(err => (err ? reject(err) : resolve()));
});
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error("connect timeout (60s)")), 60_000)
);
try {
  await Promise.race([connectPromise, timeoutPromise]);
} catch (err) {
  process.stderr.write(`connect failed: ${err.message || err}\n`);
  try { conn.destroy(() => {}); } catch {}
  process.exit(3);
}

const t0 = Date.now();
const rows = await new Promise((resolve, reject) => {
  conn.execute({
    sqlText: sql,
    complete: (err, _stmt, rowData) => (err ? reject(err) : resolve(rowData ?? [])),
  });
});
const elapsedMs = Date.now() - t0;
const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

process.stdout.write(JSON.stringify({ ok: true, rows, columns, rowCount: rows.length, elapsedMs }, null, 2));
process.stdout.write("\n");

await new Promise(resolve => conn.destroy(() => resolve()));
