---
layout: post
title: "I built an aggregate planning solver that runs in the browser"
seo_title: "How I Built an Aggregate Planning Solver · Juan Torres"
date: 2026-10-07
tags: [operations, optimization, highs, aggregate-planning]
description: "Why I built a web-based aggregate planning calculator instead of using Excel Solver, how it finds the cheapest level, band and chase plans, and what it shows."
image: /assets/og/aggregate-planning.png
image_alt: "Aggregate Planner, an aggregate production planning calculator: the cheapest level, band or chase plan, month by month. A tool by Juan Torres."
---

My logistics class had an aggregate planning case study. The usual way to solve it is Excel Solver: you lay out the decision variables, write the constraints as formulas and hope nothing is off by one row. That works if you already know Excel well, and it doesn't if you don't. I wanted to learn how to build an online solver that handles the data entry and the projections, so that someone without that Excel background could still work the case. That became the [Aggregate Planner](/aggregate-planning/), an aggregate planning calculator that runs entirely in the browser.

This post is how it works, what the sample case shows, and what I learned about solvers along the way.

## The problem

Aggregate planning asks a simple question with an annoying number of moving parts. You have a year of monthly demand. You have a workforce that can make so much a month. What's the cheapest way to cover the gap?

Every option costs something. Hiring and layoffs cost money. Overtime pays a premium. Stock built early has to be stored. Orders filled late cost goodwill. Cases usually ask you to compare three policies:

- **Level.** Keep the same workforce all year. Build inventory in slow months, use it up in busy ones.
- **Chase.** Hire and lay off freely so production follows demand.
- **Band.** Let the workforce move, but only between limits you set.

The planner solves all three at once, from the same inputs, and puts them side by side.

## How the solver works, in plain words

Every month gets a handful of decisions: teams hired, teams laid off, teams employed, overtime hours, units made, units held in stock, and orders left late. Those are the variables. Then every month has to obey four rules:

1. Teams this month = teams last month + hires − layoffs.
2. Last month's stock + this month's production = this month's demand + what's left over (late orders count as negative stock).
3. Overtime can't go past the cap per team.
4. Production can't go past what the teams can make in regular time plus overtime.

The goal is to make the total cost of all those decisions as small as possible. That's a **linear program**: every cost and every rule is a straight-line formula of the variables. For the 12-month sample, it comes to 84 variables and 48 rules.

The catch is people. You can't hire 6.35 teams. Requiring whole teams turns it into a **mixed-integer program**, which is much harder in general. The solver handles it with **branch and bound**. First it solves the problem with fractions allowed, which gives a cost no whole-team plan can beat. Then it picks a fractional number, say 6.35 teams, and splits the problem in two: one where that month has at most 6 and one where it has at least 7. It solves both halves, throws away any branch that can't beat the best whole-team plan found so far, and keeps splitting until nothing better can exist.

The solver doing that is [HiGHS](https://highs.dev/), a free, open-source optimizer. It's compiled to WebAssembly, so it runs inside the page. The page writes the model out as text, hands it to HiGHS in a background thread, and reads the answer back. Nothing you type is sent anywhere.

## What the sample case shows

The page opens with a made-up seasonal product. Demand climbs from 1,600 units in month 1 to 4,100 in month 11. The plant starts with 12 teams of 5 workers. Labor is $25 an hour, overtime $37.50. Hiring costs $500 a worker and a layoff $800. A unit costs $12 a month to hold and $30 a month to leave late. The year has to end with 12 teams, at least 300 units in stock and nothing still late.

With whole teams, HiGHS returns:

| Policy | Annual cost | Saved vs. level | Peak inventory | Teams | Hired · laid off |
| --- | --- | --- | --- | --- | --- |
| Level | $5,261,040 | — | 3,204 | 12 all year | 0 · 0 |
| Band (10–14) | $5,062,160 | $198,880 | 1,804 | 10 to 14 | 4 · 4 |
| Chase | $4,875,900 | $385,140 | 1,088 | 7 to 17 | 10 · 10 |

Total material is the same $1,992,000 in every plan, because all three make exactly the 33,200 units demand needs. The difference is all in how they pay for labor and storage. The level plan spends $245,040 holding stock that peaks in month 8. The chase plan spends $65,000 on hiring and layoffs instead and keeps holding costs down to $43,920.

A few things in there I didn't expect:

- **Chase only saves about 7%.** Total freedom to hire and fire beats a fixed workforce, but not by much. A band of just 10 to 14 teams gets more than half of that saving, with 4 hires instead of 10.
- **The cheapest plan runs late on purpose.** Chase leaves 8 units unfilled in month 3 and 8 more in month 8. Each one costs $30 for the month. Adding staff or holding extra stock to cover them would have cost more.
- **Whole teams cost very little.** With fractions allowed, the chase plan costs $4,867,016, about $8,900 less, using 6.35 teams in the first month. Branch and bound took 13 nodes to find the best whole-team plan and prove it. Level and band needed only the first node.

## What surprised me

How accessible and accurate this was. I went in thinking a real solver meant a license, a server or at least a Python setup. Instead, HiGHS gives exact, provably optimal answers in under a second, in a browser tab, for free. You don't have to take its word for it, either. The page exports a workbook in the usual Solver layout, with live formulas, so you can check every number or run Solver on it again. It's also not just a classroom trick. The same kind of model plans real production, staffing and inventory.

## Where it breaks

The model is only as honest as its assumptions. It treats the demand forecast as known. A real plan has to absorb forecast error, and this one will happily cut inventory to the bone if you tell it demand is certain. Costs are linear too: the 50th hire costs the same as the first, and a team is just as productive in its first month as in its tenth. It plans up to 24 months, and HiGHS stops after 20 seconds if a whole-team model gets hard. The page then suggests allowing fractions or a shorter horizon.

## Study mode

The part I'd want a student to use is **Study**. It takes the same plan apart with your own numbers. It shows how the inputs become the model, the solve with fractions allowed, the first branch-and-bound split with both halves solved, HiGHS's own search log, and shadow prices: what one more unit of demand or capacity in each month would change the cost by. It also shows the exact model text that was sent to the solver.

Two things I hope a student takes away. First, how solvers work: they aren't magic, just a careful search over a model you wrote down. Second, how much logistics pulls together. This one case needs forecasting, labor planning, cost accounting, inventory policy and optimization all at once, and a good plan comes from understanding all of them.

The [Aggregate Planner](/aggregate-planning/) opens on the sample. Change any number and it solves all three plans again, or switch to Study to see how it got there.
