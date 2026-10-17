---
layout: post
title: "I turned USDA's daily boxed beef report into a price board for every cut"
seo_title: "A Boxed Beef Price Board from USDA Data · Juan Torres"
date: 2026-10-16
tags: [logistics, beef, cloudflare, usda]
description: "How I built a daily boxed beef price board with a page for every cut from USDA's LM_XB403 report, what six years of the cutout show, and where it falls short."
image: /assets/og/beef-prices.png
image_alt: "Boxed beef prices, by Juan Torres. USDA's daily boxed beef cutout and the price of every cut."
---

What is a boneless ribeye worth today, before anyone cuts it into steaks? Packers report every sale of boxed beef to the U.S. Department of Agriculture, and USDA publishes the answer every business day afternoon: the boxed beef cutout and a price for every cut that traded. It comes as a PDF or as raw rows in a datamart, one table per section.

The [Boxed Beef Price Board](/beef-prices/) puts it on one page, with a page and the full daily history for every cut. I wanted another project in the same mold as the [reefer rate board](/reefer-rates/) and the [border wait board](/border-waits/): a public data source, the site's Cloudflare Worker, pages search engines can find, and nothing to pay.

## The data

The report is USDA's [National Daily Boxed Beef Cutout and Boxed Beef Cuts, Negotiated Sales, afternoon edition](https://mymarketnews.ams.usda.gov/viewReport/2453) (LM_XB403). Under Livestock Mandatory Reporting, packers have to report their sales, and USDA publishes the totals:

- **The cutout**, for Choice and for Select: an estimate of what a carcass is worth broken into the cuts packers sell, in dollars per hundredweight (100 lb) of carcass.
- **Seven primal values**: the rib, chuck, round, loin, brisket, short plate and flank.
- **One row per cut**, for each grade: the number of trades, the pounds, the low, the high and the weighted average. Each cut is named the way the trade orders it, with its IMPS number and a fat limitation code, like `Rib, ribeye, bnls, heavy (112A 3)`.
- **Ground beef and trimmings**, sold by lean percentage.

USDA's Livestock Mandatory Reporting datamart serves all of it as JSON with no key. One request with `allSections=true` returns the whole day's report, about 110 KB.

## How it works

1. **The history stays USDA's.** USDA already keeps every report, and the datamart serves any date range, so nothing on this site stores a second copy of it. A GitHub Action runs twice a day and reads back the CSVs the site already publishes, which hold every day fetched so far. It asks USDA only for what they don't settle, which on an ordinary run is the last month or two (USDA sometimes corrects a report). The very first run asked for all 82 months since January 2020, about two minutes of downloads.
2. **A cut that didn't trade is left blank, never zero.** USDA prints those as $0.00 with no trades. Stored as a price, they'd drag every average toward nothing, so they're not stored at all.
3. **The Action rebuilds the site.** It writes the board, a page for each of 58 cuts, primals and ground beef items, the CSVs (the daily cutout and primal values, and one file per year of every cut) and a JSON file of the newest report. The pages are plain HTML.
4. **A Cloudflare Worker watches for the next report.** Every half hour it asks USDA for the newest report's summary, a few hundred bytes. When there's a new one, it fetches the whole report, about 110 KB, and keeps it: one row in a SQLite database on Cloudflare (D1), the only thing it stores. The rebuilds only come twice a day, so a page whose copy is older than a report that should be out asks the Worker and puts the new figures at the top, usually within half an hour of USDA posting them. Otherwise the pages ask nothing.

## What it shows

The report for Friday, October 16, 2026 had the Choice cutout at $372.31 and Select at $353.05, with 103 loads of Choice and 5 of Select sold. A year earlier, October 16, 2025, Choice was $366.11, so the cutout was up 1.7%. The record covers 1,731 business days, from January 2, 2020:

| Year | Average Choice cutout | Low | High |
| --- | --- | --- | --- |
| 2020 | $237.95 | $200.47 | $475.39 |
| 2021 | $279.49 | $205.27 | $348.03 |
| 2022 | $263.81 | $242.65 | $293.50 |
| 2023 | $299.25 | $264.74 | $343.09 |
| 2024 | $308.15 | $275.90 | $330.47 |
| 2025 | $359.13 | $310.77 | $416.01 |
| 2026, through October 16 | $380.22 | $349.97 | $403.31 |

The record high is from the spring of 2020, when packing plants shut down: $475.39 on May 12. Two months later, on July 17, the cutout hit its low for the whole record, $200.47.

A cutout up 1.7% on the year hides how differently its parts moved. Choice prices per pound, October 16, 2025 against October 16, 2026:

| Cut | A year earlier | Now | Change |
| --- | --- | --- | --- |
| [Chuck roll, neck off](/beef-prices/chuck-roll-116a/) (116A) | $4.54 | $5.96 | +31.1% |
| [Ribeye, boneless, heavy](/beef-prices/ribeye-boneless-heavy-112a/) (112A) | $13.85 | $15.47 | +11.7% |
| [Tenderloin, trimmed, heavy](/beef-prices/tenderloin-trimmed-189a/) (189A) | $18.93 | $16.35 | −13.7% |
| [Ground beef, 81% lean](/beef-prices/ground-beef-81/) | $3.45 | $3.27 | −5.1% |
| [Fresh 50% lean trimmings](/beef-prices/fresh-50-lean-trimmings/) | $1.47 | $0.87 | −41.0% |

Each cut page ranks the latest price against the cut's own past year. The heavy boneless ribeye's $15.47 a pound was higher than on 234 of the other 254 days it traded in the past year. The boneless top sirloin butt was the opposite, higher than on only 2 of 253.

## What the history shows

**Every cut has its own season.** Each cut page compares every month with its own year's average and takes the median over 2020 to 2025. That takes out the drift: the cutout rose about 50% in those years, and without it every later month would look dear. The Choice cutout usually runs highest in June (+5.0%) and lowest in February (−9.5%). The loin cuts swing much harder than that, and they peak at the same time of year:

| Cut | Usually highest | Usually lowest |
| --- | --- | --- |
| [Tri-tip](/beef-prices/tri-tip-185c/) (185C) | June, +28.7% | October, −12.6% |
| [Strip loin, boneless](/beef-prices/strip-loin-boneless-180/) (180) | June, +24.0% | October, −14.6% |
| [Top sirloin butt, boneless](/beef-prices/top-sirloin-butt-184/) (184) | June, +20.0% | January, −13.0% |
| [Ribeye, boneless, heavy](/beef-prices/ribeye-boneless-heavy-112a/) (112A) | November, +14.2% | February, −11.9% |
| [Ribeye, lip-on, bone-in](/beef-prices/ribeye-lip-on-bone-in-109e/) (109E) | December, +23.9% | July, −16.2% |
| [Ground beef, 93% lean](/beef-prices/ground-beef-93/) | June, +2.4% | January, −3.9% |

The ribeyes peak at the other end of the year, in November and December. Lean ground beef barely moves at all.

**The median matters.** Averaged across the years instead, the numbers say the cutout usually runs 14.6% above its year in May. That's 2020 alone: one May with closed plants and a record cutout is enough to make every May look expensive. With the median, May is +0.4%.

**Select sometimes beats Choice.** Choice has more marbling and nearly always costs more. Not always: Select's cutout came in above Choice's on 16 days in the record, once in February 2022 and 15 times between January and May 2026. The widest gap the other way was $39.74, on June 21, 2021.

## Where it breaks

- **It's negotiated sales only.** Beef sold on formulas or forward contracts is reported separately and isn't in these numbers.
- **Select is thin.** On October 16, Choice sold 103 loads and Select 5. Many cuts have no Select price on a given day, and the ones that do can rest on a handful of trades. The board's list of the week's biggest moves only counts cuts with at least 10 trades for that reason.
- **They're wholesale prices, in nominal dollars.** A cut in a box at the packing plant is worth far less a pound than the same cut trimmed and wrapped in a store, and the history isn't adjusted for inflation.
- **Seasons need years.** Six full years is enough to see a pattern, not enough to promise one. The pages say "usually", and the year-by-month tables show every month, so you can see when a season didn't hold.
- **A day can be missing.** USDA doesn't publish a price it would have to hide to protect who traded, and federal holidays have no report. Those days are blank.

The [Boxed Beef Price Board](/beef-prices/) has today's cutout, the primals, every cut by primal, the biggest moves of the week, the history since 2020 and [the data as CSV files](/beef-prices/#data), free to use with credit to USDA.
