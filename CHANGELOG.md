# Changelog

Release record for the native binaries. `scripts/release_preflight.sh` reads the
"Current shipped versions" line below, so update it in the same commit as every
native release (and as soon as Apple approves a build).

> Current shipped versions: Android 1.1.1 (versionCode 8) is live on Play production (100% since 2026-10-22). iOS 1.1.1 (build 13) is live on the App Store (READY_FOR_SALE, read from App Store Connect on 2026-10-23).

OTA bundles are separate: each is tagged `ota-v<version>` by `scripts/ota_push.sh`.
Native releases are tagged `native-v<iOS MARKETING_VERSION>` by `scripts/release.sh native`.
