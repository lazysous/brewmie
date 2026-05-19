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
      // TODO before launch: replace these placeholders with Brewmie's Google
      // OAuth client IDs from the Firebase console (Project Settings > Your
      // apps > iOS / Android). The serverClientId is the Web Client ID — used
      // by Supabase to verify the Google idToken on the server side.
      scopes: ['email', 'profile'],
      clientId: 'REPLACE-WITH-BREWMIE-WEB-CLIENT-ID.apps.googleusercontent.com',
      serverClientId: 'REPLACE-WITH-BREWMIE-WEB-CLIENT-ID.apps.googleusercontent.com',
      iosClientId: 'REPLACE-WITH-BREWMIE-IOS-CLIENT-ID.apps.googleusercontent.com',
      androidClientId: 'REPLACE-WITH-BREWMIE-ANDROID-CLIENT-ID.apps.googleusercontent.com',
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
