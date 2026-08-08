package com.payghaam.reactnative

import com.payghaam.sdk.Payghaam
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM service for Payghaam push on React Native. Delegates notification-building
 * to the canonical Android SDK (`com.payghaam.sdk.Payghaam`) instead of
 * reimplementing it — see sdk-native-wrapper-design.md. Merge into your app's
 * AndroidManifest.xml:
 *
 * ```xml
 * <service
 *     android:name="com.payghaam.reactnative.PayghaamReactNativeMessagingService"
 *     android:exported="false">
 *     <intent-filter>
 *         <action android:name="com.google.firebase.MESSAGING_EVENT" />
 *     </intent-filter>
 * </service>
 * ```
 *
 * Payghaam sends Android pushes data-only, so this runs whether the app is
 * foregrounded, backgrounded, or killed (FCM starts the process for us).
 *
 * Note: this deliberately calls [Payghaam.showNotification] (draw only), not
 * [Payghaam.handleRemoteMessage] (which also reports a `delivered` receipt). JS
 * already reports `delivered` itself from the `onForeground` event below via its own
 * HTTP client (see src/index.ts's `reportFromData`) — reporting it natively too
 * would double-count every delivery where the app is alive. The gap this leaves is
 * the same one that existed before this refactor: a `delivered` receipt is not
 * reported when FCM wakes a fully-killed app (no JS bridge to receive
 * `onForeground`). See sdk-native-wrapper-design.md for closing that gap by
 * switching this to `handleRemoteMessage` + `Payghaam.persistBridgeConfig`
 * dedupe logic, matching Flutter.
 */
class PayghaamReactNativeMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        PayghaamReactNativeModule.emitToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Draw first — reaching JS is best-effort (the bridge may be dead), and a
        // failure there must never cost the user the notification.
        Payghaam.showNotification(this, message)
        PayghaamReactNativeModule.emitForeground(message.data)
    }
}
