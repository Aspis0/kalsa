package com.moe.adbboot;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.PersistableBundle;
import android.util.Log;

/**
 * Keeps retrying enableOnce() across a JobScheduler job instead of a bare
 * Thread: a Thread started from onReceive() has no active component once
 * onReceive returns, so the process becomes an empty process — LMKD's first
 * kill candidate during the boot storm, killed with SIGKILL and no log. A
 * scheduled job keeps the process alive for the duration of onStartJob.
 */
public class EnableJob extends JobService {

    private static final int JOB_ID = 4242;
    private static final String KEY_STREAK = "streak";
    private static final String KEY_ATTEMPT = "attempt";
    private static final int STREAK_TARGET = 3;
    private static final int ATTEMPT_CAP = 24;

    /** Schedules the next attempt; caps total attempts so this can never loop forever. */
    public static void schedule(Context ctx, int streak, int attempt) {
        PersistableBundle extras = new PersistableBundle();
        extras.putInt(KEY_STREAK, streak);
        extras.putInt(KEY_ATTEMPT, attempt);

        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, EnableJob.class))
                .setExtras(extras)
                .setMinimumLatency(5000L)
                .setOverrideDeadline(15000L)
                .setPersisted(false)
                .build();

        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) {
            js.schedule(job);
        }
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        final PersistableBundle extras = params.getExtras();
        final int streak = extras.getInt(KEY_STREAK, 0);
        final int attempt = extras.getInt(KEY_ATTEMPT, 0);

        // onStartJob runs on the main thread; keep it off there.
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean on = BootReceiver.enableOnce(EnableJob.this);
                int newStreak = on ? streak + 1 : 0;
                Log.i(BootReceiver.TAG, "job attempt " + attempt + "/" + ATTEMPT_CAP
                        + " enabled=" + on + " streak=" + newStreak);

                // Keep going a few rounds past the first success: adbd can clear
                // the flag again if it comes up before the network does.
                if (newStreak < STREAK_TARGET && attempt < ATTEMPT_CAP) {
                    schedule(EnableJob.this, newStreak, attempt + 1);
                }
                jobFinished(params, false);
            }
        }, "moe-adb-enable").start();

        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
