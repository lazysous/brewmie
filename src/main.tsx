import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { I18nProvider } from './hooks/useTranslation'
import { ErrorBoundary } from './components/ErrorBoundary'
import { setBundleVersion } from './lib/analytics'
import { getBundleVersion } from './lib/native'
import './app.css'

// Which OTA bundle is running travels with every analytics event (audit brewmie-41).
getBundleVersion().then(setBundleVersion).catch(() => {})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
