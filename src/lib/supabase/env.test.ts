import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authCallbackUrl, siteOrigin, siteUrlsAgree, supabaseEnv } from './env'

describe('supabaseEnv (S05)', () => {
  it('returns the URL and anon key when both are set', () => {
    expect(supabaseEnv({ url: 'http://127.0.0.1:54321', anonKey: 'key' })).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'key',
    })
    expect(supabaseEnv({ url: ' https://abc.supabase.co ', anonKey: ' key ' })).toEqual({
      url: 'https://abc.supabase.co',
      anonKey: 'key',
    })
  })

  it('is null when either is missing or blank (the e2e build blanks both)', () => {
    expect(supabaseEnv({ url: undefined, anonKey: undefined })).toBeNull()
    expect(supabaseEnv({ url: '', anonKey: '' })).toBeNull()
    expect(supabaseEnv({ url: 'https://abc.supabase.co', anonKey: '   ' })).toBeNull()
    expect(supabaseEnv({ url: undefined, anonKey: 'key' })).toBeNull()
  })

  it('is null for a URL that does not parse or is not http(s)', () => {
    expect(supabaseEnv({ url: 'abc.supabase.co', anonKey: 'key' })).toBeNull()
    expect(supabaseEnv({ url: 'javascript:alert(1)', anonKey: 'key' })).toBeNull()
    expect(supabaseEnv({ url: 'ftp://abc.supabase.co', anonKey: 'key' })).toBeNull()
  })

  it('reads the build variables by their full names, so Next.js inlines them', () => {
    const source = readFileSync(join(import.meta.dirname, 'env.ts'), 'utf8')
    expect(source).toContain('process.env.NEXT_PUBLIC_SUPABASE_URL')
    expect(source).toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })
})

describe('account links (S19)', () => {
  it('land on <site>/auth/callback, from the configured origin only', () => {
    expect(authCallbackUrl('https://cloutcity.example')).toBe(
      'https://cloutcity.example/auth/callback',
    )
    expect(authCallbackUrl(' https://cloutcity.example/some/path?x=1#y ')).toBe(
      'https://cloutcity.example/auth/callback',
    )
    expect(authCallbackUrl('http://localhost:3102')).toBe('http://localhost:3102/auth/callback')
  })

  it('fail closed without a usable site URL', () => {
    for (const bad of [
      undefined,
      '',
      '  ',
      'cloutcity.example',
      'javascript:alert(1)',
      'ftp://x.y',
    ]) {
      expect(authCallbackUrl(bad), String(bad)).toBeNull()
      expect(siteOrigin(bad), String(bad)).toBeNull()
    }
  })

  it('the browser and server site URLs must name the same origin when both are set', () => {
    expect(siteUrlsAgree('https://a.example', 'https://a.example/mod')).toBe(true)
    expect(siteUrlsAgree('https://a.example', undefined)).toBe(true)
    expect(siteUrlsAgree(undefined, 'https://a.example')).toBe(true)
    expect(siteUrlsAgree('https://a.example', 'https://b.example')).toBe(false)
    expect(siteUrlsAgree('http://a.example', 'https://a.example')).toBe(false)
  })

  it('next.config.ts refuses a build where they differ', () => {
    const config = readFileSync(join(import.meta.dirname, '../../../next.config.ts'), 'utf8')
    expect(config).toContain('process.env.NEXT_PUBLIC_SITE_URL')
    expect(config).toContain('process.env.SITE_URL')
    expect(config).toMatch(/throw new Error\(\s*'NEXT_PUBLIC_SITE_URL and SITE_URL/)
  })
})
