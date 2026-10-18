---
layout: post
title: "I built a board of truck wait times at every land border crossing"
seo_title: "Border Truck Wait Times by Hour, from CBP · Juan Torres"
date: 2026-10-16
tags: [logistics, border, cloudflare, cbp]
description: "How I built a board of commercial truck wait times at every U.S. land port from CBP's feed with a Cloudflare Worker, and what the usual waits by hour show."
image: /assets/og/border-waits.png
image_alt: "Border truck wait times, by Juan Torres. CBP's commercial lane waits, now and by hour."
last_modified_at: 2026-10-18
---

U.S. Customs and Border Protection posts how long commercial trucks are waiting at every land port, about once an hour. Its live page only ever shows the wait right now, though. If you want to know whether Laredo is usually worse on a Thursday afternoon than a Monday morning, that page can't tell you.

I built the [Border Wait Board](/border-waits/) for the same reasons as the [reefer rate board](/blog/usda-reefer-truck-rate-board/): to learn more about Cloudflare and working with APIs, and to improve this site's SEO, with a page that people searching for a crossing's wait time can actually find. The two boards also fit together. Produce loads from Mexico wait at these crossings before they roll, so the reefer lanes from South Texas, Nogales and Calexico show the live waits at their crossings.

## The data

CBP's [Border Wait Times](https://bwt.cbp.gov/) feed is public and needs no key. It lists about 85 ports, and about 50 of them have commercial lanes; the board shows 53, 28 on the Mexican border and 25 on the Canadian. For each one, officers post the wait in the standard commercial lanes and in the FAST lanes (for carriers and drivers in CBP's Free and Secure Trade program), how many lanes are open, and the time they posted it.

## How it works

1. **A Cloudflare Worker reads the feed every half hour.** It's the same Worker that runs the reefer board, and both of its hourly cron runs, at 17 and 47 past, read CBP.
2. **Each reading is kept once, for good.** A reading is stored with the port and the time it was posted, so reading the feed twice in one hour never counts the same reading twice. The Worker holds the last two weeks in a small SQLite database on Cloudflare (D1), and every rebuild adds them to the permanent record: one CSV per year in this site's repository, where a reading, once kept, is never changed.
3. **Unknown is not zero.** When lanes are closed or an update is pending, CBP posts no wait. Those are stored as blanks, not as zero minutes, and every average skips them. Counted as zero, a crossing that's often closed would look fast.
4. **Times are the port's own clock.** The feed gives each port's local date and time, and that's what "the best hour to cross" has to mean. Its time zone labels aren't always right, though: Arizona ports say PST, and Port Huron says EST in October. So the board uses the clock time and ignores the labels.
5. **CBP's own history fills the gap.** CBP also publishes, for every port, the average wait at each hour of each weekday in a month, from the year before. Until a crossing has a few days of the board's own readings, its page shows CBP's numbers for the current month, labeled as CBP's.
6. **At least once a day, the site rebuilds.** A GitHub Action copies the Worker's data into the site: the board, a page for each of 16 major commercial crossings, CSVs of every reading and of the 30-day averages, and a Spanish page for each of the 9 Mexico crossings among them. The Spanish pages use CBP's own Spanish ("sin demora" for no delay, "carriles generales" for the standard lanes) and point at their English pages, so search engines show the right one. The "right now" columns also refresh from the Worker when a page opens.

## What it shows

The board's own record only started on October 14, 2026, so for now the usual waits come from CBP's averages for October last year. In the standard commercial lanes, the six crossings with the longest average wait:

| Crossing | Average | Usually worst | Usually best |
| --- | --- | --- | --- |
| El Paso Ysleta–Zaragoza Bridge | 34 min | Monday 4 PM, 53 min | Monday 6 AM, 10 min |
| Brownsville Veterans International Bridge | 26 min | Tuesday 2 PM, 67 min | Monday 8 AM, no wait |
| Otay Mesa Commercial Crossing | 25 min | Monday 10 AM, 41 min | Friday 9 PM, no wait |
| Pharr–Reynosa International Bridge | 23 min | Monday 4 PM, 49 min | Tuesday 9 PM, 1 min |
| Port Huron Blue Water Bridge | 23 min | Monday 5 PM, 82 min | Monday 1 AM, no wait |
| Laredo World Trade Bridge | 22 min | Thursday 5 PM, 51 min | Monday 7 AM, no wait |

Four of the six are at their worst on a Monday, and every one is at its best early in the morning or late at night. Averages also hide peaks: Port Huron's 23-minute average comes with an 82-minute peak at 5 PM on Mondays. Closer to home, the Ambassador Bridge in Detroit averaged just 6 minutes that month, and 3 in the FAST lanes.

When the site last copied the data, on the evening of October 16, 37 of the 53 crossings were posting a wait, and the longest standard-lane wait was 60 minutes at Sweetgrass, Montana.

## Where it breaks

- **Last October isn't this October.** Until the board has its own month of readings, the usual waits are CBP's averages from a year ago. Each page says whose numbers it's showing, and CBP's published averages for every month and crossing are kept in a [CSV](/border-waits/cbp-published-averages.csv) to check the board's own numbers against.
- **Early averages are thin.** A crossing needs about two days of readings before the board will name its own best and worst hour, and even then an hour may rest on two or three readings. The pages show how many readings each one is based on.
- **The wait is what CBP posts**, rounded the way CBP rounds it. Texas A&M's [Border Crossing Information System](https://bcis.tti.tamu.edu/) measures crossing times with roadside readers at some ports in Texas, New Mexico and Arizona. That's a different measure, so the two are worth comparing.

*Updated October 18, 2026: CBP keeps no past readings, so the board's record started when the Worker did, on October 14. An independent public archive had saved CBP's whole feed about once an hour since September 13, and its readings are now part of the record, run through the same code the Worker uses and marked as the archive's. Where both had a reading, they matched 523 times out of 530. The record now goes back to September 13, so the board's own 30-day averages have taken over from CBP's. The numbers above are from the October 16 copy. Checking this also turned up a bug: the Worker read CBP's dates as two-digit months and days, but CBP writes October 1 as 10/1/2026, so from November 1 it would have stopped recording on the first nine days of every month. That's fixed.*

The [Border Wait Board](/border-waits/) has every commercial crossing right now, the [crossing pages](/border-waits/laredo-world-trade-bridge/) have a heat map of the usual wait by day and hour, the Mexico crossings are [in Spanish](/es/tiempos-de-espera/) too, and every reading, the 30-day averages and CBP's published averages are free CSV downloads on the board.
