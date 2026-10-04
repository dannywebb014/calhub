# calendar.

Your Google calendars and your Craft and Todoist tasks in one place, in the style of Fantastical.

- **List**: a scrolling agenda of every day, with events and tasks together. Overdue tasks sit at the top of today, in red, showing when they were due.
- **Day, Week and Month** grids. On a desktop, the month, the unscheduled tasks and the agenda sit in a sidebar next to the grid.
- **Quick add** in plain English: `Lunch with Sam Fri 1pm at Nando's`, `Gym tomorrow 7am for 45 mins /personal`, `Work send the invoice tomorrow`. Starting with a space name (`work`, `my space`, `joint`) or with `task` / `todo` / `remind me to` makes a task, parsed the same way tasks. does. Anything else is an event. `/name` picks a calendar. Tap the Event/Task label to switch.
- **Drag** events and tasks to another day, or to a time on the day and week grids. On a phone, press and hold first.
- **Unscheduled.** lists tasks with no date. Drag one onto a day, or pick a date for it.
- **Time blocks.** Drag a task onto a time on the day or week grid (or set a time on its sheet) to block out time for it. The block is an ordinary event on your main calendar that remembers its task, so it shows on every device, in Google Calendar and on the widget. Here it's drawn as the task, with a tick: ticking it off completes the task and leaves the block greyed out as a record. Tapping a block opens its task, where the date, time and length can be changed, or the time cleared to remove the block. Moving the block to another day moves the task's date too. Removing the block leaves the task, and its date, alone.
- **Tap** an event for its location (opens Maps), video call link, guests and notes, and to edit or delete it.

Try it without connecting anything at `?demo`.

## Setup

**Google Calendar.** Settings → paste an OAuth client ID → Connect. To make a client ID: in Google Cloud Console, turn on the Google Calendar API, set up the OAuth consent screen (External, then **Publish app**; left in testing, Google asks you to sign in again every week), and create an OAuth client ID of type *Web application* with:

- Authorised JavaScript origin: `https://dannywebb014.github.io`
- Authorised redirect URIs: `https://dannywebb014.github.io/calhub/` and `https://dannywebb014.github.io/lifeos/`

Google won't show its sign-in page inside a frame, so when calendar. runs inside the lifeOS picker (`lifeos` repo) the whole picker page goes to Google and comes back to `/lifeos/`, which passes the reply into the calendar. frame.

Sign-in is a redirect to Google rather than a popup, since popups are unreliable in a home-screen app on iPhone. Google's token lasts an hour. After that the page goes back through Google with `prompt=none`, which returns straight away as long as you're still signed in to Google in that browser.

**Tasks.** Uses the Craft and Todoist connections saved in [tasks.](../taskhub/). Both apps are on the same site, so they share this browser's storage and nothing is entered twice. Set them up and test them there.

Nothing secret is in this repo. The client ID, the Google token and the task connections live in the browser only.

## Android widget

`android/` is a small app with a home-screen widget: today and the next six days, in these colours, with a + that opens the add sheet. It reads the calendar on the phone, which the Google Calendar app keeps in sync, so it needs no sign-in and works offline. Tapping opens this page on that day (`?day=2026-09-30`) or with the add sheet open (`?add`).

GitHub Actions builds it on every push that touches `android/`. On `main` the APK goes to the [widget release](https://github.com/dannywebb014/calhub/releases/tag/widget). To install: open [calhub-widget.apk](https://github.com/dannywebb014/calhub/releases/download/widget/calhub-widget.apk) on the phone, allow installs from the browser when asked, open **calendar. widget**, allow calendar access, then add the widget. Updates install the same way, over the top.

The signing key is in the repo (`android/app/sideload.keystore`) so every build can update the last one. It's for sideloading only.

## lifeOS.

After each load, the app writes `calendar.snapshot` to local storage: the next events, the visible calendars, and today's task count. The lifeOS. card uses it to show the next event and the number of tasks today. While the Google token is still valid, lifeOS. fetches the next event fresh.

## Files

- `index.html`: the page and its styles
- `app.js`: state, the views, the sheets, quick add and loading
- `google.js`: Google sign-in and the Calendar API
- `tasks.js`: Craft and Todoist, reading the tasks. settings
- `quickadd.js`: turns a line of text into an event or tasks
- `drag.js`: drag and drop that also works with touch
- `dates.js`: date helpers (days are `YYYY-MM-DD`, weeks start on Monday)
- `demo.js`: the made-up data for `?demo`
- `android/`: the home-screen widget app
- `parse.js`, `todoist.js`: copied from tasks. Keep them in step with it.

A static site with no build step, hosted on GitHub Pages.
