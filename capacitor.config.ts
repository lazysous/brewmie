import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.brewmie.brewmie',
  appName: 'Brewmie',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  ios: {
    // Edge-to-edge: WebView fills the safe area, CSS handles the inset via
    // env(safe-area-inset-*) variables. The legacy 'automatic' value also
    // applied UIScrollView insets, which on iOS 17+ double-pushed content
    // and clipped the header on Pro Max devices.
    contentInset: 'never',
    backgroundColor: '#FAF7F2',
    preferredContentMode: 'mobile',
  },
  android: {
    backgroundColor: '#FAF7F2',
  },
  plugins: {
    GoogleAuth: {
      // Web client ID from GCP project 'notional-gist-496404-q9' (Brewmie).
      // Same value used by Supabase's Google provider to verify ID tokens.
      //
      // TODO when ready to ship native UX: create iOS + Android OAuth clients
      // in GCP and set iosClientId + androidClientId respectively. Until then
      // the plugin falls back to the Web client which still authenticates
      // correctly against Supabase, just via a web consent screen rather
      // than the platform-native sheet.
      scopes: ['email', 'profile'],
      clientId: '451962407650-pdgbmlp6kevujrlqr433spr0t3u1mrts.apps.googleusercontent.com',
      serverClientId: '451962407650-pdgbmlp6kevujrlqr433spr0t3u1mrts.apps.googleusercontent.com',
      forceCodeForRefreshToken: false,
    },
    CapacitorUpdater: {
      // OTA bundle delivery. Worker checks the device's installed version on
      // launch + every ~1h and serves the latest if newer. No App Store
      // resubmission required for JS/CSS/asset changes.
      autoUpdate: true,
      statsUrl: '',
      updateUrl: 'https://brewmie-ota.richbwilliamson.workers.dev',
    },
  },
}

export default config
