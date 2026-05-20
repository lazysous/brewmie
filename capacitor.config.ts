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
      // The Android side of @codetrix-studio/capacitor-google-auth reads
      // `clientId` (NOT `serverClientId`) when building the ID-token request.
      // Without it the plugin falls back to R.string.server_client_id which
      // we don't define, and Google returns DEVELOPER_ERROR (code 10).
      // clientId/serverClientId both point at the Web client so the audience
      // matches what Supabase expects to verify.
      // iosClientId drives the native Apple-style sheet on iOS.
      scopes: ['email', 'profile'],
      clientId: '451962407650-pdgbmlp6kevujrlqr433spr0t3u1mrts.apps.googleusercontent.com',
      iosClientId: '451962407650-tlvmc7fh70vr8peb7p0c445p1lfuv562.apps.googleusercontent.com',
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
