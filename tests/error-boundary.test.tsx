// The error boundary shows a recover screen instead of a blank app, and reports the
// error through analytics (audit brewmie-25 / brewmie-41).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

const spy = vi.hoisted(() => ({ track: vi.fn(), getBundleVersion: () => '1.1.3' }))
vi.mock('../src/lib/analytics', () => spy)
vi.mock('../src/lib/native', () => ({ resetToStoreBundle: async () => false }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }))

import { ErrorBoundary } from '../src/components/ErrorBoundary'

function Bomb(): JSX.Element { throw new Error('kaboom in render') }

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
  })
  it('shows the recover screen with reload, export and clear on a render error, and reports it', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Reload Brewmie')).toBeTruthy()
    expect(screen.getByText('Export my data')).toBeTruthy()
    expect(screen.getByText('Clear local data')).toBeTruthy()
    expect(screen.queryByText('Go back to the store version')).toBeNull()
    expect(spy.track).toHaveBeenCalledWith('js_error', { message: 'kaboom in render', where: 'render', bundle: '1.1.3' })
    err.mockRestore()
  })
})
