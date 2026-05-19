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
import { supabase, fetchShots, fetchUserConfig, fetchAlgoParams, loadAlgoParams, fetchDisplayName, fetchTier, signInWithApple, signInWithGoogle } from './lib/supabase'
import { notifyAppReady, requestAppTrackingPermission } from './lib/native'
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

async function startSignIn(): Promise<void> {
  try {
    if (NATIVE_PLATFORM === 'ios') {
      await signInWithApple()
    } else if (NATIVE_PLATFORM === 'android') {
      await signInWithGoogle()
    }
  } catch { /* user cancelled or plugin unavailable; silent */ }
}

interface WeatherData { temp: number; humidity: number }

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('brew')
  const { state, dispatch } = useBrewmie()
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)

  // Sign-in entry from anywhere in the app. Native iOS goes straight to Apple,
  // native Android straight to Google. Only web falls back to the multi-
  // provider AuthModal.
  function handleSignInClick() {
    if (NATIVE_PLATFORM === 'web') {
      setShowAuthModal(true)
    } else {
      startSignIn()
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
    // Ask once on iOS — required by Apple before any analytics SDK runs.
    // No-op on web/Android. Result is system-cached; we don't re-prompt.
    requestAppTrackingPermission().catch(() => {})
    track('app_open')
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
    </div>
  )
}
