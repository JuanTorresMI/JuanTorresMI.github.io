---
layout: post
title: "What packers pay for cattle, region by region, from six USDA reports"
seo_title: "A Fed Cattle Price Board from USDA Data · Juan Torres"
date: 2026-10-17
tags: [logistics, cattle, usda, data]
description: "How the site's fed cattle board puts USDA's 5-area, state and regional cash cattle reports on one page, what six years of prices show, and where data is thin."
image: /assets/og/fed-cattle-prices.png
image_alt: "Fed cattle prices, by Juan Torres. USDA's weekly cash cattle prices, 5-area and by region."
---

What did a packer pay for a pen of fed steers last week, and is that more in Nebraska than in Michigan? USDA publishes the answer every week, but split across half a dozen reports. The [Fed Cattle Price Board](/fed-cattle-prices/) puts them on one page: the 5-area price, every region side by side, a page per region with every week since 2020, and a calculator for whether a pen pays more sold live or in the beef. Like the [beef](/beef-prices/) and [pork](/pork-prices/) boards, it has a [Spanish version](/es/precios-de-ganado-gordo/).

## The data

All of it comes from Livestock Mandatory Reporting, through the same keyless datamart as the beef and pork boards:

| Report | What it holds |
| --- | --- |
| [LM_CT150](https://mymarketnews.ams.usda.gov/viewReport/2477) | The 5-area weekly weighted average, by class (steers, heifers, mixed), selling basis and grade |
| LM_CT156, 157, 158 | The same detail for Texas-Oklahoma, Kansas and Nebraska, with dressing percentages, cash and grid base |
| [LM_CT154](https://mymarketnews.ams.usda.gov/viewReport/2481) | The national weekly, whose regional table covers Colorado, the Western and Eastern Cornbelt, the northern plains, the West and the Northeast |
| [LM_CT100](https://mymarketnews.ams.usda.gov/viewReport/2466) | The 5-area daily, for the days of the current week |

Each price comes on four selling bases: live or dressed, and FOB the feedlot or delivered to the plant. The board leads with the two the trade quotes most, live FOB and dressed delivered, and keeps the other two on each region's page and in the CSV.

## How it works

The snapshot keeps no history of its own. It reads back the board's CSVs, asks USDA for the current year of each weekly report and the last month or two of the daily, and rebuilds the board and the region pages twice a day. The first run made 152 requests to cover 2020 to now. A weekly report dated on a Monday covers the week before it, so the pages label each week by its Monday to Sunday.

A region gets a page once it has a price in at least 8 weeks of the past year. Eight do today. Colorado (last cash price in December 2022) and the Western States (September 2025) are in the table and the CSV but don't have pages yet.

## What it shows

In the week of October 5 to 11, 2026, 5-area live steers brought $220.14 per hundredweight and dressed steers $345.66, on 47,079 head of steers and heifers bought for cash. The record covers 354 weeks. Live steers, 5-area, weighted by head:

| Year | Average | Low week | High week |
| --- | --- | --- | --- |
| 2020 | $108.14 | $94.87 | $124.47 |
| 2021 | $122.57 | $109.23 | $140.44 |
| 2022 | $144.24 | $136.61 | $156.42 |
| 2023 | $175.91 | $155.25 | $188.75 |
| 2024 | $186.99 | $172.24 | $197.09 |
| 2025 | $223.82 | $197.65 | $244.25 |
| 2026, through the week of Oct 5 | $241.36 | $219.06 | $262.85 (week of May 11, the record) |

The price more than doubled in six years. That is why the board measures seasons against each year's own average: live steers usually run 2.3% above their year in July and 8.0% below in January.

The regions track each other closely. Over the past 53 weeks, all steers and heifers live FOB averaged within 32 cents of the 5-area price in Nebraska, the Western Cornbelt and the Eastern Cornbelt, which is Michigan's region. The [Eastern Cornbelt](/fed-cattle-prices/eastern-cornbelt/) is a small market, though: 2,173 head that week against 23,858 in [Nebraska](/fed-cattle-prices/nebraska/).

## Where the data is thin

- **Texas-Oklahoma and Kansas often have no cash price.** USDA publishes none when there are too few cash trades, and those two regions had a published price in only 31 and 45 of the past 52 weeks. Their pages say which week the last price is from instead of showing a stale number as current.
- **The daily report is lumpy.** Cash buying bunches into a day or two a week, so most daily rows are small. The weekly is the price to quote.
- **The calculator compares prices, not bids.** Live is FOB the feedlot and dressed is delivered, so freight and shrink sit on different sides. It shows the dressing percentage where the two pay the same, which is the useful number.

The board is at [/fed-cattle-prices/](/fed-cattle-prices/), in Spanish at [/es/precios-de-ganado-gordo/](/es/precios-de-ganado-gordo/), and with the other USDA boards at [USDA market prices](/usda-market-prices/).
