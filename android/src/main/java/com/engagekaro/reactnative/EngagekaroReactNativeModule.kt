package com.engagekaro.reactnative

import android.Manifest
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
    ReactContextBaseJavaModule(ctx), PermissionListener {

    private var pendingPermission: Promise? = null

    override fun getName() = "EngagekaroReactNative"

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
    fun getInitialNotification(promise: Promise) {
        promise.resolve(null)
    }

    @ReactMethod
    fun setSharedConfig(config: ReadableMap, promise: Promise) {
        promise.resolve(null)
    }

    fun emitToken(token: String) {
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onToken", token)
    }

    companion object {
        const val PERMISSION_CODE = 0xE001
    }
}
