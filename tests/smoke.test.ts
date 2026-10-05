// The harness itself: the private-export transform reaches the screens'
// pure functions, import.meta.env is served by Vite, jsdom is present.
import { describe, it, expect } from 'vitest'
import { computeScore } from '../src/screens/BrewScreen'
import { avgScore } from '../src/screens/InsightsScreen'
import { loadState, defaultState } from '../src/lib/storage'

describe('test harness', () => {
  it('reaches module-private functions in the screens', () => {
    expect(typeof computeScore).toBe('function')
    expect(computeScore(27, 36, 27, 36, 18)).toBe(100)
    expect(avgScore([])).toBeNull()
  })
  it('has a DOM and localStorage', () => {
    expect(typeof document).toBe('object')
    localStorage.removeItem('brewmie_v2')
    expect(loadState()).toEqual(defaultState)
  })
})
