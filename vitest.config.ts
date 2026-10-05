import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Several accuracy-critical functions (the dial-in algorithm in BrewScreen,
// the stats helpers in InsightsScreen) are module-private. To fence them
// without editing the screens, this plugin appends an export list to those
// two files at test time only. The production build never sees it.
const TEST_EXPORTS: Record<string, string[]> = {
  'src/screens/BrewScreen.tsx': [
    'computeScore', 'computeAdjustments', 'personalTimeWindow', 'beanAge',
    'sameBagShots', 'median', 'defaultTargets', 'ROAST_TIME_OFFSET', 'ROAST_STARTING_POINT',
  ],
  'src/screens/InsightsScreen.tsx': [
    'groupShotsByDate', 'getFirstShots', 'avgScore', 'optimalGrind', 'stdDev',
    'consistencyKey', 'dialInDays', 'adjustmentLabel',
  ],
}

function exposePrivatesForTests(): Plugin {
  return {
    name: 'brewmie-expose-privates-for-tests',
    enforce: 'pre',
    transform(code, id) {
      for (const [suffix, names] of Object.entries(TEST_EXPORTS)) {
        if (id.endsWith(suffix)) {
          return { code: code + `\nexport { ${names.join(', ')} }\n`, map: null }
        }
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [exposePrivatesForTests(), react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: false,
    testTimeout: 15000,
  },
})
