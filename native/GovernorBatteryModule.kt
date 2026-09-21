package com.kalsa.app

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ViewManager
import java.io.BufferedWriter
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter

class GovernorBatteryModule(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    private data class PropertyRead(val value: Int?, val status: String)
    private data class HighRateRead(
        val current: PropertyRead,
        val chargeCounter: PropertyRead,
    )

    private val samplerLock = Any()
    private var samplerThread: HandlerThread? = null
    private var samplerHandler: Handler? = null
    private var samplerWriter: BufferedWriter? = null
    private var samplerRunning = false

    override fun getName(): String = "GovernorBattery"

    @com.facebook.react.bridge.ReactMethod
    fun readThermo(promise: Promise) {
        try {
            val intent = stickyBatteryIntent()
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

    @com.facebook.react.bridge.ReactMethod
    fun readHighRate(promise: Promise) {
        try {
            promise.resolve(readHighRateMap(readHighRateValues()))
        } catch (error: Exception) {
            promise.reject("GOVERNOR_BATTERY", error.message, error)
        }
    }

    @com.facebook.react.bridge.ReactMethod
    fun startSampling(outputPath: String, intervalMs: Int, promise: Promise) {
        if (intervalMs < MIN_SAMPLE_INTERVAL_MS) {
            promise.reject(
                "GOVERNOR_BATTERY_INTERVAL",
                "Sampling interval must be at least ${MIN_SAMPLE_INTERVAL_MS} ms",
            )
            return
        }
        if (outputPath.isBlank()) {
            promise.reject("GOVERNOR_BATTERY_PATH", "Sampling output path must not be blank")
            return
        }

        var writer: BufferedWriter? = null
        try {
            stopSamplingInternal()
            writer = openTraceWriter(outputPath)
            val thread = HandlerThread(SAMPLER_THREAD_NAME)
            thread.start()
            val handler = Handler(thread.looper)
            synchronized(samplerLock) {
                samplerThread = thread
                samplerHandler = handler
                samplerWriter = writer
                samplerRunning = true
            }
            if (!handler.post {
                sampleOnce(thread, handler, intervalMs.toLong())
            }) {
                throw IllegalStateException("Could not start battery sampling loop")
            }
            writer = null
            promise.resolve(null)
        } catch (error: Exception) {
            try {
                writer?.close()
            } catch (_: Exception) {
                // The start failure is already being reported to JS.
            }
            stopSamplingInternal()
            promise.reject("GOVERNOR_BATTERY_START", error.message, error)
        }
    }

    @com.facebook.react.bridge.ReactMethod
    fun stopSampling(promise: Promise) {
        stopSamplingInternal()
        promise.resolve(null)
    }

    override fun invalidate() {
        stopSamplingInternal()
        super.invalidate()
    }

    private fun readHighRateMap(reading: HighRateRead): WritableMap {
        return Arguments.createMap().apply {
            putProperty(this, "current_uA", "currentValid", "currentStatus", reading.current)
            putProperty(
                this,
                "charge_counter_uAh",
                "chargeCounterValid",
                "chargeCounterStatus",
                reading.chargeCounter,
            )
        }
    }

    private fun readHighRateValues(): HighRateRead = HighRateRead(
        current = readProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW),
        chargeCounter = readProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER),
    )

    private fun putProperty(
        result: WritableMap,
        valueKey: String,
        validKey: String,
        statusKey: String,
        property: PropertyRead,
    ) {
        val value = property.value
        result.putBoolean(validKey, value != null)
        result.putString(statusKey, property.status)
        if (value == null) {
            result.putNull(valueKey)
        } else {
            result.putInt(valueKey, value)
        }
    }

    private fun readProperty(property: Int): PropertyRead {
        return try {
            val manager = reactApplicationContext.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
                ?: return PropertyRead(null, STATUS_UNAVAILABLE)
            val value = manager.getIntProperty(property)
            if (value == Int.MIN_VALUE) {
                PropertyRead(null, STATUS_UNSUPPORTED)
            } else {
                PropertyRead(value, STATUS_OK)
            }
        } catch (_: Exception) {
            PropertyRead(null, STATUS_ERROR)
        }
    }

    private fun stickyBatteryIntent(): Intent? = reactApplicationContext.registerReceiver(
        null,
        IntentFilter(Intent.ACTION_BATTERY_CHANGED),
    )

    /** EXTRA_VOLTAGE is the only voltage route: BatteryManager has no voltage property. */
    private fun readVoltageMv(): PropertyRead = try {
        val intent = stickyBatteryIntent()
        if (intent?.hasExtra(BatteryManager.EXTRA_VOLTAGE) == true) {
            PropertyRead(intent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0), STATUS_OK)
        } else {
            PropertyRead(null, STATUS_UNAVAILABLE)
        }
    } catch (_: Exception) {
        PropertyRead(null, STATUS_ERROR)
    }

    private fun sampleOnce(thread: HandlerThread, handler: Handler, intervalMs: Long) {
        synchronized(samplerLock) {
            if (!samplerRunning || samplerThread !== thread || samplerWriter == null) return
        }

        // The fuel gauge applies roughly one second of smoothing, so polling
        // faster than ~1 Hz does not add physical information.
        val uptimeMs = SystemClock.elapsedRealtime()
        val wallClockMs = System.currentTimeMillis()
        val reading = readHighRateValues()
        val row = sampleRow(uptimeMs, wallClockMs, reading, readVoltageMv())

        synchronized(samplerLock) {
            if (!samplerRunning || samplerThread !== thread) return
            val writer = samplerWriter ?: return
            try {
                writer.write(row)
                writer.newLine()
                writer.flush()
                handler.postDelayed({
                    sampleOnce(thread, handler, intervalMs)
                }, intervalMs)
            } catch (_: Exception) {
                samplerRunning = false
                handler.removeCallbacksAndMessages(null)
                thread.quitSafely()
                try {
                    writer.close()
                } catch (_: Exception) {
                    // The sampling thread is already being stopped.
                }
                samplerWriter = null
            }
        }
    }

    private fun sampleRow(
        uptimeMs: Long,
        wallClockMs: Long,
        reading: HighRateRead,
        voltageMv: PropertyRead,
    ): String {
        val uptimeSeconds = uptimeMs / 1000.0
        return listOf(
            uptimeSeconds.toString(),
            uptimeMs.toString(),
            wallClockMs.toString(),
            propertyCsvValue(reading.current),
            propertyCsvValue(reading.chargeCounter),
            propertyCsvValue(voltageMv),
            reading.current.status,
            reading.chargeCounter.status,
            voltageMv.status,
        ).joinToString(",")
    }

    private fun propertyCsvValue(reading: PropertyRead): String =
        reading.value?.toString() ?: INVALID_MARKER

    private fun openTraceWriter(outputPath: String): BufferedWriter {
        val file = File(outputPath.removePrefix("file://"))
        val parent = file.parentFile
        if (parent != null && !parent.exists() && !parent.mkdirs() && !parent.isDirectory) {
            throw IllegalStateException("Could not create sampling output directory: ${parent.path}")
        }
        val isEmpty = !file.exists() || file.length() == 0L
        val writer = BufferedWriter(
            OutputStreamWriter(FileOutputStream(file, true), Charsets.UTF_8),
        )
        if (isEmpty) {
            writer.write(TRACE_SCHEMA_HEADER)
            writer.newLine()
            writer.write(TRACE_COLUMNS)
            writer.newLine()
            writer.flush()
        }
        return writer
    }

    private fun stopSamplingInternal() {
        val thread: HandlerThread?
        val writer: BufferedWriter?
        synchronized(samplerLock) {
            samplerRunning = false
            samplerHandler?.removeCallbacksAndMessages(null)
            thread = samplerThread
            writer = samplerWriter
            samplerThread = null
            samplerHandler = null
            samplerWriter = null
        }

        thread?.quitSafely()
        if (thread != null && Thread.currentThread() !== thread) {
            thread.join()
        }
        try {
            writer?.close()
        } catch (_: Exception) {
            // Stop is best effort after the trace has been flushed per row.
        }
    }

    companion object {
        private const val MIN_SAMPLE_INTERVAL_MS = 200
        private const val SAMPLER_THREAD_NAME = "GovernorBatterySampler"
        private const val INVALID_MARKER = "INVALID"
        private const val STATUS_OK = "ok"
        private const val STATUS_UNSUPPORTED = "unsupported"
        private const val STATUS_UNAVAILABLE = "unavailable"
        private const val STATUS_ERROR = "error"
        private const val TRACE_SCHEMA_HEADER =
            "# schema=kalsa-governor-battery-trace-v2; " +
                "t_s=SystemClock.elapsedRealtime()/1000; " +
                "voltage_mV=BatteryManager.EXTRA_VOLTAGE, millivolts; " +
                "current_uA=property-documented unit, calibrate per device; " +
                "INVALID=invalid reading"
        private const val TRACE_COLUMNS =
            "t_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,voltage_mV," +
                "current_status,charge_counter_status,voltage_status"
    }
}

class GovernorBatteryPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(GovernorBatteryModule(context))

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
