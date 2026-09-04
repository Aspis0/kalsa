package com.kalsa.app

import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactPackage
import com.facebook.react.uimanager.ViewManager

class GovernorBatteryModule(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    override fun getName(): String = "GovernorBattery"

    @com.facebook.react.bridge.ReactMethod
    fun readThermo(promise: Promise) {
        try {
            val intent = reactApplicationContext.registerReceiver(
                null,
                IntentFilter(Intent.ACTION_BATTERY_CHANGED),
            )
            val result = Arguments.createMap()
            if (intent == null) {
                result.putInt("battTempTenthsC", 0)
                result.putInt("battLevelPct", 0)
                result.putBoolean("plugged", false)
                result.putBoolean("sensorValid", false)
                promise.resolve(result)
                return
            }

            val temperature = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, 0)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 0)
            val percent = if (scale > 0) (level * 100 / scale).coerceIn(0, 100) else 0
            val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
            result.putInt("battTempTenthsC", temperature)
            result.putInt("battLevelPct", percent)
            result.putBoolean("plugged", plugged)
            result.putBoolean("sensorValid", temperature > 0)
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("GOVERNOR_BATTERY", error.message, error)
        }
    }
}

class GovernorBatteryPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(GovernorBatteryModule(context))

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
