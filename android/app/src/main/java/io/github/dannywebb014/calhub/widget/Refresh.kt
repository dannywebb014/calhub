package io.github.dannywebb014.calhub.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.CalendarContract
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

// ─── Keeping it fresh ────────────────────────────────────────────────
//
// The widget is redrawn when anything in the phone's calendar changes, at
// midnight, when the clock or time zone changes, and every half hour so
// events that have finished drop off today.

object Refresh {
    private const val PERIODIC = "periodic"
    private const val WATCH = "watch"
    private const val NOW = "now"
    const val KEY_WATCH = "watch"
    private const val ACTION_MIDNIGHT = "io.github.dannywebb014.calhub.widget.MIDNIGHT"

    fun schedule(context: Context) {
        val wm = WorkManager.getInstance(context)
        wm.enqueueUniquePeriodicWork(
            PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<RefreshWorker>(30, TimeUnit.MINUTES).build(),
        )
        watchCalendar(context, ExistingWorkPolicy.KEEP)
        scheduleMidnight(context)
    }

    fun now(context: Context) {
        WorkManager.getInstance(context)
            .enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<RefreshWorker>().build())
    }

    // Runs once the calendar changes; each run queues the next one behind it.
    fun watchCalendar(context: Context, policy: ExistingWorkPolicy) {
        if (!hasCalendarPermission(context)) return
        val constraints = Constraints.Builder()
            .addContentUriTrigger(CalendarContract.CONTENT_URI, true)
            .setTriggerContentUpdateDelay(2, TimeUnit.SECONDS)
            .setTriggerContentMaxDelay(15, TimeUnit.SECONDS)
            .build()
        val request = OneTimeWorkRequestBuilder<RefreshWorker>()
            .setConstraints(constraints)
            .setInputData(workDataOf(KEY_WATCH to true))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WATCH, policy, request)
    }

    fun scheduleMidnight(context: Context) {
        val zone = ZoneId.systemDefault()
        val at = LocalDate.now(zone).plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() + 30_000
        context.getSystemService(AlarmManager::class.java).set(AlarmManager.RTC, at, midnightIntent(context))
    }

    fun cancel(context: Context) {
        val wm = WorkManager.getInstance(context)
        listOf(PERIODIC, WATCH, NOW).forEach(wm::cancelUniqueWork)
        context.getSystemService(AlarmManager::class.java).cancel(midnightIntent(context))
    }

    private fun midnightIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, RefreshReceiver::class.java).setAction(ACTION_MIDNIGHT),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}

class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        CalendarWidget().updateAll(applicationContext)
        if (inputData.getBoolean(Refresh.KEY_WATCH, false)) {
            Refresh.watchCalendar(applicationContext, ExistingWorkPolicy.APPEND_OR_REPLACE)
        }
        Refresh.scheduleMidnight(applicationContext)
        return Result.success()
    }
}

class RefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Refresh.now(context)
    }
}
