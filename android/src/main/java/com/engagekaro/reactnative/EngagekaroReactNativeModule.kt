package com.engagekaro.reactnative

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.google.firebase.messaging.FirebaseMessaging

/** Native push bridge for React Native — FCM on Android, mirrors Flutter plugin channels. */
class EngagekaroReactNativeModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), PermissionListener, ActivityEventListener {

    private var pendingPermission: Promise? = null

    init {
        instance = this
        ctx.addActivityEventListener(this)
    }

    override fun getName() = "EngagekaroReactNative"

    override fun invalidate() {
        ctx.removeActivityEventListener(this)
        if (instance === this) instance = null
        super.invalidate()
    }

    // A tap on an already-running app arrives here (the launcher activity is
    // singleTop/singleTask), not through the launch intent.
    override fun onNewIntent(intent: Intent?) {
        val payload = EngagekaroNotifications.payloadFrom(intent) ?: return
        emit("onOpened", payload)
    }

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        // Not used; required by ActivityEventListener.
    }

    @ReactMethod
    fun requestPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            promise.resolve(true)
            return
        }
        val activity = currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) {
            promise.resolve(true)
            return
        }
        pendingPermission = promise
        ActivityCompat.requestPermissions(
            activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), PERMISSION_CODE
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ): Boolean {
        if (requestCode != PERMISSION_CODE) return false
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        pendingPermission?.resolve(granted)
        pendingPermission = null
        return true
    }

    @ReactMethod
    fun getToken(promise: Promise) {
        FirebaseMessaging.getInstance().token
            .addOnCompleteListener { task ->
                promise.resolve(if (task.isSuccessful) task.result else null)
            }
    }

    @ReactMethod
    fun getDeviceContext(promise: Promise) {
        val locale = ctx.resources.configuration.locales[0]
        val appVersion = try {
            ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
        } catch (_: Exception) {
            ""
        }
        promise.resolve(
            Arguments.createMap().apply {
                putString("country", locale.country)
                putString("language", locale.language)
                putString("timezone", java.util.TimeZone.getDefault().id)
                putString("os", "Android")
                putString("osVersion", Build.VERSION.RELEASE)
                putString("appVersion", appVersion)
                putString("deviceModel", Build.MODEL)
            },
        )
    }

    /** The tap that cold-launched the app, read once from the launcher intent. */
    @ReactMethod
    fun getInitialNotification(promise: Promise) {
        promise.resolve(EngagekaroNotifications.payloadFrom(currentActivity?.intent))
    }

    @ReactMethod
    fun setSharedConfig(config: ReadableMap, promise: Promise) {
        promise.resolve(null)
    }

    // Required by NativeEventEmitter on iOS-parity RN versions; no-ops here since
    // events are emitted through RCTDeviceEventEmitter.
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Int) = Unit

    private fun emit(event: String, payload: Any?) {
        if (!ctx.hasActiveReactInstance()) return
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    companion object {
        const val PERMISSION_CODE = 0xE001

        /**
         * The live module, if the bridge is up. The FCM service runs in the app
         * process but outside the bridge's lifecycle — when a push revives a killed
         * process there may be no module to emit through, in which case the JS side
         * picks the tap up later via getInitialNotification().
         */
        @Volatile
        private var instance: EngagekaroReactNativeModule? = null

        fun emitToken(token: String) {
            instance?.emit("onToken", token)
        }

        fun emitForeground(data: Map<String, String>) {
            instance?.emit("onForeground", EngagekaroNotifications.asWritableMap(data))
        }
    }
}
