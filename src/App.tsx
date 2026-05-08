import { useState, useEffect } from 'react'
import type { AppTab } from './types'
import { useBrewmie } from './hooks/useBrewmie'
import { Header } from './components/Header'
import { SubHeader } from './components/SubHeader'
import { BottomNav } from './components/BottomNav'
import { AuthModal } from './components/AuthModal'
import { ConsentBanner } from './components/ConsentBanner'
import { SetupScreen } from './screens/SetupScreen'
import { BrewScreen } from './screens/BrewScreen'
import { InsightsScreen } from './screens/InsightsScreen'
import { fetchShots, fetchUserConfig, fetchAlgoParams, loadAlgoParams } from './lib/supabase'
import type { AlgoParams } from './lib/supabase'

interface WeatherData { temp: number; humidity: number }

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('brew')
  const { state, dispatch } = useBrewmie()
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [algoParams, setAlgoParams] = useState<AlgoParams | null>(() => loadAlgoParams())

  // Fetch calibrated algorithm params on startup (cached 24h)
  useEffect(() => {
    fetchAlgoParams().then((p) => { if (p) setAlgoParams(p) }).catch(() => {})
  }, [])

  // Load shots + config from Supabase when user signs in
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
        return <SetupScreen state={state} dispatch={dispatch} />
      case 'brew':
        return <BrewScreen state={state} dispatch={dispatch} onNavigateToSetup={() => setActiveTab('setup')} weather={weather} algoParams={algoParams} />
      case 'insights':
        return <InsightsScreen state={state} dispatch={dispatch} />
    }
  }

  return (
    <div className="app">
      <Header state={state} dispatch={dispatch} onSignIn={() => setShowAuthModal(true)} />
      <SubHeader activeTab={activeTab} state={state} weather={weather} />
      <main className="screen-content" role="main">
        {renderScreen()}
      </main>
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        dispatch={dispatch}
      />
      <ConsentBanner />
    </div>
  )
}
