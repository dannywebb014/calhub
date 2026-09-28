package io.github.dannywebb014.calhub.widget

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract.Attendees
import android.provider.CalendarContract.Instances
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

// ─── Events ──────────────────────────────────────────────────────────
//
// Read from the calendar on the phone, which the Google Calendar app keeps
// in sync, so there's no sign-in here and nothing leaves the phone. Only
// calendars switched on in the phone's calendar app are shown, and events
// you've declined are left out.

data class Event(
    val id: Long,
    val title: String,
    val start: LocalDateTime,
    val end: LocalDateTime,
    val allDay: Boolean,
    val location: String,
    val color: Int,
    val firstDay: LocalDate,
    val lastDay: LocalDate,
)

data class Day(val date: LocalDate, val events: List<Event>)

sealed interface Agenda {
    data object NoPermission : Agenda
    data class Ready(val today: LocalDate, val days: List<Day>) : Agenda
}

const val DAYS_AHEAD = 7L

fun hasCalendarPermission(context: Context) =
    context.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

fun loadAgenda(context: Context, now: LocalDateTime = LocalDateTime.now()): Agenda {
    if (!hasCalendarPermission(context)) return Agenda.NoPermission
    val zone = ZoneId.systemDefault()
    val today = now.toLocalDate()
    val lastDay = today.plusDays(DAYS_AHEAD - 1)

    // All-day events are stored at UTC midnight, so ask for a day either side.
    val from = today.minusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    val to = lastDay.plusDays(2).atStartOfDay(zone).toInstant().toEpochMilli()
    val uri = Instances.CONTENT_URI.buildUpon().also {
        ContentUris.appendId(it, from)
        ContentUris.appendId(it, to)
    }.build()

    val projection = arrayOf(
        Instances.EVENT_ID, Instances.TITLE, Instances.BEGIN, Instances.END,
        Instances.ALL_DAY, Instances.DISPLAY_COLOR, Instances.EVENT_LOCATION,
    )
    val selection = "${Instances.VISIBLE} = 1 AND ${Instances.SELF_ATTENDEE_STATUS} != ${Attendees.ATTENDEE_STATUS_DECLINED}"

    val events = mutableListOf<Event>()
    context.contentResolver.query(uri, projection, selection, null, "${Instances.BEGIN} ASC")?.use { c ->
        while (c.moveToNext()) {
            val allDay = c.getInt(4) == 1
            val begin = c.getLong(2)
            val finish = maxOf(c.getLong(3), begin)
            val start: LocalDateTime
            val end: LocalDateTime
            val first: LocalDate
            val last: LocalDate
            if (allDay) {
                start = LocalDateTime.ofInstant(Instant.ofEpochMilli(begin), ZoneOffset.UTC)
                end = LocalDateTime.ofInstant(Instant.ofEpochMilli(finish), ZoneOffset.UTC)
                first = start.toLocalDate()
                last = maxOf(first, end.toLocalDate().minusDays(1))
            } else {
                start = LocalDateTime.ofInstant(Instant.ofEpochMilli(begin), zone)
                end = LocalDateTime.ofInstant(Instant.ofEpochMilli(finish), zone)
                first = start.toLocalDate()
                // Ending at midnight doesn't put it on the next day.
                last = maxOf(first, if (end.toLocalTime() == LocalTime.MIDNIGHT) end.toLocalDate().minusDays(1) else end.toLocalDate())
            }
            events += Event(
                id = c.getLong(0),
                title = c.getString(1)?.takeIf { it.isNotBlank() } ?: "(No title)",
                start = start,
                end = end,
                allDay = allDay,
                location = c.getString(6).orEmpty(),
                color = c.getInt(5),
                firstDay = first,
                lastDay = last,
            )
        }
    }

    // Every day an event touches, from today; today leaves out what's over.
    val days = generateSequence(today) { it.plusDays(1) }.takeWhile { !it.isAfter(lastDay) }.map { d ->
        val on = events.filter { !d.isBefore(it.firstDay) && !d.isAfter(it.lastDay) }
            .filter { d != today || it.allDay || it.end.isAfter(now) }
            .sortedWith(compareByDescending<Event> { it.allDay }.thenBy { it.start }.thenBy { it.title })
        Day(d, on)
    }.toList()
    return Agenda.Ready(today, days)
}
