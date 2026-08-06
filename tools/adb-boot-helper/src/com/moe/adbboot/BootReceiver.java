package com.moe.adbboot;

import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.util.Log;

/**
 * Re-enables Android's "Wireless debugging" toggle after every boot.
 *
 * The toggle is cleared by the system on each boot by design, and nothing that
 * runs as the shell or as an ordinary app can set it: the `settings` shell
 * command needs INTERACT_ACROSS_USERS, `content` needs
 * ACCESS_CONTENT_PROVIDERS_EXTERNALLY, and `setprop persist.adb.tcp.port` is
 * denied by SELinux. An installed app holding WRITE_SECURE_SETTINGS (granted
 * once over adb, and persistent) can, through the normal Settings API.
 *
 * At BOOT_COMPLETED the Wi-Fi link is often not up yet and adbd refuses to
 * start its TLS listener, so the write is retried for a while instead of once.
 */
public class BootReceiver extends BroadcastReceiver {

    public static final String TAG = "MoeAdbBoot";
    private static final String KEY = "adb_wifi_enabled";

    /** Returns true if wireless debugging reads back as enabled. */
    public static boolean enableOnce(Context ctx) {
        ContentResolver cr = ctx.getContentResolver();
        try {
            Settings.Global.putInt(cr, KEY, 1);
        } catch (SecurityException e) {
            Log.e(TAG, "WRITE_SECURE_SETTINGS not granted: " + e.getMessage());
            return false;
        } catch (Throwable t) {
            Log.e(TAG, "put failed: " + t);
            return false;
        }
        return Settings.Global.getInt(cr, KEY, 0) == 1;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        final String action = intent != null ? intent.getAction() : null;
        Log.i(TAG, "onReceive " + action);

        // One synchronous attempt first: it is cheap and often already
        // succeeds. The remaining retries run as a JobScheduler job so the
        // process stays alive for them — onReceive is about to return, and a
        // bare Thread left running after that turns this into an empty
        // process, LMKD's first kill candidate during the boot storm.
        boolean on = enableOnce(app);
        Log.i(TAG, "attempt 1 enabled=" + on);
        EnableJob.schedule(app, on ? 1 : 0, 1);
    }
}
