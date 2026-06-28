# @engagekaro/react-native

EngageKaro SDK for React Native — identify users, register push tokens, set tags, and track events.

Push uses **native modules** (APNs on iOS, FCM on Android). API calls run in JavaScript via `fetch`.

## Install

```bash
npm install @engagekaro/react-native
# or link locally:
npm install ../sdks/react-native
```

### iOS

```bash
cd ios && pod install
```

- Enable Push Notifications + Background Modes + App Groups (same as [iOS setup](../flutter/IOS_SETUP.md)).
- Forward the APNs device token from AppDelegate to the native module if needed.

### Android

- Add `google-services.json` and Firebase Gradle plugin (same as [Android setup](../flutter/ANDROID_SETUP.md)).
- Register the package in `MainApplication`:

```kotlin
import com.engagekaro.reactnative.EngagekaroReactNativePackage

override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply { add(EngagekaroReactNativePackage()) }
```

## Quick start

```tsx
import { EngageKaro } from "@engagekaro/react-native";

EngageKaro.initialize({
  appId: "YOUR_PROJECT_ID",
  apiKey: "ek_client_...",
  baseUrl: "https://api.yourhost.com",
});

await EngageKaro.login("user-123");
await EngageKaro.requestPushPermission();
await EngageKaro.trackEvent("app_open");

// iOS NSE config (optional):
await EngageKaro.shareConfig({
  appGroup: "group.com.yourcompany.app.engagekaro",
  apiBase: "https://api.yourhost.com",
  apiKey: "ek_client_...",
  externalId: "user-123",
});
```

## API

| Method | Description |
|--------|-------------|
| `initialize(config)` | Required once |
| `login(externalId, identityHash?)` | Identify user |
| `logout()` | Clear identity |
| `trackEvent(name, properties?)` | Track event |
| `addTag` / `addTags` | User tags |
| `requestPushPermission()` | OS prompt + token registration |
| `shareConfig(...)` | iOS App Group for NSE |

## Architecture

- **JS layer** — REST client for `/api/sdk/*` (same endpoints as Flutter SDK)
- **Native module** — push permission, token events, notification open/foreground callbacks

See also: [Flutter SDK](../flutter/README.md) if you prefer Dart, or native [Android](../android/README.md) / [iOS](../ios/README.md) SDKs.
