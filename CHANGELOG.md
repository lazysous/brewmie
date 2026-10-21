# Changelog

Release record for the native binaries. `scripts/release_preflight.sh` reads the
"Current shipped versions" line below, so update it in the same commit as every
native release (and as soon as Apple approves a build).

> Current shipped versions (verify): Android 1.1 (versionCode 7) is live on Play production. iOS 1.1 (build 12) was submitted for review on 2026-10-06.

OTA bundles are separate: each is tagged `ota-v<version>` by `scripts/ota_push.sh`.
Native releases are tagged `native-v<iOS MARKETING_VERSION>` by `scripts/release.sh native`.
