package io.github.dannywebb014.calhub.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// ─── Widget ──────────────────────────────────────────────────────────
//
// Today and the next six days, in calendar.'s colours. Tapping a day or an
// event opens calendar. on that day, the date at the top opens it on today,
// and + opens its add sheet.

const val CALHUB = "https://dannywebb014.github.io/calhub/"

private object Palette {
    val bg = ColorProvider(day = Color(0xFFFFFDF8), night = Color(0xFF232823))
    val text = ColorProvider(day = Color(0xFF2C2218), night = Color(0xFFEBE8DE))
    val muted = ColorProvider(day = Color(0xFF6B6055), night = Color(0xFFA8A89C))
    val accent = ColorProvider(day = Color(0xFF3B7BBF), night = Color(0xFF6FA8E0))
    val accentText = ColorProvider(day = Color(0xFF2A5F96), night = Color(0xFFA9CDF2))
    val white = ColorProvider(day = Color.White, night = Color.White)
}

private val UK = Locale.UK
private val WEEKDAY = DateTimeFormatter.ofPattern("EEEE", UK)
private val DAY_MONTH = DateTimeFormatter.ofPattern("d MMMM", UK)
private val SHORT_DAY = DateTimeFormatter.ofPattern("EEE d MMM", UK)
private val TIME = DateTimeFormatter.ofPattern("HH:mm", UK)

private fun open(query: String = ""): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(CALHUB + query)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

private fun openDay(date: LocalDate) = open("?day=$date")

// One line of the list.
private sealed interface Line {
    val id: Long

    data class Header(val date: LocalDate, val today: LocalDate) : Line {
        override val id get() = date.toEpochDay() * 1000
    }

    data class Item(val event: Event, val date: LocalDate, val index: Int) : Line {
        override val id get() = date.toEpochDay() * 1000 + 1 + index
    }

    data class Note(val text: String, val date: LocalDate) : Line {
        override val id get() = date.toEpochDay() * 1000 + 999
    }
}

private fun lines(agenda: Agenda.Ready): List<Line> {
    val out = mutableListOf<Line>()
    for (day in agenda.days) {
        if (day.date != agenda.today && day.events.isEmpty()) continue
        out += Line.Header(day.date, agenda.today)
        if (day.events.isEmpty()) out += Line.Note("Nothing else on today", day.date)
        day.events.forEachIndexed { i, e -> out += Line.Item(e, day.date, i) }
    }
    if (agenda.days.all { it.events.isEmpty() }) out += Line.Note("Nothing on this week", agenda.today.plusDays(1))
    return out
}

private fun dayLabel(date: LocalDate, today: LocalDate) = when (date) {
    today -> "Today"
    today.plusDays(1) -> "Tomorrow"
    else -> date.format(SHORT_DAY)
}

private fun whenText(e: Event, date: LocalDate): String {
    val time = when {
        e.allDay -> "All day"
        e.firstDay == e.lastDay -> "${e.start.format(TIME)} – ${e.end.format(TIME)}"
        date == e.firstDay -> "From ${e.start.format(TIME)}"
        date == e.lastDay -> "Until ${e.end.format(TIME)}"
        else -> "All day"
    }
    return if (e.location.isBlank()) time else "$time · ${e.location}"
}

class CalendarWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val agenda = withContext(Dispatchers.IO) { loadAgenda(context) }
        provideContent { Content(agenda) }
    }

    @Composable
    private fun Content(agenda: Agenda) {
        val today = (agenda as? Agenda.Ready)?.today ?: LocalDate.now()
        Column(
            modifier = GlanceModifier.fillMaxSize().appWidgetBackground().cornerRadius(20.dp)
                .background(Palette.bg).padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = GlanceModifier.defaultWeight().clickable(actionStartActivity(open()))) {
                    Text(
                        today.format(WEEKDAY),
                        style = TextStyle(color = Palette.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Serif),
                        maxLines = 1,
                    )
                    Text(today.format(DAY_MONTH), style = TextStyle(color = Palette.muted, fontSize = 13.sp), maxLines = 1)
                }
                Box(
                    modifier = GlanceModifier.size(36.dp).cornerRadius(18.dp).background(Palette.accent)
                        .clickable(actionStartActivity(open("?add"))),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("+", style = TextStyle(color = Palette.white, fontSize = 22.sp, fontWeight = FontWeight.Bold))
                }
            }
            Spacer(GlanceModifier.height(6.dp))
            when (agenda) {
                Agenda.NoPermission -> Box(
                    modifier = GlanceModifier.fillMaxSize().clickable(actionStartActivity<MainActivity>()),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "Tap to let the widget read your calendar",
                        style = TextStyle(color = Palette.accentText, fontSize = 14.sp, fontWeight = FontWeight.Medium),
                    )
                }
                is Agenda.Ready -> LazyColumn(modifier = GlanceModifier.fillMaxSize()) {
                    items(lines(agenda), itemId = { it.id }) { line -> LineView(line) }
                }
            }
        }
    }

    @Composable
    private fun LineView(line: Line) {
        when (line) {
            is Line.Header -> Text(
                dayLabel(line.date, line.today),
                modifier = GlanceModifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp).clickable(actionStartActivity(openDay(line.date))),
                style = TextStyle(
                    color = if (line.date == line.today) Palette.accentText else Palette.text,
                    fontSize = 13.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Serif,
                ),
                maxLines = 1,
            )
            is Line.Note -> Text(
                line.text,
                modifier = GlanceModifier.fillMaxWidth().padding(vertical = 4.dp).clickable(actionStartActivity(openDay(line.date))),
                style = TextStyle(color = Palette.muted, fontSize = 13.sp),
            )
            is Line.Item -> Row(
                modifier = GlanceModifier.fillMaxWidth().padding(vertical = 4.dp).clickable(actionStartActivity(openDay(line.date))),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = GlanceModifier.width(4.dp).height(32.dp).cornerRadius(2.dp).background(Color(line.event.color or 0xFF000000.toInt()))) {}
                Spacer(GlanceModifier.width(9.dp))
                Column(modifier = GlanceModifier.defaultWeight()) {
                    Text(
                        line.event.title,
                        style = TextStyle(color = Palette.text, fontSize = 14.sp, fontWeight = FontWeight.Medium),
                        maxLines = 1,
                    )
                    Text(whenText(line.event, line.date), style = TextStyle(color = Palette.muted, fontSize = 12.sp), maxLines = 1)
                }
            }
        }
    }
}

class CalendarWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CalendarWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        Refresh.schedule(context)
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        Refresh.schedule(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        Refresh.cancel(context)
    }
}
