import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { path } from "../src/lib/util";

// Runs the real migration on an in-memory Postgres with a minimal stand-in for Supabase's auth schema and roles.
const AUTH_STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;
const U1 = "00000000-0000-0000-0000-000000000001";
const U2 = "00000000-0000-0000-0000-000000000002";
const U3 = "00000000-0000-0000-0000-000000000003";

async function as(role: "anon" | "authenticated" | "postgres", uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  if (role !== "postgres") await db.exec(`set role ${role};`);
  try {
    return await db.query<any>(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { citext } });
  await db.exec(AUTH_STUB);
  for (const f of readdirSync(path("supabase/migrations")).sort()) await db.exec(readFileSync(path("supabase/migrations", f), "utf8"));
  await db.exec(`insert into auth.users values ('${U1}','buyer@example.com'),('${U2}','kid@example.com'),('${U3}','stranger@example.com');`);
});

describe("database rules", () => {
  it("anyone can sign up for the daily round; nobody can read the list", async () => {
    await as("anon", null, "insert into round_signups(email) values ('a@example.com')");
    await expect(as("anon", null, "insert into round_signups(email) values ('not-an-email')")).rejects.toThrow();
    await expect(as("anon", null, "insert into round_signups(email) values ('A@example.com')")).rejects.toThrow(/duplicate|unique/);
    await expect(as("anon", null, "select * from round_signups")).rejects.toThrow(/permission/);
  });

  it("only a paid, unrefunded buyer has a pass", async () => {
    expect((await as("authenticated", U1, "select has_pass() as p")).rows[0].p).toBe(false);
    await as("postgres", null, `insert into purchases(email,user_id,stripe_session_id,stripe_payment_intent,amount_cents) values ('buyer@example.com','${U1}','cs_1','pi_1',1900)`);
    expect((await as("authenticated", U1, "select has_pass() as p")).rows[0].p).toBe(true);
    expect((await as("authenticated", U3, "select has_pass() as p")).rows[0].p).toBe(false);
  });

  it("family group: owner creates it, members share the pass and see streaks, strangers see nothing", async () => {
    await expect(as("authenticated", U3, "select create_family('Nope')")).rejects.toThrow(/No active Family Pass/);
    const fid = (await as("authenticated", U1, "select create_family('The Lees') as id")).rows[0].id;
    await as("postgres", null, `insert into family_members(family_id,user_id,display_name) values ('${fid}','${U2}','Kid')`);
    expect((await as("authenticated", U2, "select has_pass() as p")).rows[0].p).toBe(true);
    await as("authenticated", U2, "insert into round_results(round_date,caught,total) values (current_date - 1, 2, 3), (current_date, 3, 3)");
    const fam = (await as("authenticated", U2, "select my_family() as f")).rows[0].f;
    expect(fam.name).toBe("The Lees");
    expect(fam.members.find((m: any) => m.display_name === "Kid").streak).toBe(2);
    expect((await as("authenticated", U3, "select my_family() as f")).rows[0].f).toBeNull();
    expect((await as("authenticated", U3, "select * from families")).rows).toEqual([]);
  });

  it("fire drill: taps are logged without sign-in and only the family sees them", async () => {
    const code = (await as("authenticated", U1, "select create_drill('Grandma') as c")).rows[0].c;
    expect(code).toMatch(/^[0-9a-f]{12}$/);
    await as("anon", null, "select log_drill_tap($1)", [code]);
    await as("anon", null, "select log_drill_tap('nonexistent')");
    expect((await as("authenticated", U1, "select taps from fire_drill_summary")).rows[0].taps).toBe(1);
    expect((await as("authenticated", U3, "select * from fire_drill_summary")).rows).toEqual([]);
    await expect(as("anon", null, "select * from fire_drill_taps")).rejects.toThrow(/permission/);
  });

  it("a refund ends access for the whole family", async () => {
    await as("postgres", null, "update purchases set refunded_at = now() where stripe_session_id = 'cs_1'");
    expect((await as("authenticated", U1, "select has_pass() as p")).rows[0].p).toBe(false);
    expect((await as("authenticated", U2, "select has_pass() as p")).rows[0].p).toBe(false);
  });
});
