---
layout: post
title: "I replaced my Minecraft price spreadsheet with a crafting profit calculator"
seo_title: "My Minecraft Crafting Profit Calculator · Juan Torres"
date: 2026-10-07
tags: [minecraft, donutsmp, javascript, opportunity-cost]
description: "Why I built Craft Ledger, a Minecraft crafting profit calculator for DonutSMP and other SMPs, how it costs every vanilla recipe, and the crafts it turned up."
image: /assets/og/craft-ledger.png
image_alt: "Craft Ledger: which Minecraft crafts actually make money. A tool by Juan Torres."
---

On DonutSMP, everything has a price on the auction house and the order board, and every craft is a small trade: is this worth making, or should I just sell the materials? I was tracking those prices in an Excel spreadsheet, and I got tired of it. So I built [Craft Ledger](/craft-ledger.html), a Minecraft crafting profit calculator that does the tracking and the math for me. I used it on DonutSMP, and it flooded my ender chests.

This is how it works and what it turned up.

## What a spreadsheet can't keep up with

A spreadsheet is fine for a handful of recipes. You type in the price of paper and leather, write a formula for a book, then one for a bookshelf. The trouble is that Minecraft has a lot of recipes and they feed into each other. Every new item means new formulas, and every price change ripples up the chain.

Craft Ledger flips that around. You never enter a recipe. The full vanilla recipe set is built in, read from the game's own data files: 1,536 recipes covering 2,770 items, including crafting, smelting, blasting, smoking, campfire cooking, stonecutting and smithing. You only enter prices. The more raw materials you price, the more of the list fills in on its own.

## How it works

For every item it works out two things: what it sells for, and what it costs to make by the cheapest recipe. The interesting part is what counts as "cost."

Say books sell for 2,000 and a bookshelf for 15,000. A book costs 1,161 to craft from paper and leather, so it's tempting to say the bookshelf costs six planks plus three books at 1,161. But if you can sell a book for 2,000, putting it into a bookshelf costs you 2,000, because you gave up that sale. That's opportunity cost, and it's the default here (I call it **Market** basis):

| Bookshelf | Market basis | Cheapest basis |
| --- | --- | --- |
| 6 oak planks at 20 | 120 | 120 |
| 3 books | 6,000 (at their sale price) | 3,483 (at what they cost to make) |
| **Cost** | **6,120** | **3,603** |
| **Profit at 15,000** | **8,880** | **11,397** |

Both numbers are right. Market tells you whether the last step is worth doing. Cheapest tells you whether the whole chain beats doing nothing.

Two things made the math harder than a spreadsheet:

- **Recipes loop.** Nine gold ingots make a block of gold, and a block of gold makes nine ingots. A formula that follows recipes downward never finishes. The ledger instead starts from the prices you know and keeps passing over every recipe, lowering each item's cost whenever it finds a cheaper way to make it, until nothing changes anymore.
- **The top price doesn't hold.** The best order on the board might only want nine units. The ledger stores the order book and walks it for the number of units you actually plan to sell, so an item that looks great at a volume of one can fall off the list at a volume of a thousand.

It also charges fuel for smelting from the burn time of whatever you pick, takes the server's sale fee off every profit, and marks prices amber after a week and red after a month so stale numbers don't quietly skew everything above them.

## What it turned up

The ledger still opens with the 13 prices from my old spreadsheet. With just those, at a volume of 1,000, it ranks:

| Craft | Cost | Sells for | Profit per unit | Margin |
| --- | --- | --- | --- | --- |
| Bookshelf | 6,120 | 15,000 | 8,880 | 59.2% |
| Book | 1,161 | 2,000 | 839 | 41.9% |
| TNT | 1,355 | 1,500 | 145 | 9.7% |
| Golden carrot | 5 | 15 | 10 | 66.7% |
| Gold ingot (from a block) | 3.89 | 4 | 0.11 | 2.8% |
| Block of gold | 36 | 35 | −1 | −2.9% |

Bookshelves earn the most per unit, but the golden carrot has the best margin on the board. It's the kind of craft you'd never think to sell. That was the real surprise: once every recipe is priced, opportunities show up in a lot of items you would never consider. The flip side shows up too. Packing gold ingots into blocks loses money at these prices, even though it feels like it should be free.

Pricing more items makes the list grow quickly, and the **Coverage** tab ranks the items you haven't priced by how many crafts each one would unlock, so you know what to look up next.

## Where it breaks

It knows vanilla recipes only, so servers with custom items or changed recipes aren't covered. It also only knows the prices you give it. Prices on a live server move every day, and a stale price deep in a chain throws off every item above it. Buy and sell are one number too, because on DonutSMP you fill on orders. On a server with a wide gap between buying and selling, you'd have to pick which side you mean.

## Try it

[Craft Ledger](/craft-ledger.html) is free, needs no account and keeps your prices in your browser. It works on any SMP with an auction house, an order board or player shops. There's a step-by-step guide for DonutSMP [below the ledger](/craft-ledger.html#guide).
