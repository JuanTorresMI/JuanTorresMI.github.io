---
layout: post
title: "I put my YouTube channel's live numbers on my own site"
seo_title: "YouTube Channel Stats on My Site, for Free · Juan Torres"
date: 2026-10-16
tags: [youtube, cloudflare, discord, league-of-legends]
description: "Why I put my YouTube channel's stats on this site with a free Cloudflare Worker, how it reads YouTube's API without exposing a key, and what the numbers show."
image: /assets/og/youtube.png
image_alt: "YouTube, by Juan Torres. Channel numbers refreshed every hour by a Cloudflare Worker."
---

My YouTube channel is League of Legends: full games and short clips from my Kalista ADC games in Emerald. I already post to it with a Discord bot. The [YouTube page](/youtube/) on this site shows the channel's numbers, refreshed every hour, and the latest uploads.

I had three reasons for building it. I wanted to build something that works with the Discord bot I already use for posting: the bot puts the videos up, and this page shows how they do. I wanted the channel to be easier to discover. And I wanted somewhere on my own website to track how the channel performs, so the numbers show how my tool is doing.

## Why a page can't just ask YouTube

YouTube's numbers come from the YouTube Data API, and every request needs an API key. A web page that asked YouTube directly would have to put that key in its source, where anyone could copy it and spend its quota. So the asking happens somewhere else: a small Cloudflare Worker, the same one behind this site's [reefer rate board](/reefer-rates/) and [border wait board](/border-waits/).

## How it works

1. **Once an hour, the Worker wakes itself up.** A cron trigger runs it at 17 past every hour. Nobody has to visit the page, and my computer doesn't have to be on.
2. **It asks YouTube three questions.** One call gets the channel's subscribers, total views and video count, one gets the list of its latest uploads, and one gets each upload's views, likes and length. Each call costs one unit of YouTube's free daily quota of 10,000, so the whole day costs 72.
3. **It writes the answer down.** The latest snapshot goes into a small SQLite database on Cloudflare (D1), along with one row per day, which is where the day-by-day changes come from. If YouTube doesn't answer, nothing is overwritten.
4. **The page reads the snapshot, not YouTube.** A visit costs YouTube's quota nothing, and Cloudflare keeps a copy at the edge for five minutes, so most visits don't even reach the database.
5. **Twice a day, a copy goes into the page itself.** A GitHub Action writes the snapshot into the page's HTML. That's what search engines and link previews see.

The key is a plain API key stored as a Cloudflare secret. It can only read public data, so it can't upload or change anything on the channel. The bot does the uploading with its own sign-in and its own quota, so this page can never get in its way. All of it runs on free plans.

For discoverability, the page is built to be found and to send people on. Its title and description say what the channel is, the numbers and the latest full game and Shorts are in the HTML, every recent upload links to YouTube, and a "Browse by matchup" row turns titles like "Kalista vs Smolder" into searches of the channel.

## What the numbers show

When the site last copied the snapshot, on October 16, 2026, the channel had 183 videos, 92,443 views all time and 14 subscribers. The 12 latest uploads, from October 13 to 16, split very unevenly:

| Upload | Count | Length | Views by October 16 |
| --- | --- | --- | --- |
| Shorts | 8 | 35–43 seconds | 5,838 |
| Full games | 4 | 23–34 minutes | 1 |

The most-viewed was a Short, "What should Thresh & Jhin have done vs Kalista?", at 1,339 views. The day-by-day log shows the channel gained 2,310 views on October 15 and 2,213 on October 16 by the time of the copy, with no change in subscribers either day.

## Where it breaks

- **It's a few days of data.** The full games were all uploaded in those same four days, the last one hours before the copy, so their counts may still move. Four days can't say how a full game does over a month.
- **The day-by-day history is short.** It holds one row per day, so it only says something once there are weeks of rows.
- **Some of it is YouTube's rules, not mine.** The public subscriber count is rounded to three significant figures, and "Short" on the page means an upload three minutes long or less, which is YouTube's own limit for one.

The [YouTube page](/youtube/) has the live numbers, the latest full game and Shorts, every recent upload and the day-by-day changes. The Worker's code is in the [worker folder](https://github.com/JuanTorresMI/JuanTorresMI.github.io/tree/main/worker) of this site's repository.
