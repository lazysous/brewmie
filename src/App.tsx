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
import { supabase, fetchShots, fetchUserConfig, fetchAlgoParams, loadAlgoParams, fetchDisplayName, fetchTier } from './lib/supabase'
import { notifyAppReady, requestAppTrackingPermission } from './lib/native'
import { rescheduleAllReminders } from './lib/reminders'
import { trackScreen, track } from './lib/analytics'
import type { AlgoParams } from './lib/supabase'

interface WeatherData { temp: number; humidity: number }

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('brew')
  const { state, dispatch } = useBrewmie()
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
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

  // Load shots, config, and display name from Supabase when user signs in.
  // If the user has no display_name yet (first sign-in), prompt for one.
  useEffect(() => {
    if (!state.userId) return
    fetchShots(state.userId).then((shots) => {
      if (shots.length > 0) {
        dispatch({ type: 'HYDRATE', payload: { ...state, shots } })
      }
    }).catch(() => {})
    fetchUserConfig(state.userId).then((config) => {
      if (config) {
        dispatch({ type: 'HYDRATE', payload: { ...state, ...config } })
      }
    }).catch(() => {})
    fetchDisplayName(state.userId).then((name) => {
      if (name) {
        dispatch({ type: 'SET_DISPLAY_NAME', payload: name })
      } else {
        // First sign-in: open the modal in nickname-capture mode.
        setShowAuthModal(true)
      }
    }).catch(() => {})
    fetchTier(state.userId).then((tier) => {
      dispatch({ type: 'SET_TIER', payload: tier })
    }).catch(() => {})
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
        return <SetupScreen state={state} dispatch={dispatch} onSignIn={() => setShowAuthModal(true)} />
      case 'brew':
        return <BrewScreen state={state} dispatch={dispatch} onNavigateToSetup={() => setActiveTab('setup')} onSignIn={() => setShowAuthModal(true)} weather={weather} algoParams={algoParams} />
      case 'insights':
        return <InsightsScreen state={state} dispatch={dispatch} onSignIn={() => setShowAuthModal(true)} />
    }
  }

  return (
    <div className="app">
      <Hero
        activeTab={activeTab}
        state={state}
        dispatch={dispatch}
        weather={weather}
        onSignIn={() => setShowAuthModal(true)}
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
