package com.kalsa.app

import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.ReactPackage
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
            val present = intent.getBooleanExtra(BatteryManager.EXTRA_PRESENT, false)
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, 0)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 0)
            val percent = if (scale > 0) (level * 100 / scale).coerceIn(0, 100) else 0
            val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
            result.putInt("battTempTenthsC", temperature)
            result.putInt("battLevelPct", percent)
            result.putBoolean("plugged", plugged)
            result.putBoolean("sensorValid", present && temperature > 0)
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("GOVERNOR_BATTERY", error.message, error)
        }
    }

    @com.facebook.react.bridge.ReactMethod
    fun readSoc(promise: Promise) {
        val result = Arguments.createMap()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            result.putString("socModel", Build.SOC_MODEL)
            result.putString("socManufacturer", Build.SOC_MANUFACTURER)
        } else {
            result.putNull("socModel")
            result.putNull("socManufacturer")
        }
        promise.resolve(result)
    }
}

class GovernorBatteryPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(GovernorBatteryModule(context))

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
