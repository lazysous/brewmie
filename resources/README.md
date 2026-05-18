# Native asset sources

Masters for the iOS + Android launch screen and app icon. The
`ios/` and `android/` folders are gitignored, so these sources are
the canonical record.

- `splash.png` — 2732x2732, cream `#FAF7F2` background, Brewmie
  wordmark centred at ~38% width. Mirrors Lazy Sous's
  minimal-centred-logo approach.
- `icon.png` — 512x512, black bg with white B-as-cup mark.

## Regenerate native assets

```bash
npm i -D @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor "#000000" \
  --splashBackgroundColor "#FAF7F2"
```

That repopulates `ios/App/App/Assets.xcassets/Splash.imageset/`
and every `android/app/src/main/res/drawable*/splash.png` bucket.
The iOS LaunchScreen storyboard background colour is set
manually in `ios/App/App/Base.lproj/LaunchScreen.storyboard`
(`#FAF7F2`) — leave it as is.
