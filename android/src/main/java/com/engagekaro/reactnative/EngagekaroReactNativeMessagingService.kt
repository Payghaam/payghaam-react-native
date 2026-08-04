package com.engagekaro.reactnative

import com.engagekaro.sdk.EngageKaro
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM service for EngageKaro push on React Native. Delegates notification-building
 * to the canonical Android SDK (`com.engagekaro.sdk.EngageKaro`) instead of
 * reimplementing it — see sdk-native-wrapper-design.md. Merge into your app's
 * AndroidManifest.xml:
 *
 * ```xml
 * <service
 *     android:name="com.engagekaro.reactnative.EngagekaroReactNativeMessagingService"
 *     android:exported="false">
 *     <intent-filter>
 *         <action android:name="com.google.firebase.MESSAGING_EVENT" />
 *     </intent-filter>
 * </service>
 * ```
 *
 * EngageKaro sends Android pushes data-only, so this runs whether the app is
 * foregrounded, backgrounded, or killed (FCM starts the process for us).
 *
 * Note: this deliberately calls [EngageKaro.showNotification] (draw only), not
 * [EngageKaro.handleRemoteMessage] (which also reports a `delivered` receipt). JS
 * already reports `delivered` itself from the `onForeground` event below via its own
 * HTTP client (see src/index.ts's `reportFromData`) — reporting it natively too
 * would double-count every delivery where the app is alive. The gap this leaves is
 * the same one that existed before this refactor: a `delivered` receipt is not
 * reported when FCM wakes a fully-killed app (no JS bridge to receive
 * `onForeground`). See sdk-native-wrapper-design.md for closing that gap by
 * switching this to `handleRemoteMessage` + `EngageKaro.persistBridgeConfig`
 * dedupe logic, matching Flutter.
 */
class EngagekaroReactNativeMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        EngagekaroReactNativeModule.emitToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Draw first — reaching JS is best-effort (the bridge may be dead), and a
        // failure there must never cost the user the notification.
        EngageKaro.showNotification(this, message)
        EngagekaroReactNativeModule.emitForeground(message.data)
    }
}
