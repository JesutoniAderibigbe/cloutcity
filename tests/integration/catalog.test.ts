/**
 * Catalog guards: the privilege model holds for every table and function, including ones a
 * later migration adds. A new table or RPC that forgets RLS, a grant or the attestation gate
 * fails here before it ships.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { newGuest, sql } from './helpers'

const S18_TABLES = [
  'entitlements',
  'friend_boosts',
  'friendships',
  'grants',
  'live_stats',
  'profiles',
  'purchases',
  'referrals',
  'roommates',
  'saves',
]

/** Functions allowed to skip the gate, each with a stated reason in its comment. */
const EXEMPT = ['attest_and_consent', 'set_audio_choice']

const CLIENT_ROLES = ['anon', 'authenticated']
const WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']

async function publicTables(): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    select c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    order by 1
  `
  return rows.map((row) => row.name)
}

interface FunctionRow {
  name: string
  schema: string
  oid: number
  definer: boolean
  config: string[] | null
  source: string
  comment: string | null
  /** Input argument names (OUT and TABLE columns left out). */
  args: string[] | null
}

async function functions(schemas: readonly string[]): Promise<FunctionRow[]> {
  return sql<FunctionRow[]>`
    select p.proname as name, n.nspname as schema, p.oid::int as oid, p.prosecdef as definer,
      p.proconfig as config, p.prosrc as source, obj_description(p.oid, 'pg_proc') as comment,
      (
        select array_agg(a.name order by a.ord)
        from unnest(p.proargnames, p.proargmodes::text[]) with ordinality as a(name, mode, ord)
        where coalesce(a.mode, 'i') in ('i', 'b', 'v')
      ) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = any(${schemas as string[]})
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 1
  `
}

/** Public functions the authenticated role (every guest) may call. */
async function clientRpcs(): Promise<FunctionRow[]> {
  const rows = await functions(['public'])
  const callable = await sql<{ oid: number }[]>`
    select p.oid::int as oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
  `
  const oids = new Set(callable.map((row) => row.oid))
  return rows.filter((row) => oids.has(row.oid))
}

const isExempt = (fn: FunctionRow) => /^@attestation-exempt: \S/.test(fn.comment ?? '')

/** Comments, string literals and dollar-quoted strings: text that is not code. */
const NOT_CODE = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g

/** The first statement after the body's `begin` calls the gate. */
function startsWithGate(source: string): boolean {
  const code = source.replace(NOT_CODE, ' ')
  const begin = /\bbegin\b/i.exec(code)
  if (begin === null) return false
  const body = code.slice(begin.index + begin[0].length).trimStart()
  return /^(?:\w+\s*:=\s*|perform\s+)private\.require_attestation\(\)\s*;/i.test(body)
}

describe('tables', () => {
  it('every S18 table exists', async () => {
    expect(await publicTables()).toEqual(expect.arrayContaining(S18_TABLES))
  })

  it('every public table has row level security', async () => {
    const rows = await sql<{ name: string }[]>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    `
    expect(rows).toEqual([])
  })

  it('no public views, which would bypass RLS as their owner', async () => {
    const rows = await sql<{ name: string }[]>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm')
    `
    expect(rows).toEqual([])
  })

  it('clients have no write privilege on any public table or column', async () => {
    const rows = await sql<{ role: string; name: string; privilege: string }[]>`
      select r.role, c.relname as name, p.privilege
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(${CLIENT_ROLES}::text[]) as r(role)
      cross join unnest(${WRITE_PRIVILEGES}::text[]) as p(privilege)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (has_table_privilege(r.role, c.oid, p.privilege)
          or (p.privilege in ('INSERT', 'UPDATE', 'REFERENCES')
            and has_any_column_privilege(r.role, c.oid, p.privilege)))
    `
    expect(rows).toEqual([])
  })

  it('anon reads only live_stats; authenticated reads exactly the S18 tables', async () => {
    const rows = await sql<{ role: string; name: string }[]>`
      select r.role, c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(${CLIENT_ROLES}::text[]) as r(role)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_any_column_privilege(r.role, c.oid, 'SELECT')
      order by 1, 2
    `
    expect(rows.filter((row) => row.role === 'anon').map((row) => row.name)).toEqual(['live_stats'])
    expect(rows.filter((row) => row.role === 'authenticated').map((row) => row.name)).toEqual(
      S18_TABLES,
    )
  })

  it('policies only ever grant SELECT (every write is an RPC or the service role)', async () => {
    const rows = await sql<{ table: string; policy: string; cmd: string }[]>`
      select tablename as table, policyname as policy, cmd from pg_policies
      where schemaname = 'public' and cmd <> 'SELECT'
    `
    expect(rows).toEqual([])
  })

  it('every S18 table has a read policy for authenticated', async () => {
    const rows = await sql<{ table: string }[]>`
      select distinct tablename as table from pg_policies
      where schemaname = 'public' and cmd = 'SELECT' and 'authenticated' = any(roles)
      order by 1
    `
    expect(rows.map((row) => row.table)).toEqual(S18_TABLES)
  })

  it('no column stores a birth year or age', async () => {
    const rows = await sql<{ table: string; column: string }[]>`
      select table_name as table, column_name as column from information_schema.columns
      where table_schema = 'public'
        and (column_name ilike '%birth%' or column_name ilike '%year%' or column_name ~* '(^|_)age($|_)')
    `
    expect(rows).toEqual([])
  })

  it('tables and functions a later migration adds start closed to clients', async () => {
    const rollback = new Error('rollback')
    await expect(
      sql.begin(async (tx) => {
        await tx`create table public.s18_probe (id int)`
        await tx`create function public.s18_probe_fn() returns int language sql as 'select 1'`
        const [row] = await tx<{ table: boolean; fn: boolean; publicFn: boolean }[]>`
          select
            has_table_privilege('anon', 'public.s18_probe', 'select')
              or has_table_privilege('authenticated', 'public.s18_probe', 'select')
              or has_table_privilege('authenticated', 'public.s18_probe', 'insert') as table,
            has_function_privilege('anon', 'public.s18_probe_fn()', 'execute')
              or has_function_privilege('authenticated', 'public.s18_probe_fn()', 'execute') as fn,
            exists (
              select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.proname = 's18_probe_fn' and a.grantee = 0
            ) as "publicFn"
        `
        expect(row).toEqual({ table: false, fn: false, publicFn: false })
        throw rollback
      }),
    ).rejects.toBe(rollback)
  })
})

describe('functions', () => {
  it('the private schema is closed to clients', async () => {
    const [row] = await sql<{ anon: boolean; auth: boolean }[]>`
      select has_schema_privilege('anon', 'private', 'usage') as anon,
        has_schema_privilege('authenticated', 'private', 'usage') as auth
    `
    expect(row).toEqual({ anon: false, auth: false })
  })

  it('no function in public or private is executable by anon or PUBLIC', async () => {
    const rows = await sql<{ name: string; grantee: string }[]>`
      select p.proname as name, 'anon' as grantee
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
      union all
      select p.proname, 'PUBLIC'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
        aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname in ('public', 'private') and a.grantee = 0
    `
    expect(rows).toEqual([])
  })

  it('no private helper is executable by authenticated', async () => {
    const rows = await sql<{ name: string }[]>`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')
    `
    expect(rows).toEqual([])
  })

  it("every function in public and private pins search_path = ''", async () => {
    const loose = (await functions(['public', 'private']))
      .filter((fn) => !(fn.config ?? []).includes('search_path=""'))
      .map((fn) => `${fn.schema}.${fn.name}`)
    expect(loose).toEqual([])
  })

  it('every security definer function is owned by postgres', async () => {
    const rows = await sql<{ name: string; owner: string }[]>`
      select p.proname as name, pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and pg_get_userbyid(p.proowner) <> 'postgres'
    `
    expect(rows).toEqual([])
  })

  it('the gate scanner reads what it must (self-check)', () => {
    expect(startsWithGate('declare v uuid; begin\n  v_uid := private.require_attestation();')).toBe(
      true,
    )
    expect(startsWithGate('begin perform private.require_attestation(); end')).toBe(true)
    expect(
      startsWithGate('begin if x then null; end if; perform private.require_attestation();'),
    ).toBe(false)
    expect(startsWithGate('select 1')).toBe(false)
    // A `begin` hidden in a comment or a string must not stand in for the body's own.
    expect(
      startsWithGate('/* begin perform private.require_attestation(); */ begin return 1; end'),
    ).toBe(false)
    expect(
      startsWithGate('-- begin v := private.require_attestation();\nbegin return 1; end'),
    ).toBe(false)
    expect(
      startsWithGate(
        "declare s text := 'begin perform private.require_attestation();'; begin return s; end",
      ),
    ).toBe(false)
    expect(
      startsWithGate(
        'declare s text := $x$ begin perform private.require_attestation(); $x$; begin return s; end',
      ),
    ).toBe(false)
  })
})

describe('exposed schemas', () => {
  it('the API exposes only public and graphql_public (the gate scan covers public)', () => {
    const config = readFileSync(resolve(import.meta.dirname, '../../supabase/config.toml'), 'utf8')
    const api = /^\[api\]$([\s\S]*?)^\[/m.exec(config)?.[1] ?? ''
    expect(/^schemas\s*=\s*(\[.*\])$/m.exec(api)?.[1]).toBe('["public", "graphql_public"]')
  })

  it("graphql_public holds only Supabase's graphql entry point, so no RPC hides there", async () => {
    const rows = await sql<{ name: string }[]>`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'graphql_public'
    `
    expect(rows.map((row) => row.name)).toEqual(['graphql'])
  })
})

describe('attestation gate: default deny', () => {
  it('every client RPC calls the gate first, or carries a stated exemption', async () => {
    const rpcs = await clientRpcs()
    expect(rpcs.map((fn) => fn.name)).toEqual(
      expect.arrayContaining(['assert_attested', 'send_friend_boost', ...EXEMPT]),
    )
    const ungated = rpcs
      .filter((fn) => !isExempt(fn) && !startsWithGate(fn.source))
      .map((fn) => fn.name)
    expect(ungated).toEqual([])
    expect(rpcs.filter(isExempt).map((fn) => fn.name)).toEqual(EXEMPT)
  })

  it('every gated client RPC refuses an unattested guest', async () => {
    const guest = await newGuest()
    const client = guest.client as unknown as SupabaseClient
    const gated = (await clientRpcs()).filter((fn) => !isExempt(fn))
    expect(gated.length).toBeGreaterThan(0)
    for (const fn of gated) {
      const args = Object.fromEntries((fn.args ?? []).map((name) => [name, null]))
      const { error } = await client.rpc(fn.name, args)
      expect(error?.message, fn.name).toBe('attestation_required')
    }
  })
})
