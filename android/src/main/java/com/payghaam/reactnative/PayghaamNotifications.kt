package com.payghaam.reactnative

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * React Native bridge-type helpers only. Notification building/drawing lives in
 * the canonical Android SDK (`com.payghaam.sdk.Payghaam.showNotification`) —
 * see PayghaamReactNativeMessagingService and sdk-native-wrapper-design.md. What
 * stays here is specific to the RN bridge: converting a tap `Intent` (built by the
 * canonical SDK's own tap-intent, which uses the same `ek_opened`/`ek_*` extras key
 * names regardless of which module drew the notification) into a `WritableMap` JS
 * can consume.
 */
internal object PayghaamNotifications {
    private const val KEY_OPENED = "ek_opened"

    /**
     * Pulls an Payghaam payload out of a tap intent, or null if the intent did not
     * come from one of our notifications. Clears the marker so the same tap is not
     * dispatched twice (e.g. cold-start read followed by a resume).
     */
    fun payloadFrom(intent: Intent?): WritableMap? {
        if (intent == null || !intent.getBooleanExtra(KEY_OPENED, false)) return null
        val extras = intent.extras ?: return null
        val map = Arguments.createMap()
        for (key in extras.keySet()) {
            if (key == KEY_OPENED) continue
            extras.getString(key)?.let { map.putString(key, it) }
        }
        intent.removeExtra(KEY_OPENED)
        return map
    }

    fun asWritableMap(data: Map<String, String>): WritableMap {
        val map = Arguments.createMap()
        for ((k, v) in data) map.putString(k, v)
        return map
    }
}
