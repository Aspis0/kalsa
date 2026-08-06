package com.moe.adbboot;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Toast;

/**
 * Exists so the package can be launched once (Android does not deliver
 * BOOT_COMPLETED to a package that has never been started) and so the effect
 * can be triggered by hand for verification.
 */
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean on = BootReceiver.enableOnce(this);
        Toast.makeText(this,
                on ? "Wireless debugging ON" : "FAILED (WRITE_SECURE_SETTINGS?)",
                Toast.LENGTH_LONG).show();
        finish();
    }
}
