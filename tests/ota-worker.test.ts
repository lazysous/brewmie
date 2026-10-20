// Characterisation of the OTA worker's decision (ota/worker.js decide()), including the
// rollback paths scripts/ota_rollback.sh relies on. Audit 2026-10, brewmie-39.
import { describe, it, expect } from 'vitest'
import { decide, keepAliveRequest, cmpVersion } from '../ota/worker.js'

const live = { enabled: true, latestVersion: '1.1.2', latestUrl: 'https://brewmie.app/ota/builds/1.1.2.zip', revertToBuiltin: false, nativeVersion: '1.1' }

describe('ota worker decide()', () => {
  it('offers the latest bundle to a device on an older version', () => {
    expect(decide('1.1.1', live)).toEqual({ version: '1.1.2', url: 'https://brewmie.app/ota/builds/1.1.2.zip' })
    expect(decide('1.1', live)).toEqual({ version: '1.1.2', url: 'https://brewmie.app/ota/builds/1.1.2.zip' })
  })
  it('tells a device already on the latest bundle there is nothing new', () => {
    expect(decide('1.1.2', live).error).toBe('no_new_version_available')
  })
  it('serves nothing when updates are switched off, whatever the device reports', () => {
    expect(decide('0.0.1', { ...live, enabled: false }).error).toBe('no_new_version_available')
    expect(decide('9.9.9', { ...live, enabled: false }).error).toBe('no_new_version_available')
  })
  it('revert-to-builtin answers "builtin" for devices on an OTA bundle and leaves native devices alone', () => {
    const revert = { ...live, revertToBuiltin: true }
    expect(decide('1.1.2', revert)).toEqual({ version: 'builtin', url: '' })
    expect(decide('1.1.1', revert)).toEqual({ version: 'builtin', url: '' })
    expect(decide('1.1', revert).error).toBe('no_new_version_available')
  })
  it('a republished older zip is offered to devices on the bad newer bundle', () => {
    const rolledBack = { ...live, latestVersion: '1.1.1', latestUrl: 'https://brewmie.app/ota/builds/1.1.1.zip' }
    expect(decide('1.1.2', rolledBack)).toEqual({ version: '1.1.1', url: 'https://brewmie.app/ota/builds/1.1.1.zip' })
    expect(decide('1.1.1', rolledBack).error).toBe('no_new_version_available')
  })
})

describe('supabase keep-alive request (brewmie-90)', () => {
  it('reads one public_shots row with the anon key, trailing slash tolerated', () => {
    const r = keepAliveRequest({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_ANON_KEY: 'anon' })
    expect(r).toEqual({ url: 'https://x.supabase.co/rest/v1/public_shots?select=id&limit=1', headers: { apikey: 'anon', Authorization: 'Bearer anon', Accept: 'application/json' } })
  })
  it('refuses to build a request without the url or the key', () => {
    expect(keepAliveRequest({ SUPABASE_URL: 'https://x.supabase.co' })).toBeNull()
    expect(keepAliveRequest({ SUPABASE_ANON_KEY: 'anon' })).toBeNull()
    expect(keepAliveRequest(undefined)).toBeNull()
  })
})

describe('minimum native version gate (brewmie-23)', () => {
  const gated = { ...live, minNative: '1.1' }
  it('withholds the bundle from a device whose store binary is older than the one it was built against', () => {
    expect(decide('1.0.9', gated, '1.0').error).toBe('no_new_version_available')
    expect(decide('1.0.9', gated, '1.0.5').error).toBe('no_new_version_available')
  })
  it('offers it to devices on that native or newer, and when no native is reported', () => {
    expect(decide('1.0.9', gated, '1.1')).toEqual({ version: '1.1.2', url: 'https://brewmie.app/ota/builds/1.1.2.zip' })
    expect(decide('1.0.9', gated, '1.2')).toEqual({ version: '1.1.2', url: 'https://brewmie.app/ota/builds/1.1.2.zip' })
    expect(decide('1.0.9', gated, '')).toEqual({ version: '1.1.2', url: 'https://brewmie.app/ota/builds/1.1.2.zip' })
    expect(decide('1.0.9', gated, undefined)).toEqual({ version: '1.1.2', url: 'https://brewmie.app/ota/builds/1.1.2.zip' })
  })
  it('cmpVersion is numeric and tolerates missing parts', () => {
    expect(cmpVersion('1.1', '1.1.0')).toBe(0)
    expect(cmpVersion('1.10', '1.9')).toBe(1)
    expect(cmpVersion('1.0.9', '1.1')).toBe(-1)
    expect(cmpVersion('', '1.1')).toBe(-1)
  })
})
