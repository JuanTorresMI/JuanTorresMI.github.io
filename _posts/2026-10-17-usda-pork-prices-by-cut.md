---
layout: post
title: "A pork price board from USDA's daily report, every cut in plain English and Spanish"
seo_title: "A Pork Price Board from USDA Data · Juan Torres"
date: 2026-10-17
tags: [logistics, pork, usda, data]
description: "How the site's pork board turns USDA's LM_PK602 report into a page for every pork cut, in English and Spanish, and what six years of the pork cutout show."
image: /assets/og/pork-prices.png
image_alt: "Pork prices, by Juan Torres. USDA's daily pork cutout and the price of every cut."
---

What does a boneless pork butt cost by the box today? USDA answers that every business day afternoon in its pork report, under a name like `1/4 Trim Bnls Butt VAC`. The [Pork Price Board](/pork-prices/) is the same kind of board as the [boxed beef board](/beef-prices/): the day's cutout and primals, every cut that traded, a page for each cut with its history since 2020, and every number as a free download. It also has a [Spanish version](/es/precios-de-cerdo/), page for page.

## The data

The report is USDA's [National Daily Pork FOB Plant, Negotiated Sales, afternoon edition](https://mymarketnews.ams.usda.gov/viewReport/2498) (LM_PK602). Packers report their sales under Livestock Mandatory Reporting, and USDA publishes:

- **The carcass cutout and six primals** (loin, butt, picnic, rib, ham and belly), in dollars per hundredweight.
- **One row per item**, in ten tables from loin cuts to variety meats and products with added ingredients: the pounds sold, the low, the high and the weighted average. Unlike beef, pork has no grades, so each item has one price a day.

Since January 2020 the report has listed 270 different items. Their names are the trade's shorthand: `Bnls CC Strap-off`, `Derind Belly 13-17#`, `Trmd Sparerib - MED, 1 PC VAC, FZN`.

## How it works

The board reads its history the way the beef board does. USDA's datamart serves any date range with no key, so the site keeps no copy of its own: a GitHub Action reads back the CSVs it has already published and asks USDA only for the last month or two. The first run took all 82 months since January 2020.

The names were the new part. Instead of writing 270 names by hand, the snapshot splits each description into what the item is and how it's sold: the bone, the trim (1/4 or 1/8 inch), the weight range, the lean percentage, the pack (vacuum-packed, boxed, a combo bin), frozen, and added ingredients. Each piece has an English and a Spanish word. `1/4 Trim Bnls Butt VAC` becomes "Boneless pork butt, 1/4-inch trim, vacuum-packed", and in Spanish "Espaldilla de cerdo, sin hueso, recorte de 1/4 de pulgada, al vacío". An item USDA adds later gets named the same way and keeps its address. Any item that traded on at least 26 days in the past year gets a page, which today is 156 of them, plus the cutout and each primal.

The site's Cloudflare Worker checks USDA every half hour for a new report and keeps only the newest, so a page whose copy is behind can show the afternoon's figures before the evening rebuild.

## What it shows

The report for Friday, October 16, 2026 had the pork carcass cutout at $80.55 per hundredweight, up $3.00 from the day before, on 273 loads. A year earlier it was $102.17, so the cutout was down about 21%. The record covers 1,731 business days:

| Year | Average cutout | Low | High |
| --- | --- | --- | --- |
| 2020 | $77.11 | $51.07 (Apr 9) | $121.66 (May 11) |
| 2021 | $104.28 | $77.42 | $134.94 (Jun 8, the record) |
| 2022 | $103.78 | $81.62 | $131.02 |
| 2023 | $89.84 | $76.02 | $117.21 |
| 2024 | $95.73 | $82.78 | $106.78 |
| 2025 | $102.84 | $87.83 | $123.11 |
| 2026, through October 16 | $95.77 | $77.55 (Oct 15) | $104.82 |

Pork moves more with the seasons than beef. Measured against each year's own average (the median over 2020 to 2025), the cutout usually runs highest in July, 13.5% above its year, and lowest in January, 10.6% below. The beef cutout, measured the same way, swings from 5.0% above in June to 9.5% below in February. Single cuts swing harder: derind bellies, the raw material for bacon, usually run 17.1% above their year in August and 18.3% below in December.

October 2026 is near the bottom of that cycle and of the year. Per pound, October 16, 2025 against October 16, 2026:

| Cut | A year earlier | Now | Change |
| --- | --- | --- | --- |
| [Derind pork belly, 13–17 lb](/pork-prices/derind-pork-belly-13-17-lb/) | $1.62 | $1.10 | −32.2% |
| [72% lean pork trim, combo bin](/pork-prices/72-lean-pork-trim-combo-bin/) | $1.13 | $0.76 | −32.8% |
| [Boneless center-cut pork loin, strap off](/pork-prices/boneless-center-cut-pork-loin-strap-off/) | $1.67 | $1.42 | −14.7% |
| [Boneless pork butt, 1/4-inch trim](/pork-prices/boneless-pork-butt-1-4-inch-trim-vacuum-packed/) | $1.47 | $1.36 | −7.4% |
| [Pork tenderloin](/pork-prices/pork-tenderloin/) | $1.78 | $1.73 | −2.5% |

The back ribs' $2.44 a pound was higher than on only 1 of the other 253 days they traded in the past year.

## Where it falls short

- **Thin items are noisy.** Some items trade a few thousand pounds on a day; one deal can move their average a long way. The board's "biggest moves" list only counts items with at least 20,000 pounds sold that day, and each page shows the pounds behind every price.
- **Machine-built names are plain, not perfect.** "Pork picnic, smoker trim (SS)" keeps USDA's SS because the report doesn't say what it stands for. The exact USDA description is on every page.
- **The Spanish is mine.** The cut names follow what's used in Mexico, with USDA's description beside them, but a butcher in another country may know a cut by a different name.

The board is at [/pork-prices/](/pork-prices/), in Spanish at [/es/precios-de-cerdo/](/es/precios-de-cerdo/), and with the other USDA boards at [USDA market prices](/usda-market-prices/).
