package com.engagekaro.reactnative

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM service for EngageKaro push on React Native. Draws the notification and
 * forwards arrivals to JS. Merge into your app's AndroidManifest.xml:
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
 */
class EngagekaroReactNativeMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        EngagekaroReactNativeModule.emitToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Draw first — reaching JS is best-effort (the bridge may be dead), and a
        // failure there must never cost the user the notification.
        EngagekaroNotifications.show(this, message)
        EngagekaroReactNativeModule.emitForeground(message.data)
    }
}
