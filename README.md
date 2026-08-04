# @engagekaro/react-native

EngageKaro SDK for React Native — identify users, register push tokens, set tags, and track events.

Push uses **native modules** (APNs on iOS, FCM on Android). API calls (identify,
tags, events, receipts) also delegate to the native module on iOS/Android —
JavaScript's `fetch`-based client only runs as a fallback when no native module
is present.

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

- Register the messaging service in `AndroidManifest.xml`. **Required** — EngageKaro
  sends Android pushes data-only so the SDK can attach the deep link to the tap, and
  without this service no notification is drawn at all:

```xml
<service
    android:name="com.engagekaro.reactnative.EngagekaroReactNativeMessagingService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

- This module depends on `com.engagekaro:engagekaro` (the native Android SDK at
  `sdks/android`) instead of reimplementing push handling itself. Point your app's
  `android/settings.gradle` (or `.kts`) at it with a composite build + dependency
  substitution — adjust the relative path to wherever you've checked out this repo:

```groovy
includeBuild("../../node_modules/@engagekaro/react-native/../../sdks/android") {
    dependencySubstitution {
        substitute(module("com.engagekaro:engagekaro")).using(project(":engagekaro"))
    }
}
```

  (Once the SDKs are published, this composite build goes away — `com.engagekaro:engagekaro`
  resolves from a Maven repo like any other dependency. See sdk-native-wrapper-design.md.)

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

## Handling taps and deep links

A campaign's **Deep link URL** arrives as `ek_url`, and anything you pass as `data`
on `POST /api/notifications` arrives alongside it:

```ts
const unsubscribe = EngageKaro.onNotificationOpened((payload) => {
  // payload.ek_url    → "myapp://offers/summer"
  // payload.targetId  → your own data key
  if (typeof payload.targetId === "string") navigate("Offer", { id: payload.targetId });
});
```

If you register **no** handler, the SDK opens `ek_url` itself via `Linking`. Registering
one suppresses that, so routing — including the deep link — is entirely yours.

A tap that cold-launches the app is replayed to a handler registered shortly after, so
it is never dropped.

Reserved payload keys: `ek_message_id`, `ek_url`, `ek_image`, `ek_sound`, `ek_opened`,
and on Android `title` / `body`.

## API

| Method | Description |
|--------|-------------|
| `initialize(config)` | Required once |
| `login(externalId, identityHash?)` | Identify user |
| `logout()` | Clear identity |
| `trackEvent(name, properties?)` | Track event |
| `addTag` / `addTags` | User tags |
| `requestPushPermission()` | OS prompt + token registration |
| `onNotificationOpened(handler)` | Notification taps; returns an unsubscribe fn |
| `shareConfig(...)` | iOS App Group for NSE |

## Architecture

This module is a thin wrapper over the canonical native SDKs (`sdks/ios`,
`sdks/android`) rather than its own implementation — see
`sdk-native-wrapper-design.md` at the repo root for the full design.

- **iOS/Android** — `initialize`/`login`/`trackEvent`/`addTag(s)`/push
  registration/receipt reporting all delegate to the native SDK's `ApiClient` +
  offline queue via the native module (`apiSync`, `apiIdentify`, `apiTrack`,
  etc.), instead of JS making its own HTTP calls. JS still owns tap dispatch,
  deep-link fallback, and foreground timing — deliberately, so those don't get
  double-handled by both the native SDK's own machinery and this module's.
  Notification drawing on Android also delegates to the canonical SDK
  (`com.engagekaro.sdk.EngageKaro`) rather than reimplementing it. One gap
  remains: native `delivered` reporting when the Android app is fully killed
  and no JS bridge is alive — flagged in sdk-native-wrapper-design.md as a
  follow-up, not yet closed.
- **No native module present** (e.g. a JS-only test harness) — every native
  bridge call falls back to `ApiClient` (the `fetch`-based implementation in
  `src/api-client.ts`), so the SDK still works without one, just without
  offline queueing shared with native.

See also: [Flutter SDK](../flutter/README.md) if you prefer Dart, or native [Android](../android/README.md) / [iOS](../ios/README.md) SDKs.
