import React from 'react'
import { track, getBundleVersion } from '../lib/analytics'
import { resetToStoreBundle } from '../lib/native'
import { Capacitor } from '@capacitor/core'

// A render error used to blank the app permanently (audit brewmie-25). This boundary
// reports it (through the analytics opt-out path, with the bundle version) and shows a
// recover screen: reload, export the local data, clear the local data, and on a device
// go back to the bundle shipped in the store binary. Plain English on purpose: the
// translation provider may be part of what failed.
type Props = { children: React.ReactNode }
type State = { error: Error | null; busy: boolean }

const STORAGE_KEY = 'brewmie_v2'

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, busy: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Brewmie] render error', error, info?.componentStack)
    track('js_error', {
      message: String(error?.message ?? error).slice(0, 120),
      where: 'render',
      bundle: getBundleVersion(),
    })
  }

  exportData = () => {
    let raw = ''
    try { raw = localStorage.getItem(STORAGE_KEY) ?? '' } catch { /* ignore */ }
    const blob = new Blob([raw || '{}'], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `brewmie-data-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  clearData = () => {
    if (!window.confirm('Clear the local Brewmie data on this device? Export it first if you want to keep it.')) return
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    window.location.reload()
  }

  resetBundle = async () => {
    this.setState({ busy: true })
    const ok = await resetToStoreBundle()
    if (!ok) { this.setState({ busy: false }); window.location.reload() }
  }

  render() {
    if (!this.state.error) return this.props.children
    const native = Capacitor.isNativePlatform()
    const btn: React.CSSProperties = { display: 'block', width: '100%', padding: '14px', margin: '8px 0', borderRadius: 12, border: '1px solid #567A48', background: '#567A48', color: '#fff', fontSize: 16 }
    const ghost: React.CSSProperties = { ...btn, background: 'transparent', color: '#567A48' }
    return (
      <div role="alert" style={{ minHeight: '100vh', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', background: '#FBF8F3', color: '#2B2B2B', boxSizing: 'border-box' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Brewmie hit a problem</h1>
        <p style={{ marginBottom: 20, lineHeight: 1.5 }}>Something went wrong while drawing the screen. Your shots are still saved on this device.</p>
        <p style={{ marginBottom: 24, fontSize: 13, color: '#6B6B6B', wordBreak: 'break-word' }}>{String(this.state.error.message ?? this.state.error).slice(0, 200)}</p>
        <button style={btn} onClick={() => window.location.reload()}>Reload Brewmie</button>
        <button style={ghost} onClick={this.exportData}>Export my data</button>
        {native && <button style={ghost} disabled={this.state.busy} onClick={this.resetBundle}>{this.state.busy ? 'Resetting...' : 'Go back to the store version'}</button>}
        <button style={ghost} onClick={this.clearData}>Clear local data</button>
      </div>
    )
  }
}
