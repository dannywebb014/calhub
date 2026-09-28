package io.github.dannywebb014.calhub.widget

import android.Manifest
import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

// ─── Setup screen ────────────────────────────────────────────────────
//
// Opened from the app icon or from the widget when it can't read the
// calendar: asks for calendar access and offers to put the widget on the
// home screen. Everything else happens in calendar. itself.

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var access: Button
    private lateinit var pin: Button
    private var blocked = false

    private val prefs by lazy { getSharedPreferences("setup", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = dp(24)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        column.addView(text("calendar.", 34f, R.color.logo, Typeface.create(Typeface.SERIF, Typeface.BOLD)))
        column.addView(text("widget", 16f, R.color.muted))
        status = text("", 16f, R.color.text).also { it.setPadding(0, dp(24), 0, dp(12)) }
        column.addView(status)

        access = button { onAccess() }
        column.addView(access)
        pin = button("Add the widget to your home screen") {
            val manager = AppWidgetManager.getInstance(this)
            manager.requestPinAppWidget(ComponentName(this, CalendarWidgetReceiver::class.java), null, null)
        }
        column.addView(pin)
        column.addView(button("Open calendar.") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(CALHUB))) })
        column.addView(
            text(
                "The widget shows the calendars that are switched on in your phone’s calendar app, " +
                    "for today and the next six days. Tap an event to open that day in calendar., or + to add one.",
                14f, R.color.muted,
            ).also { it.setPadding(0, dp(20), 0, 0) },
        )

        setContentView(ScrollView(this).apply {
            fitsSystemWindows = true
            addView(column, MATCH_PARENT, WRAP_CONTENT)
        })
    }

    override fun onResume() {
        super.onResume()
        paint()
        if (hasCalendarPermission(this)) {
            Refresh.schedule(this)
            Refresh.now(this)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        paint()
        if (hasCalendarPermission(this)) {
            Refresh.schedule(this)
            Refresh.now(this)
        }
    }

    private fun paint() {
        val granted = hasCalendarPermission(this)
        // Once Android stops showing the prompt, only its settings can grant it.
        blocked = !granted && prefs.getBoolean("asked", false) &&
            !shouldShowRequestPermissionRationale(Manifest.permission.READ_CALENDAR)
        status.text = when {
            granted -> "Calendar access is on. The widget is ready."
            blocked -> "Calendar access is off. Turn it on under Permissions → Calendar."
            else -> "The widget needs to read the calendar on this phone. Nothing leaves the phone."
        }
        access.text = when {
            granted -> "Calendar access is on"
            blocked -> "Open app settings"
            else -> "Allow calendar access"
        }
        access.isEnabled = !granted
        pin.isEnabled = AppWidgetManager.getInstance(this).isRequestPinAppWidgetSupported
    }

    private fun onAccess() {
        if (blocked) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            return
        }
        prefs.edit().putBoolean("asked", true).apply()
        requestPermissions(arrayOf(Manifest.permission.READ_CALENDAR), 1)
    }

    private fun dp(n: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, n.toFloat(), resources.displayMetrics).toInt()

    private fun text(s: String, size: Float, color: Int, face: Typeface? = null) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(getColor(color))
        if (face != null) typeface = face
    }

    private fun button(label: String = "", onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        gravity = Gravity.CENTER
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(8) }
    }
}
