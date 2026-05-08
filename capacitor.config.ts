import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.brewmie.brewmie',
  appName: 'Brewmie',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
