import { useState, useEffect } from 'react'
import type { AppTab } from './types'
import { useBrewmie } from './hooks/useBrewmie'
import { Hero } from './components/Hero'
import { BottomNav } from './components/BottomNav'
import { GlobalShotCounter } from './components/GlobalShotCounter'
import { AuthModal } from './components/AuthModal'
import { ConsentBanner } from './components/ConsentBanner'
import { DevTierPill } from './components/DevTierPill'
import { SetupScreen } from './screens/SetupScreen'
import { BrewScreen } from './screens/BrewScreen'
import { InsightsScreen } from './screens/InsightsScreen'
import { supabase, fetchShots, fetchUserConfig, fetchAlgoParams, loadAlgoParams, fetchDisplayName, fetchTier, setTier as persistTier, signInWithApple, signInWithGoogle } from './lib/supabase'
import { initIAP } from './lib/iap'
import { notifyAppReady } from './lib/native'
import { Capacitor } from '@capacitor/core'
import { rescheduleAllReminders } from './lib/notifications'
import { trackScreen, track } from './lib/analytics'
import type { AlgoParams } from './lib/supabase'

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
    // we flip tier=premium locally and best-effort persist to Supabase if the
    // user is signed in.
    initIAP(() => {
      dispatch({ type: 'SET_TIER', payload: 'premium' })
      const uid = supabase.auth.getUser().then(({ data }) => data.user?.id)
      uid.then((u) => { if (u) persistTier(u, 'premium').catch(() => {}) })
    }).catch(() => {})
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
      if (shotsResult.status === 'fulfilled' && shotsResult.value.length > 0) {
        merge.shots = shotsResult.value
      }
      if (configResult.status === 'fulfilled' && configResult.value) {
        Object.assign(merge, configResult.value)
      }
      if (Object.keys(merge).length > 0) {
        dispatch({ type: 'HYDRATE', payload: { ...state, ...merge } })
      }
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
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,relative_humidity_2m`
        fetch(url).then(r => r.json()).then(data => {
          const temp = data?.current?.temperature_2m
          const humidity = data?.current?.relative_humidity_2m
          if (typeof temp === 'number' && typeof humidity === 'number') {
            setWeather({ temp: Math.round(temp), humidity: Math.round(humidity) })
          }
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
      />
      <main className="screen-content" role="main">
        {renderScreen()}
      </main>
      <GlobalShotCounter />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        dispatch={dispatch}
        nicknameForUser={state.userId && !state.displayName ? state.userId : null}
      />
      <ConsentBanner />
      <DevTierPill />
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
