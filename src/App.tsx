import { useState, useEffect, useRef } from 'react'
import type { AppTab } from './types'
import { useBrewmie } from './hooks/useBrewmie'
import { Hero } from './components/Hero'
import { BottomNav } from './components/BottomNav'
import { AuthModal } from './components/AuthModal'
import { ConsentBanner } from './components/ConsentBanner'
import { PremiumModal } from './components/PremiumModal'
import { SetupScreen } from './screens/SetupScreen'
import { BrewScreen } from './screens/BrewScreen'
import { InsightsScreen } from './screens/InsightsScreen'
import { supabase, fetchShots, fetchUserConfig, fetchAlgoParams, loadAlgoParams, fetchDisplayName, fetchTier, signInWithApple, signInWithGoogle, bulkUpsertShots } from './lib/supabase'
import { initIAP, syncStoreOwnership } from './lib/iap'
import { notifyAppReady } from './lib/native'
import { localOnly } from './lib/shots'
import { markConfigHydrated, mergeServerConfig } from './lib/hydration'
import { Capacitor } from '@capacitor/core'
import { rescheduleAllReminders } from './lib/notifications'
import { trackScreen, track } from './lib/analytics'
import type { AlgoParams } from './lib/supabase'
import { weatherUrl, parseWeather, WEATHER_USER_AGENT } from './lib/weather'

// Native iOS opens Apple sign-in directly; Android opens Google directly.
// Web falls back to the AuthModal which offers multiple providers (no native
// Apple/Google on the web side).
const NATIVE_PLATFORM: 'ios' | 'android' | 'web' = Capacitor.isNativePlatform()
  ? (Capacitor.getPlatform() === 'android' ? 'android' : 'ios')
  : 'web'

async function startSignIn(): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = NATIVE_PLATFORM === 'ios'
      ? await signInWithApple()
      : NATIVE_PLATFORM === 'android'
        ? await signInWithGoogle()
        : null
    if (!result) return { ok: false }
    // signInWithIdToken returns { data: { user, session }, error }. The auth
    // state listener in App will dispatch SET_USER as soon as a session
    // exists; until then we treat the absence of a session as failure and
    // surface the provider error so the user isn't stuck on a dead button.
    const r = result as { data?: { user?: { id?: string } | null }; error?: { message?: string } | null }
    if (r.error) return { ok: false, error: r.error.message }
    if (!r.data?.user?.id) return { ok: false, error: 'Sign in did not return a session.' }
    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/cancel/i.test(msg)) return { ok: false }   // user cancelled — silent
    return { ok: false, error: msg }
  }
}

interface WeatherData { temp: number; humidity: number }

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('brew')
  const { state, dispatch } = useBrewmie()
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)

  // Sign-in entry. Native iOS goes straight to Apple, native Android straight
  // to Google. No interstitial modal. If the native plugin throws (capability
  // not wired or user cancels), silent — the OS already showed any error.
  // Web is the only path that opens the multi-provider AuthModal.
  const [signInError, setSignInError] = useState<string | null>(null)
  // App-level Premium modal opener for the Hero account dialog. Screen-level
  // PremiumModals (SetupScreen / BrewScreen / InsightsScreen) still own their
  // own state for in-context triggers (tap a Premium-badged row).
  const [headerPremiumOpen, setHeaderPremiumOpen] = useState(false)
  async function handleSignInClick() {
    setSignInError(null)
    if (NATIVE_PLATFORM === 'web') {
      setShowAuthModal(true)
      return
    }
    const result = await startSignIn()
    if (!result.ok && result.error) {
      setSignInError(result.error)
    }
  }
  const [algoParams, setAlgoParams] = useState<AlgoParams | null>(() => loadAlgoParams())

  // Restore Supabase session on mount and listen for auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      dispatch({ type: 'SET_USER', payload: data.session?.user.id ?? null })
    }).catch(() => {})

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      dispatch({ type: 'SET_USER', payload: session?.user.id ?? null })
    })

    return () => { subscription.unsubscribe() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch calibrated algorithm params on startup (cached 24h)
  useEffect(() => {
    fetchAlgoParams().then((p) => { if (p) setAlgoParams(p) }).catch(() => {})
    // Tell the Capacitor Updater the app loaded cleanly so it doesn't roll
    // back the latest OTA bundle.
    notifyAppReady()
    // No ATT call: Brewmie doesn't use IDFA or any tracking SDK, so the
    // NSUserTrackingUsageDescription key was removed. Calling
    // ATTrackingManager.requestTrackingAuthorization without that key
    // crashes the app on launch (Apple enforces this). If we ever add a
    // tracking SDK we need to put the key back AND uncomment this call.
    track('app_open')
    // Boot the IAP store. On native this loads the Premium product and wires
    // verified-receipt callbacks; on web it's a no-op. When the store reports
    // ownership (either now from a restored receipt or later from a purchase),
    // we flip tier=premium locally. Ownership lives in the App Store / Play
    // account and Restore Purchases carries it to other devices; the client
    // no longer writes profiles.tier (the column is read-only to clients
    // since 2026-10-05, after a review found any signed-in user could set it).
    // Then check the store once at launch (brewmie-08/-65): owned grants
    // Premium, an affirmative "not owned" after a store purchase revokes it.
    initIAP(
      () => { dispatch({ type: 'SET_TIER', payload: 'premium' }) },
      { onNotOwned: () => { dispatch({ type: 'STORE_REVOKE_PREMIUM' }) } },
    ).then(() => syncStoreOwnership()).catch(() => {})
  }, [])

  // Track tab changes as screen views
  useEffect(() => {
    trackScreen(activeTab)
  }, [activeTab])

  // Reschedule local notifications whenever maintenance dates or bean roast
  // date change. Native-only; web is a no-op.
  useEffect(() => {
    rescheduleAllReminders(state).catch(() => {})
  }, [
    state.maintenance?.lastBackflush,
    state.maintenance?.lastDescale,
    state.maintenance?.lastGrinderClean,
    state.beans?.roastDate,
  ])

  // Load shots, config, display name, and tier from Supabase when user signs
  // in. The three HYDRATE-style fetches resolve in parallel but merge their
  // results into a SINGLE dispatch at the end. Previously each dispatched its
  // own `HYDRATE` with `{ ...state, ... }` and whichever resolved last would
  // clobber the others (e.g. config landing after shots wiped the shots array
  // until the next reducer write).
  const shotsRef = useRef(state.shots)
  const deletedRefForHydrate = useRef<string[]>(state.deletedShotIds ?? [])
  useEffect(() => { shotsRef.current = state.shots; deletedRefForHydrate.current = state.deletedShotIds ?? [] }, [state.shots, state.deletedShotIds])
  useEffect(() => {
    if (!state.userId) return
    const uid = state.userId
    Promise.allSettled([
      fetchShots(uid),
      fetchUserConfig(uid),
      fetchDisplayName(uid),
      fetchTier(uid),
    ]).then(([shotsResult, configResult, nameResult, tierResult]) => {
      const merge: Partial<typeof state> = {}
      if (shotsResult.status === 'fulfilled') {
        // Union with the live local list (reducer), then upload whatever the server lacks:
        // shots recorded signed out or during a failed sync (audit brewmie-01).
        const serverShots = shotsResult.value
        dispatch({ type: 'HYDRATE_SHOTS', payload: serverShots })
        const missing = localOnly(shotsRef.current, serverShots, deletedRefForHydrate.current)
        if (missing.length > 0) {
          bulkUpsertShots(missing, uid).then(({ error }) => {
            if (error) track('sync_failed', { op: 'hydrate_upload' })
          }).catch(() => track('sync_failed', { op: 'hydrate_upload' }))
        }
      }
      if (configResult.status === 'fulfilled') {
        // Null server columns never erase what the device holds (audit brewmie-07).
        Object.assign(merge, mergeServerConfig(configResult.value))
      }
      if (Object.keys(merge).length > 0) {
        // Merged by the reducer against the live state. The old HYDRATE spread
        // the `state` this effect closed over at sign-in time, so anything the
        // user did while the fetch was in flight was thrown away.
        dispatch({ type: 'MERGE', payload: merge })
      }
      // Only now may the device push its config back (see useBrewmie's config effect).
      if (configResult.status === 'fulfilled') markConfigHydrated(uid)
      if (nameResult.status === 'fulfilled') {
        if (nameResult.value) {
          dispatch({ type: 'SET_DISPLAY_NAME', payload: nameResult.value })
        } else {
          // First sign-in: open the modal in nickname-capture mode.
          setShowAuthModal(true)
        }
      }
      if (tierResult.status === 'fulfilled') {
        dispatch({ type: 'SET_TIER', payload: tierResult.value })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.userId])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const url = weatherUrl(coords.latitude, coords.longitude)
        fetch(url, { headers: { 'User-Agent': WEATHER_USER_AGENT } }).then(r => r.json()).then(data => {
          const w = parseWeather(data)
          if (w) setWeather(w)
        }).catch(() => {})
      },
      () => {},
      { timeout: 6000 }
    )
  }, [])

  const renderScreen = () => {
    switch (activeTab) {
      case 'setup':
        return <SetupScreen state={state} dispatch={dispatch} onSignIn={handleSignInClick} />
      case 'brew':
        return <BrewScreen state={state} dispatch={dispatch} onNavigateToSetup={() => setActiveTab('setup')} onSignIn={handleSignInClick} weather={weather} algoParams={algoParams} />
      case 'insights':
        return <InsightsScreen state={state} dispatch={dispatch} onSignIn={handleSignInClick} />
    }
  }

  return (
    <div className="app">
      <Hero
        activeTab={activeTab}
        state={state}
        dispatch={dispatch}
        weather={weather}
        onSignIn={handleSignInClick}
        onHome={() => setActiveTab('brew')}
        onOpenPremium={() => setHeaderPremiumOpen(true)}
      />
      <main className="screen-content" role="main">
        {renderScreen()}
      </main>
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        dispatch={dispatch}
        nicknameForUser={state.userId && !state.displayName ? state.userId : null}
      />
      {/* App-level Premium modal opened from the Hero account dialog. Screen
          modals (SetupScreen / BrewScreen / InsightsScreen) keep their own
          for in-context taps of premium-badged rows. */}
      <PremiumModal
        open={headerPremiumOpen}
        onClose={() => setHeaderPremiumOpen(false)}
        trigger={null}
        isSignedIn={!!state.userId}
        isPremium={state.tier === 'premium'}
      />
      <ConsentBanner />
      {signInError && (
        <div
          role="alert"
          onClick={() => setSignInError(null)}
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top) + 64px)',
            left: 16,
            right: 16,
            zIndex: 9998,
            padding: '12px 14px',
            background: '#8B1A1A',
            color: '#fff',
            borderRadius: 12,
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
            fontSize: 13,
            lineHeight: 1.4,
            cursor: 'pointer',
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4 }}>Sign in failed</strong>
          {signInError}
        </div>
      )}
    </div>
  )
}
