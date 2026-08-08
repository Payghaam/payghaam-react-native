package com.payghaam.reactnative

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.payghaam.sdk.Payghaam
import com.payghaam.sdk.PayghaamApiException
import com.payghaam.sdk.SubscriptionType
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Native push bridge for React Native — FCM on Android, mirrors Flutter plugin channels. */
class PayghaamReactNativeModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), PermissionListener, ActivityEventListener {

    private var pendingPermission: Promise? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        instance = this
        ctx.addActivityEventListener(this)
    }

    override fun getName() = "PayghaamReactNative"

    override fun invalidate() {
        ctx.removeActivityEventListener(this)
        if (instance === this) instance = null
        scope.cancel()
        super.invalidate()
    }

    // A tap on an already-running app arrives here (the launcher activity is
    // singleTop/singleTask), not through the launch intent.
    override fun onNewIntent(intent: Intent?) {
        val payload = PayghaamNotifications.payloadFrom(intent) ?: return
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
        requestCode: Int, permissions: Array<String>, grantResults: IntArray
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
        promise.resolve(PayghaamNotifications.payloadFrom(currentActivity?.intent))
    }

    /**
     * Persists config for headless FCM handling by delegating to the canonical SDK
     * ([Payghaam.persistBridgeConfig]) — see sdk-native-wrapper-design.md. Was
     * previously a no-op; `shareConfig()` on the JS side had never actually done
     * anything on Android.
     */
    @ReactMethod
    fun setSharedConfig(config: ReadableMap, promise: Promise) {
        val apiBase = if (config.hasKey("apiBase")) config.getString("apiBase") else null
        val apiKey = if (config.hasKey("apiKey")) config.getString("apiKey") else null
        if (apiBase != null && apiKey != null) {
            Payghaam.persistBridgeConfig(
                context = ctx,
                apiKey = apiKey,
                baseUrl = apiBase,
                externalId = if (config.hasKey("externalId")) config.getString("externalId") else null,
                identityHash = if (config.hasKey("identityHash")) config.getString("identityHash") else null,
            )
        }
        promise.resolve(null)
    }

    // ── Cross-platform API bridge (sdk-native-wrapper-design.md §4.5) ──────────
    // Proxies a single call through the canonical ApiClient + offline queue,
    // replacing this module's old `fetch`-based ApiClient in the JS layer.

    @ReactMethod
    fun apiSync(config: ReadableMap, promise: Promise) {
        val apiKey = if (config.hasKey("apiKey")) config.getString("apiKey") else null
        val baseUrl = if (config.hasKey("baseUrl")) config.getString("baseUrl") else null
        if (apiKey != null && baseUrl != null) {
            Payghaam.persistBridgeConfig(
                context = ctx,
                apiKey = apiKey,
                baseUrl = baseUrl,
                externalId = if (config.hasKey("externalId")) config.getString("externalId") else null,
                identityHash = if (config.hasKey("identityHash")) config.getString("identityHash") else null,
            )
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun apiClearIdentity(promise: Promise) {
        Payghaam.clearBridgeIdentity(ctx)
        promise.resolve(null)
    }

    @ReactMethod
    fun apiIdentify(args: ReadableMap?, promise: Promise) {
        val deviceContext = args?.getMap("deviceContext")?.toHashMap()
        bridgeCall(promise) { Payghaam.bridgeIdentify(deviceContext) }
    }

    @ReactMethod
    fun apiAddSubscription(args: ReadableMap, promise: Promise) {
        val type = if (args.hasKey("type")) args.getString("type") else null
        val token = if (args.hasKey("token")) args.getString("token") else null
        if (type == null || token == null) {
            promise.resolve(null)
            return
        }
        bridgeCall(promise) {
            Payghaam.bridgeAddSubscription(
                SubscriptionType.valueOf(type),
                token,
                if (args.hasKey("deviceModel")) args.getString("deviceModel") else null,
                if (args.hasKey("deviceOs")) args.getString("deviceOs") else null,
                if (args.hasKey("appVersion")) args.getString("appVersion") else null,
            )
        }
    }

    @ReactMethod
    fun apiUpdateTags(args: ReadableMap, promise: Promise) {
        val tags = args.getMap("tags")?.toHashMap() ?: emptyMap<String, Any?>()
        bridgeCall(promise) { Payghaam.addTags(tags) }
    }

    @ReactMethod
    fun apiTrack(args: ReadableMap, promise: Promise) {
        val name = if (args.hasKey("name")) args.getString("name") else null
        if (name == null) {
            promise.resolve(null)
            return
        }
        val properties = args.getMap("properties")?.toHashMap()
        bridgeCall(promise) { Payghaam.trackEvent(name, properties) }
    }

    @ReactMethod
    fun apiReportReceipt(args: ReadableMap, promise: Promise) {
        val messageId = if (args.hasKey("messageId")) args.getString("messageId") else null
        val event = if (args.hasKey("event")) args.getString("event") else null
        if (messageId == null || event == null) {
            promise.resolve(null)
            return
        }
        val properties = args.getMap("properties")?.toHashMap()
        bridgeCall(promise) { Payghaam.reportPushReceipt(messageId, event, properties) }
    }

    @ReactMethod
    fun apiFlushQueue(promise: Promise) {
        bridgeCall(promise) { Payghaam.bridgeFlushQueue() }
    }

    /**
     * Runs [block] off the main thread, resolving [promise] on completion.
     * `sendOrQueue` inside the canonical SDK already swallows retryable failures
     * (parks them in the offline queue), so this only ever rejects for a
     * non-retryable one (e.g. a 4xx) — JS wraps that back into
     * `PayghaamApiError`. `Promise` is safe to resolve/reject from any thread.
     */
    private fun bridgeCall(promise: Promise, block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
                promise.resolve(null)
            } catch (t: Throwable) {
                val info = Arguments.createMap().apply {
                    (t as? PayghaamApiException)?.let { putInt("statusCode", it.statusCode) }
                }
                promise.reject("payghaam_api_error", t.message ?: t.toString(), info)
            }
        }
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
        private var instance: PayghaamReactNativeModule? = null

        fun emitToken(token: String) {
            instance?.emit("onToken", token)
        }

        fun emitForeground(data: Map<String, String>) {
            instance?.emit("onForeground", PayghaamNotifications.asWritableMap(data))
        }
    }
}
