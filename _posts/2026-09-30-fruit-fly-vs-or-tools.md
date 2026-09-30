---
layout: post
title: "I raced a fruit fly's brain against Google's OR-Tools"
date: 2026-09-30
tags: [logistics, simulation, or-tools, flywire]
description: "I put a fruit fly's navigation circuit, wired from FlyWire, in charge of a delivery truck and raced it against OR-Tools. Where the fly won, and where it didn't."
image: /assets/og/fruit-fly-dispatcher.png
image_alt: "Fruit Fly Dispatcher: a fly’s brain against Google OR-Tools, 55 stores, one week. A simulation by Juan Torres."
---

I'd been seeing people get a simulated fruit fly brain to "play" Doom. Around the same time I was sitting in a 400-level logistics class working through a case on 7-Eleven's fresh-food deliveries, and the two ideas ran into each other: what if a fly had to solve a logistics problem? Nature has been solving "find food with almost no information" for a very long time. How would a fly's choices compare to ours, and how would it hold up against the kind of optimizer a real company uses?

So I built it. The [Fruit Fly Dispatcher](/fruit-fly-dispatcher/) puts a fruit fly's navigation circuit in charge of a delivery truck and races it against Google's OR-Tools for a week of deliveries. You can watch any of the runs on that page. This post is how it works and what came out of it.

## The setup

One truck, one distribution center, 55 convenience stores, Monday to Sunday. Fresh food sells in breakfast, lunch and dinner rushes off a shelf that only holds 40% of a day's sales, so the truck has to keep coming back. An empty shelf means a lost sale. The truck drives 30 km/h and every stop takes 5 minutes. Profit is a 30% margin on what actually sells, minus ¥200 for every kilometer driven. The store economics come from the class case.

Four "brains" take turns driving:

- **OR-Tools, live.** Google's exact solver (CP-SAT), re-planning the rest of the trip at every stop.
- **OR-Tools, planned day.** Plans every trip at dawn from that morning's shelf data.
- **Fly rule.** A greedy rule: go wherever earns the most per hour, one stop at a time.
- **FlyWire brain.** The fly's own navigation circuit, built from the connectome.

The twist is that each brain is also run at four levels of knowledge:

1. **Company data.** Live shelf levels and GPS, which is what a real dispatcher at 7-Eleven has.
2. **Perfect memory.** Knows every store and how it usually sells, but only learns shelf levels by smell.
3. **Learning fly.** Starts knowing only where the depot is and learns the stores as it finds them.
4. **Dumb fly.** No memory at all. It finds stores only by following their smell, and every day is its first.

That split is the whole point. I wanted to separate *who makes the decisions* from *what they know*.

## Putting a fly in the driver's seat

[FlyWire](https://flywire.ai/) is a map of every neuron and synapse in an adult fruit fly's brain. The part I used is the navigation circuit. One ring of cells keeps track of which way the fly is facing, another set holds a goal direction, and steering cells compare the two to decide which way to turn. When the fly smells something, wind-sensing cells write an "upwind" goal into those same goal cells through their real FlyWire connections. So memory ("the store was over there") and smell ("something good is upwind") compete inside the actual wiring.

I tried to keep myself honest here. Every direction the circuit uses was derived from the wiring alone and then checked against something independent. I didn't feed any published results in. A few things aren't the connectome: four settings were tuned on simple single-goal steering, two constants come from behavior studies, and the choice of *which* store to go for is a foraging rule I wrote. The circuit handles the steering, not the whole business.

All the brains share the same reflexes when memory runs out: surge upwind on a whiff, cast crosswind when the scent is lost, then search in a spiral. Across the density sweeps and example weeks, that came to more than 300 simulated weeks.

## What happened

### Knowing beat deciding, by a lot

Going from a fly with no memory to live company data is worth about **¥19.7M a week** on average. Swapping one brain for another at the same level of knowledge changes profit by at most **¥3.86M**. What the truck knows mattered far more than how smart the thing driving it was.

Even more surprising: a fly that just *remembers* where the stores are and how they usually sell earns **99%** of what live point-of-sale data earns. Most of the losses come from not knowing the map at all.

### The fly won when information was thin

With the same senses and the same truck, the FlyWire brain beat OR-Tools by up to **9%**. That was as a dumb fly, with stores about 128 m apart. In the dense example week the gap was bigger. With no memory, the fly served **55%** of demand against OR-Tools' **43%**:

| Stores 65 m apart, profit per week | OR-Tools | FlyWire brain |
| --- | --- | --- |
| Company data | ¥32.6M | ¥32.3M |
| Perfect memory | ¥32.5M | ¥32.4M |
| Learning fly | ¥30.2M | ¥30.8M |
| Dumb fly | ¥13.4M | **¥17.3M** |

An optimizer is only as good as what it's told. Give it good information and it's the best there is. Take the information away and it's planning around stores it doesn't know exist. The fly doesn't plan much at all. It reacts to what it smells, and blending that with whatever it remembers lets it pick up stores it passes on the way. When stores are packed close together, that turns out to be a very good strategy.

### Spread the stores out and the solver takes over

This is the part I didn't expect going in. It only works when stores are close. Spread them out and every wrong turn gets expensive:

| Stores 2.5 km apart, profit per week | OR-Tools | FlyWire brain |
| --- | --- | --- |
| Company data | ¥23.5M | ¥21.8M |
| Perfect memory | ¥23.3M | ¥21.0M |
| Learning fly | ¥13.5M | ¥10.2M |
| Dumb fly | ¥4.2M | ¥2.8M |

OR-Tools wins at every level. By the time stores are 5.1 km apart, the learning fly earns 47% less than the solver. Exact routing also only starts paying off (up to 10% over the greedy rule) once stores are about 1.3 km or more apart. Below roughly 640 m, the simple rule ties it.

### Density explained the 7-Eleven case

The case talks about 7-Eleven Japan delivering fresh food about three times a day, against about once a day in the US. I never told the model to do that. It came out on its own. With stores packed close, one truck manages about **3.7** deliveries per store per day. Spread the same 55 stores out and it drops to **1.1**. Past about 546 m between stores, the truck can't come back often enough, no matter which brain is driving. Delivery frequency isn't really a policy you pick. It follows from how close your stores are.

### Learning, and what bad GPS does to it

A learning fly in a dense area goes from serving 70% of demand on Monday to 99% by Sunday, and knows 50+ stores by Tuesday. In the spread-out layout it only gets from 40% to 45% and finds 28 of the 55 stores all week. Getting a new driver or a new area up to speed has a real cost, and that cost grows with distance.

I also added drift to the truck's sense of its own position. A learning fly records its map while it's drifting, so the map itself ends up wrong. FlyWire lost 54% of its profit, OR-Tools 68% and the greedy rule 70%. The fly held up best because smell corrects a bad memory on the way in.

## What I took from it

- **Fix the information before the algorithm.** Clean store locations and demand history got 99% of the value of live data.
- **Optimizers earn their keep when stops are far apart.** In a tight cluster, a simple rule ties an exact solver.
- **When information is poor, let the edge react.** A driver who stops where the shelf looks empty can beat a plan built on bad data.
- **Density drives frequency.** Cluster the stores and frequent fresh delivery follows.

The fly didn't beat Google in general, and I didn't expect it to. What it did was show where each approach makes sense. In a tight network where nobody knows much, a brain that evolved to find food by smell is really good at logistics. Where the map is big and every kilometer costs money, you want the solver.

Every run is on the [Fruit Fly Dispatcher](/fruit-fly-dispatcher/) page. You can pick any brain at any level and watch its whole week, or drag the memory and smell inputs around inside the circuit yourself.
