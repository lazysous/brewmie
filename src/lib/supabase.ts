import { createClient } from '@supabase/supabase-js'
import type { ShotEntry, BrewmieState, MachineConfig, GrinderConfig, TampConfig } from '../types'

// ---------------------------------------------------------------------------
// Replace these placeholders with your actual Supabase project credentials.
// Never commit real keys -- use environment variables in CI/production.
// ---------------------------------------------------------------------------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ─── Auth helpers ─────────────────────────────────────────────────────────────
// OAuth-only. We never see or store credentials; the provider holds them and
// Supabase hands us back a session token. The only thing we persist on our
// side is `display_name` (see fetchDisplayName / setDisplayName below).

async function isNative(): Promise<boolean> {
  const { Capacitor } = await import('@capacitor/core')
  return Capacitor.isNativePlatform()
}

function webRedirectTo(): string {
  return typeof window !== 'undefined'
    ? window.location.origin + window.location.pathname
    : '/'
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser()
  return data.user
}

export async function signInWithApple() {
  if (await isNative()) {
    const { SignInWithApple } = await import('@capacitor-community/apple-sign-in')
    const result = await SignInWithApple.authorize({
      clientId: 'app.brewmie.brewmie',
      redirectURI: SUPABASE_URL + '/auth/v1/callback',
      scopes: 'email name',
      nonce: Math.random().toString(36).slice(2),
    })
    return supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: result.response.identityToken,
    })
  }
  return supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: webRedirectTo() },
  })
}

export async function signInWithGoogle() {
  if (await isNative()) {
    const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
    const user = await GoogleAuth.signIn()
    return supabase.auth.signInWithIdToken({
      provider: 'google',
      token: user.authentication.idToken,
    })
  }
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: webRedirectTo() },
  })
}

export async function signInWithMeta() {
  return supabase.auth.signInWithOAuth({
    provider: 'facebook',
    options: { redirectTo: webRedirectTo() },
  })
}

export async function signInWithGitHub() {
  return supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: webRedirectTo() },
  })
}

// ─── Display name (the only user-identifying data we store) ──────────────────

export async function fetchDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .single()
  if (error) return null
  return (data?.display_name as string | null) ?? null
}

export async function setDisplayName(userId: string, displayName: string) {
  return supabase
    .from('profiles')
    .upsert({ id: userId, display_name: displayName }, { onConflict: 'id' })
}

// ─── Tier (free / premium) ───────────────────────────────────────────────────
// Production entitlement flow (when StoreKit / Play Billing is wired):
//   1. On launch, query the store for active non-consumable purchases.
//   2. If "Brewmie Premium" (or the bundle) is owned, set tier locally to 'premium'.
//   3. Cache the entitlement in localStorage so the app boots premium offline.
//   4. If a user signs in, mirror the receipt to profiles.tier for sync.
//   5. fetchTier(userId) below is only the SERVER read path for cross-device sync.
// Effective tier = localPurchaseEntitlement ?? state.tier (from server) ?? 'free'.

export async function fetchTier(userId: string): Promise<'free' | 'premium'> {
  const { data, error } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', userId)
    .single()
  if (error || !data) return 'free'
  return (data.tier as 'free' | 'premium') ?? 'free'
}

export async function setTier(userId: string, tier: 'free' | 'premium') {
  return supabase
    .from('profiles')
    .upsert({ id: userId, tier }, { onConflict: 'id' })
}

// ─── Shot sync helpers ────────────────────────────────────────────────────────

/**
 * Upsert a shot entry for the authenticated user.
 * The shots table is expected to have columns matching ShotEntry plus a user_id column.
 */
export async function upsertShot(shot: ShotEntry, userId: string) {
  return supabase
    .from('shots')
    .upsert({ ...shot, user_id: userId }, { onConflict: 'id' })
}

/**
 * Bulk-upsert all shots for a user (used for first-login migration).
 */
export async function bulkUpsertShots(shots: ShotEntry[], userId: string): Promise<void> {
  if (shots.length === 0) return
  await supabase
    .from('shots')
    .upsert(
      shots.map((s) => ({ ...s, user_id: userId })),
      { onConflict: 'id' }
    )
}

/**
 * Fetch all shots for the authenticated user, ordered newest-first.
 */
export async function fetchShots(userId: string): Promise<ShotEntry[]> {
  const { data, error } = await supabase
    .from('shots')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })

  if (error) {
    console.error('[Brewmie] fetchShots error:', error.message)
    return []
  }
  return (data ?? []) as ShotEntry[]
}

/**
 * Delete a shot by ID.
 */
export async function deleteShot(id: string) {
  return supabase.from('shots').delete().eq('id', id)
}

// ─── Config sync helpers ──────────────────────────────────────────────────────

type UserConfig = Pick<BrewmieState, 'units' | 'machine' | 'grinder' | 'tamp' | 'beans'>

/**
 * Upsert user config (machine, grinder, tamp, beans, units) into a profiles table.
 */
export async function upsertUserConfig(userId: string, config: UserConfig) {
  return supabase
    .from('profiles')
    .upsert({ id: userId, ...config }, { onConflict: 'id' })
}

// ─── Algorithm params (learned from public_shots) ────────────────────────────

export interface AlgoParams {
  n: number
  time_window: number   // acceptable ±seconds before triggering grind adjust
  hum_hi:     number | null  // avg time delta when humidity > 70%
  hum_lo:     number | null  // avg time delta when humidity < 40%
  tmp_hi:     number | null  // avg time delta when temp > 28°C
  tmp_lo:     number | null  // avg time delta when temp < 15°C
  age_fresh:  number | null  // avg time delta for 0-7 day beans
  age_stale:  number | null  // avg time delta for 30+ day beans
}

const ALGO_CACHE_KEY = 'brewmie_algo_v1'
const ALGO_CACHE_TTL = 24 * 60 * 60 * 1000  // 24 h

export async function fetchAlgoParams(): Promise<AlgoParams | null> {
  const { data, error } = await supabase.rpc('get_algo_params')
  if (error || !data) return null
  const params = data as AlgoParams
  try {
    localStorage.setItem(ALGO_CACHE_KEY, JSON.stringify({ params, ts: Date.now() }))
  } catch {}
  return params
}

export function loadAlgoParams(): AlgoParams | null {
  try {
    const raw = localStorage.getItem(ALGO_CACHE_KEY)
    if (!raw) return null
    const { params, ts } = JSON.parse(raw) as { params: AlgoParams; ts: number }
    if (Date.now() - ts > ALGO_CACHE_TTL) return null
    return params
  } catch {
    return null
  }
}

// ─── Public dataset helpers ───────────────────────────────────────────────────

function beanAgeBucket(age: number | null): string | null {
  if (age === null) return null
  if (age <= 7) return '0-7'
  if (age <= 14) return '8-14'
  if (age <= 21) return '15-21'
  if (age <= 30) return '22-30'
  return '30+'
}

type PublicShotContext = {
  machine: MachineConfig | null
  grinder: GrinderConfig | null
  tamp: TampConfig | null
}

/**
 * Insert an anonymised shot into public_shots (no user_id, bucketed bean age).
 * Caller must check analyticsOptOut before calling.
 */
export async function upsertPublicShot(shot: ShotEntry, ctx: PublicShotContext) {
  return supabase.from('public_shots').insert({
    machine_brand: ctx.machine?.brand ?? null,
    grinder_type: ctx.grinder?.type ?? null,
    tamp_type: ctx.tamp?.type ?? null,
    tamp_value: shot.inputTamp,
    grind: shot.inputGrind,
    dose: shot.inputDose,
    target_volume: shot.targetVolume,
    target_time: shot.targetTime,
    actual_volume: shot.actualVolume,
    actual_time: shot.actualTime,
    score: shot.score,
    taste_flavor: shot.tasteFlavor,
    taste_strength: shot.tasteStrength,
    bean_age_bucket: beanAgeBucket(shot.beanAge),
    roast_level: shot.roastLevel,
    temp: shot.temp,
    humidity: shot.humidity,
  })
}

export async function fetchUserConfig(userId: string): Promise<UserConfig | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('units, machine, grinder, tamp, beans')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('[Brewmie] fetchUserConfig error:', error.message)
    return null
  }
  return data as UserConfig
}
