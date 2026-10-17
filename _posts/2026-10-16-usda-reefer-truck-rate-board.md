---
layout: post
title: "I turned USDA's weekly truck rate report into a reefer rate board"
seo_title: "Building a Reefer Rate Board from USDA Data · Juan Torres"
date: 2026-10-16
last_modified_at: 2026-10-17
tags: [logistics, freight, cloudflare, usda]
description: "How I built a weekly reefer truck rate board from USDA's truck rate report with a Cloudflare Worker, the typos I found in USDA's data, and what diesel did."
image: /assets/og/reefer-rates.png
image_alt: "Reefer truck rates, by Juan Torres. USDA's weekly produce truck rates, lane by lane."
---

What does it cost to move a refrigerated truckload of produce from South Texas to Chicago this week? The U.S. Department of Agriculture answers that every Wednesday, for dozens of lanes at once. The answer just comes as a PDF, or as thousands of raw rows through an API.

I built the [Reefer Rate Board](/reefer-rates/) for two reasons. I wanted to learn more about Cloudflare and APIs: how to call one on a schedule, keep what it returns and serve it back without a server of my own. And I wanted to improve this site's SEO. A board like this gives search engines a lot to find: a page for every lane, with every number in the HTML.

## The data

USDA's Agricultural Marketing Service publishes the [Specialty Crops National Truck Rate Report](https://mymarketnews.ams.usda.gov/viewReport/2375) (report 2375) every week. Its market news reporters ask shippers, receivers and truck brokers what it cost to move produce in a 48 to 53 foot refrigerated trailer, broker fees included. Each rate goes from a shipping area, like South Texas, the Imperial Valley or Central Wisconsin, to one of ten big cities. Each one is a range, low to high, sometimes with a "mostly" range where most loads actually moved, plus USDA's read on whether trucks are short or in surplus.

Through the MyMarketNews API it comes as one row per shipping area, city and commodity. The same rate is repeated for every crop it covers, so one number can show up dozens of times.

## How it works

1. **A Cloudflare Worker asks USDA.** It holds the API key, which is free, read-only, and stored as a Cloudflare secret, never in the site's code. It fetches whichever week it's asked for, and the U.S. diesel price from the Energy Information Administration. It stores none of it: USDA and EIA already keep the history.
2. **It boils the rows down to lanes.** Each distinct rate a shipping area quotes to a city comes back once, with the crops it covered. Usually there's one rate per lane. Sometimes an area quotes a second rate for a group of crops, citrus most often, and the board lists that separately.
3. **Twice a day, the site rebuilds.** A GitHub Action reads back the CSV of every week on record and asks the Worker only for the newest week and the four before it, in case USDA corrected one. Then it writes the board, a page for every lane and the CSV. The pages are plain HTML, so reading them never touches the Worker, however many people visit.

The free plan shaped the design. A request gets 10 milliseconds of CPU, so the Worker answers one week at a time, and the CSV is written by the GitHub Action as a static file instead of by the Worker. The whole thing costs nothing to run.

## What it shows

The report for the week of October 12, 2026, published October 14, quoted 68 lanes from 10 shipping areas. Areas out of season keep their pages, so there are 299 lane pages in all, and the CSV holds 30,908 weekly rates back to April 2021. The biggest moves that week:

| Lane | Rate per load | Change |
| --- | --- | --- |
| South Texas to Atlanta | $4,200–4,700 | +14% |
| Imperial Valley & Yuma to Chicago | $7,280–7,705 | +13% |
| Santa Maria, CA to Seattle | $5,600–5,900 | +11% |
| South Texas to Baltimore | $5,600–6,400 | −4% |
| South Texas to Chicago | $3,800–4,400 | −3% |

Trucks were short in Delmarva, South and Central California, and Yakima and Wenatchee.

Each lane page compares the week with that lane's own history. [South Texas to Chicago](/reefer-rates/south-texas-to-chicago/) was $3,800–4,400 a load, mostly $3,800–4,000, which is higher than 154 of its 283 earlier weeks on record. Over the last 52 weeks it was quoted every week, from a low of $2,400 to a high of $7,000, averaging $4,510 at the middle of the range.

The history changes the answer. When I first wrote this, the record only went back to March 2026, and the same rate was higher than just 9 of 37 earlier weeks, which read as cheap. With every week back to April 2021, it's about average.

## What surprised me

**USDA's typos.** This is the most consistent public record of reefer spot rates there is, and it still has mistakes in it. For the week of May 25, 2026, the report has Florida to New York at $53–5,500. The weeks around it were $5,500–5,700 and $5,600–5,800, so that low was almost certainly $5,300 with digits missing. USDA's own change column for that week says −50%, so the typo made it into their math too. Two months later, South and Central California to Atlanta has a low of $740 for the week of July 20, where the weeks around it start at $7,200.

For a while the board took those numbers at face value, and the Florida to New York page said the lane's lowest rate on record was $53. Real ranges in the data never span more than about 2.2 times from low to high, so now a low under a quarter of its high is treated as a typo and left off the pages. The CSV still keeps the report exactly as USDA published it, so anyone can check.

**Diesel.** The board also tracks EIA's weekly U.S. average price for diesel, the number most fuel surcharge tables are built on. The week of October 21, 2024, it was $3.553 a gallon. At the end of August 2026 it was $5.599. It then climbed for three straight weeks to $6.529 on September 21, and was $6.179 the week of October 12.

## Where it breaks

- **The rates are USDA's survey, not a quote.** They're what reporters heard for spot loads that week. A contract rate, or one specific load, can sit outside the range.
- **The board can't split a rate into fuel and everything else.** USDA's rates are all-in, so the diesel table sits beside them without saying how much of a move came from fuel.
- **The history starts in April 2021.** That's as far back as USDA's API goes for this report, and USDA published no report for one week in between. The comparisons on each lane page are against that record, not against every rate ever charged.
- **Lanes come and go with the seasons.** A lane missing from this week's sheet is usually just out of season. Its page stays up with its history.

The [Reefer Rate Board](/reefer-rates/) has this week's sheet, a lookup for any lane, the rates into each city and the [whole history as a CSV](/reefer-rates/usda-reefer-truck-rates.csv). The lanes from Mexico also show the live truck waits at their border crossings, from the [border wait board](/border-waits/).
