/* The starting models. Each is the same JSON the sentence builder makes (see model.js); the
 * formulas are written as text here only because it's shorter, and parsed into the same trees.
 * Values marked blank are the questions the quick form asks; their sample values are the defaults.
 * All numbers are made-up samples, not taken from any textbook case.
 */
(function (root) {
  "use strict";
  const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.PSModel;
  const f = M.parse;
  const P = (id, label, value, unit, prompt) => ({ id, label, value, unit: unit || "", ...(prompt ? { blank: true, prompt } : {}) });
  const rows = (keys, cols) => keys.map((key, i) => { const r = { key }; for (const c in cols) r[c] = cols[c][i]; return r; });
  const grid = (A, B, m) => Object.fromEntries(A.map((a, i) => [a, Object.fromEntries(B.map((b, j) => [b, m[i][j]]))]));
  const OPT = { engine: "auto", timeLimitSec: 30, mipGap: 0.0001 };

  const T = [];

  /* 1. Staffing: hire, overtime or lose the sale */
  T.push({
    id: "staffing", title: "Staffing: hire, overtime or lost sales", tags: "Whole numbers · linear",
    blurb: "A week's demand to cover with the people you have, overtime, new hires, or sales you let go.",
    model: {
      schemaVersion: 1, title: "Weekly warehouse staffing", description: "Hire vs. overtime vs. lost sales",
      things: [
        { id: "crew", label: "Workers", kind: "single", properties: [
          P("count", "workers on staff", 5, "workers", "How many workers do you have now?"),
          P("rate", "units per hour", 10, "units/hour", "How many units does one worker make in an hour?"),
          P("pay", "pay per hour", 15, "$/hour", "What does an hour of regular time cost?"),
          P("otPremium", "overtime pay multiplier", 1.5, "", "Overtime pays how many times the regular rate?"),
          P("regMax", "regular hours each", 40, "hours/worker", "How many regular hours can each worker do?"),
          P("otMax", "overtime hours each", 10, "hours/worker", "And how many overtime hours each, at most?"),
          P("hireCost", "cost to hire one", 1000, "$/worker", "What does it cost to hire one more worker?"),
        ] },
        { id: "orders", label: "Orders", kind: "single", properties: [
          P("demand", "demand", 5000, "units", "How many units do you need this week?"),
          P("lost", "cost of a lost sale", 100, "$/unit", "What does each unit you can't make cost you in lost sales?"),
        ] },
      ],
      decisions: [
        { id: "hires", label: "Workers to hire", unit: "workers", type: "integer", lower: 0, upper: null },
        { id: "reg", label: "Regular hours", unit: "hours", type: "continuous", lower: 0, upper: null },
        { id: "ot", label: "Overtime hours", unit: "hours", type: "continuous", lower: 0, upper: null },
        { id: "short", label: "Units short", unit: "units", type: "continuous", lower: 0, upper: null },
      ],
      results: [
        { id: "staff", label: "Workers in all", unit: "workers", expr: f("crew.count + hires") },
        { id: "made", label: "Units made", unit: "units", expr: f("crew.rate * (reg + ot)") },
        { id: "cost", label: "Total cost", unit: "$", expr: f("crew.pay * reg + crew.pay * crew.otPremium * ot + crew.hireCost * hires + orders.lost * short") },
      ],
      rules: [
        { id: "regLimit", label: "Regular hours limit", lhs: f("reg"), op: "<=", rhs: f("crew.regMax * staff") },
        { id: "otLimit", label: "Overtime limit", lhs: f("ot"), op: "<=", rhs: f("crew.otMax * staff") },
        { id: "meet", label: "Meet demand", lhs: f("made + short"), op: ">=", rhs: f("orders.demand") },
      ],
      goal: { label: "Total cost", sense: "min", expr: f("cost") },
      options: { ...OPT },
    },
  });

  /* 2. Product mix */
  const products = ["Chairs", "Tables", "Shelves"], depts = ["Cutting", "Assembly", "Finishing"];
  T.push({
    id: "product-mix", title: "Product mix: the most profit", tags: "Linear",
    blurb: "Which products to make, and how many, when they share a few departments' hours.",
    model: {
      schemaVersion: 1, title: "Product mix", description: "The most profit from shared department hours",
      things: [
        { id: "products", label: "Products", one: "Product", kind: "table", blank: true, prompt: "What do you make, what does each earn, and how many can you sell?",
          columns: [{ id: "profit", label: "Profit", unit: "$/unit" }, { id: "maxSales", label: "Most you can sell", unit: "units" }],
          rows: rows(products, { profit: [45, 80, 60], maxSales: [200, 60, 100] }) },
        { id: "depts", label: "Departments", one: "Department", kind: "table", blank: true, prompt: "How many hours does each department have?",
          columns: [{ id: "hours", label: "Hours available", unit: "hours" }],
          rows: rows(depts, { hours: [400, 600, 300] }) },
        { id: "need", label: "Hours per unit", kind: "grid", over: ["products", "depts"], unit: "hours/unit", blank: true, prompt: "How many hours does one unit take in each department?",
          values: grid(products, depts, [[0.5, 1, 0.5], [1.5, 2.5, 1], [1, 1.5, 1]]) },
      ],
      decisions: [{ id: "make", label: "Units to make", unit: "units", type: "continuous", lower: 0, upper: f("products.maxSales"), indexBy: ["products"] }],
      results: [{ id: "profit", label: "Total profit", unit: "$", expr: f("sum(products, products.profit * make)") }],
      rules: [{ id: "hours", label: "Department hours", lhs: f("sum(products, need * make)"), op: "<=", rhs: f("depts.hours"), forEach: ["depts"] }],
      goal: { label: "Total profit", sense: "max", expr: f("profit") },
      options: { ...OPT },
    },
  });

  /* 3. Transportation */
  const whs = ["Reno", "Dallas", "Atlanta"], stores = ["Store 1", "Store 2", "Store 3", "Store 4", "Store 5"];
  T.push({
    id: "transportation", title: "Transportation: warehouses to stores", tags: "Linear · grid",
    blurb: "Ship from warehouses with limited supply to stores with set demand, at the lowest freight cost.",
    model: {
      schemaVersion: 1, title: "Warehouses to stores", description: "The cheapest way to ship",
      things: [
        { id: "whs", label: "Warehouses", one: "Warehouse", kind: "table", blank: true, prompt: "Where do you ship from, and how much does each place have?",
          columns: [{ id: "supply", label: "Supply", unit: "units" }], rows: rows(whs, { supply: [300, 400, 350] }) },
        { id: "stores", label: "Stores", one: "Store", kind: "table", blank: true, prompt: "Where do you ship to, and how much does each need?",
          columns: [{ id: "demand", label: "Demand", unit: "units" }], rows: rows(stores, { demand: [120, 150, 180, 200, 160] }) },
        { id: "freight", label: "Freight per unit", kind: "grid", over: ["whs", "stores"], unit: "$/unit", blank: true, prompt: "What does one unit cost to ship on each route?",
          values: grid(whs, stores, [[4, 6, 9, 7, 5], [6, 3, 4, 5, 8], [9, 7, 3, 4, 6]]) },
      ],
      decisions: [{ id: "ship", label: "Units to ship", unit: "units", type: "continuous", lower: 0, upper: null, indexBy: ["whs", "stores"] }],
      results: [{ id: "cost", label: "Freight cost", unit: "$", expr: f("sum(whs, sum(stores, freight * ship))") }],
      rules: [
        { id: "supply", label: "Supply limit", lhs: f("sum(stores, ship)"), op: "<=", rhs: f("whs.supply"), forEach: ["whs"] },
        { id: "demand", label: "Meet each store's demand", lhs: f("sum(whs, ship)"), op: ">=", rhs: f("stores.demand"), forEach: ["stores"] },
      ],
      goal: { label: "Freight cost", sense: "min", expr: f("cost") },
      options: { ...OPT },
    },
  });

  /* 4. Aggregate production planning */
  const months = ["Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6"];
  T.push({
    id: "aggregate", title: "Aggregate production planning", tags: "Whole numbers · several periods",
    blurb: "Six months of demand: when to hire and lay off, how much overtime, what to build ahead or let wait.",
    model: {
      schemaVersion: 1, title: "Six-month production plan", description: "Workforce, overtime, inventory and backorders",
      things: [
        { id: "months", label: "Months", one: "Month", kind: "table", blank: true, prompt: "What's the demand in each month?",
          columns: [{ id: "demand", label: "Demand", unit: "units" }], rows: rows(months, { demand: [1600, 1900, 2400, 2200, 1500, 1300] }) },
        { id: "plant", label: "The plant", kind: "single", properties: [
          P("startWorkers", "workers at the start", 20, "workers", "How many workers do you start with?"),
          P("rate", "units per worker each month", 90, "units/worker", "How many units does one worker make in a month?"),
          P("wage", "wage per worker each month", 2600, "$/worker", "What does a worker cost per month?"),
          P("hireCost", "cost to hire one", 900, "$/worker", "What does it cost to hire one worker?"),
          P("fireCost", "cost to lay off one", 1400, "$/worker", "And to lay one off?"),
          P("otMax", "overtime units per worker, at most", 15, "units/worker", null),
          P("otCost", "cost of an overtime unit", 38, "$/unit", "What does a unit made on overtime cost?"),
          P("holdCost", "cost to hold a unit for a month", 4, "$/unit", "What does a unit in stock cost you each month?"),
          P("backCost", "cost of a unit backordered for a month", 18, "$/unit", "And a unit a customer waits a month for?"),
          P("startInv", "inventory at the start", 300, "units", null),
        ] },
      ],
      decisions: [
        { id: "workers", label: "Workers", unit: "workers", type: "integer", lower: 0, upper: null, indexBy: ["months"] },
        { id: "hire", label: "Hires", unit: "workers", type: "integer", lower: 0, upper: null, indexBy: ["months"] },
        { id: "fire", label: "Layoffs", unit: "workers", type: "integer", lower: 0, upper: null, indexBy: ["months"] },
        { id: "made", label: "Units made on regular time", unit: "units", type: "continuous", lower: 0, upper: null, indexBy: ["months"] },
        { id: "ot", label: "Units made on overtime", unit: "units", type: "continuous", lower: 0, upper: null, indexBy: ["months"] },
        { id: "inv", label: "Inventory at month end", unit: "units", type: "continuous", lower: 0, upper: null, indexBy: ["months"] },
        { id: "back", label: "Backorders at month end", unit: "units", type: "continuous", lower: 0, upper: null, indexBy: ["months"] },
      ],
      results: [
        { id: "cost", label: "Total cost", unit: "$", expr: f("sum(months, plant.wage * workers + plant.hireCost * hire + plant.fireCost * fire + plant.otCost * ot + plant.holdCost * inv + plant.backCost * back)") },
      ],
      rules: [
        { id: "crew", label: "Workforce carries over", lhs: f("workers"), op: "=", rhs: f("workers[months-1 or plant.startWorkers] + hire - fire"), forEach: ["months"] },
        { id: "cap", label: "Regular-time capacity", lhs: f("made"), op: "<=", rhs: f("plant.rate * workers"), forEach: ["months"] },
        { id: "otcap", label: "Overtime capacity", lhs: f("ot"), op: "<=", rhs: f("plant.otMax * workers"), forEach: ["months"] },
        { id: "flow", label: "Inventory carries over", lhs: f("inv - back"), op: "=", rhs: f("inv[months-1 or plant.startInv] - back[months-1 or 0] + made + ot - months.demand"), forEach: ["months"] },
        { id: "end", label: "No backorders at the end", lhs: f("back[months=Month 6]"), op: "=", rhs: f("0") },
        { id: "level", label: "Level plan: no hiring or layoffs", lhs: f("hire + fire"), op: "=", rhs: f("0"), forEach: ["months"], disabled: true },
      ],
      goal: { label: "Total cost", sense: "min", expr: f("cost") },
      options: { ...OPT },
    },
  });

  /* 5. Shift assignment */
  const people = ["Ana", "Ben", "Cara", "Dev"], shifts = ["Mon early", "Mon late", "Tue early", "Tue late"];
  T.push({
    id: "shifts", title: "Shift assignment", tags: "Yes-or-no · each gets a different",
    blurb: "Give each person a different shift so the total cost (or dislike) is as low as it can be.",
    model: {
      schemaVersion: 1, title: "Shift assignment", description: "Each person a different shift",
      things: [
        { id: "people", label: "People", one: "Person", kind: "table", columns: [], rows: rows(people, {}) },
        { id: "shifts", label: "Shifts", one: "Shift", kind: "table", columns: [], rows: rows(shifts, {}) },
        { id: "cost", label: "Cost of the shift", kind: "grid", over: ["people", "shifts"], unit: "$", blank: true, prompt: "What does each person cost on each shift? (Or score how much they'd dislike it.)",
          values: grid(people, shifts, [[120, 150, 110, 160], [140, 115, 150, 120], [130, 140, 125, 135], [150, 125, 145, 110]]) },
      ],
      decisions: [{ id: "assign", label: "Works the shift", unit: "", type: "binary", indexBy: ["people", "shifts"] }],
      results: [{ id: "total", label: "Total cost", unit: "$", expr: f("sum(people, sum(shifts, cost * assign))") }],
      rules: [{ id: "diff", label: "Each person gets a different shift", kind: "different", decision: "assign", fillAll: true }],
      goal: { label: "Total cost", sense: "min", expr: f("total") },
      options: { ...OPT },
    },
  });

  /* 6. Blending / diet */
  const foods = ["Oats", "Milk", "Eggs", "Beans", "Rice", "Spinach"];
  T.push({
    id: "diet", title: "Blending: meet the minimums for less", tags: "Linear",
    blurb: "Mix ingredients so every nutrient (or spec) is met, at the lowest cost. The numbers are samples.",
    model: {
      schemaVersion: 1, title: "Cheapest day of meals", description: "Meet each daily need at the lowest cost",
      things: [
        { id: "foods", label: "Foods", one: "Food", kind: "table", blank: true, prompt: "What can go in, and what does a serving cost and contain?",
          columns: [{ id: "cost", label: "Cost per serving", unit: "$/serving" }, { id: "protein", label: "Protein", unit: "g/serving" }, { id: "fiber", label: "Fiber", unit: "g/serving" }, { id: "kcal", label: "Calories", unit: "kcal/serving" }],
          rows: rows(foods, { cost: [0.3, 0.45, 0.6, 0.5, 0.25, 0.8], protein: [5, 8, 12, 9, 4, 3], fiber: [4, 0, 0, 7, 1, 4], kcal: [150, 120, 140, 130, 200, 40] }) },
        { id: "need", label: "Daily needs", kind: "single", properties: [
          P("protein", "protein, at least", 60, "g", "How much protein a day, at least?"),
          P("fiber", "fiber, at least", 25, "g", "How much fiber, at least?"),
          P("kcalMin", "calories, at least", 1800, "kcal", "Calories: at least…"),
          P("kcalMax", "calories, at most", 2400, "kcal", "…and at most?"),
          P("most", "servings of any one food, at most", 6, "servings", null),
        ] },
      ],
      decisions: [{ id: "eat", label: "Servings", unit: "servings", type: "continuous", lower: 0, upper: f("need.most"), indexBy: ["foods"] }],
      results: [{ id: "cost", label: "Cost of the day", unit: "$", expr: f("sum(foods, foods.cost * eat)") }],
      rules: [
        { id: "protein", label: "Enough protein", lhs: f("sum(foods, foods.protein * eat)"), op: ">=", rhs: f("need.protein") },
        { id: "fiber", label: "Enough fiber", lhs: f("sum(foods, foods.fiber * eat)"), op: ">=", rhs: f("need.fiber") },
        { id: "kcal", label: "Calories in range", lhs: f("sum(foods, foods.kcal * eat)"), op: "between", rhs: f("need.kcalMin"), rhs2: f("need.kcalMax") },
      ],
      goal: { label: "Cost of the day", sense: "min", expr: f("cost") },
      options: { ...OPT },
    },
  });

  /* 7. Facility location */
  const sites = ["North", "East", "South", "West"], custs = ["Area A", "Area B", "Area C", "Area D", "Area E"];
  T.push({
    id: "facility", title: "Facility location: which to open", tags: "Yes-or-no · fixed costs",
    blurb: "Pick which sites to open (each has a fixed cost and a capacity) and who each one serves.",
    model: {
      schemaVersion: 1, title: "Which warehouses to open", description: "Fixed plus shipping cost",
      things: [
        { id: "sites", label: "Sites", one: "Site", kind: "table", blank: true, prompt: "Which sites could you open, what does each cost to run, and how much can it handle?",
          columns: [{ id: "fixed", label: "Fixed cost if open", unit: "$" }, { id: "cap", label: "Capacity", unit: "units" }],
          rows: rows(sites, { fixed: [9000, 7500, 8200, 6800], cap: [700, 500, 650, 450] }) },
        { id: "areas", label: "Areas", one: "Area", kind: "table", blank: true, prompt: "Who needs serving, and how much?",
          columns: [{ id: "demand", label: "Demand", unit: "units" }], rows: rows(custs, { demand: [180, 220, 160, 240, 200] }) },
        { id: "freight", label: "Shipping per unit", kind: "grid", over: ["sites", "areas"], unit: "$/unit",
          values: grid(sites, custs, [[3, 5, 8, 6, 9], [6, 3, 4, 7, 6], [8, 6, 3, 4, 5], [5, 8, 6, 3, 4]]) },
        { id: "policy", label: "Policy", kind: "single", properties: [P("most", "sites open, at most", 2, "sites", "How many sites can you open at most?")] },
      ],
      decisions: [
        { id: "open", label: "Open the site", unit: "", type: "binary", indexBy: ["sites"] },
        { id: "ship", label: "Units shipped", unit: "units", type: "continuous", lower: 0, upper: null, indexBy: ["sites", "areas"] },
      ],
      results: [{ id: "cost", label: "Total cost", unit: "$", expr: f("sum(sites, sites.fixed * open) + sum(sites, sum(areas, freight * ship))") }],
      rules: [
        { id: "cap", label: "Only open sites ship, up to capacity", lhs: f("sum(areas, ship)"), op: "<=", rhs: f("sites.cap * open"), forEach: ["sites"] },
        { id: "serve", label: "Serve every area", lhs: f("sum(sites, ship)"), op: ">=", rhs: f("areas.demand"), forEach: ["areas"] },
        { id: "most", label: "Open at most the limit", kind: "pick", decision: "open", op: "<=", count: f("policy.most") },
      ],
      goal: { label: "Total cost", sense: "min", expr: f("cost") },
      options: { ...OPT },
    },
  });

  /* 8. Truck loading (knapsack) */
  const items = ["Pallet A", "Pallet B", "Pallet C", "Pallet D", "Pallet E", "Pallet F", "Pallet G", "Pallet H"];
  T.push({
    id: "loading", title: "Truck loading: the most value aboard", tags: "Yes-or-no",
    blurb: "Which loads to put on one truck so the value is highest without going over its weight limit.",
    model: {
      schemaVersion: 1, title: "Load one truck", description: "The most value under a weight limit",
      things: [
        { id: "items", label: "Loads", one: "Load", kind: "table", blank: true, prompt: "What could go on the truck: each load's weight and value?",
          columns: [{ id: "weight", label: "Weight", unit: "lb" }, { id: "value", label: "Value", unit: "$" }],
          rows: rows(items, { weight: [1200, 950, 1800, 700, 1500, 1100, 600, 1300], value: [2600, 2100, 3500, 1300, 3300, 2500, 1100, 2700] }) },
        { id: "truck", label: "The truck", kind: "single", properties: [P("cap", "weight limit", 6000, "lb", "What's the truck's weight limit?")] },
      ],
      decisions: [{ id: "load", label: "Put it on", unit: "", type: "binary", indexBy: ["items"] }],
      results: [
        { id: "weight", label: "Weight aboard", unit: "lb", expr: f("sum(items, items.weight * load)") },
        { id: "value", label: "Value aboard", unit: "$", expr: f("sum(items, items.value * load)") },
      ],
      rules: [{ id: "cap", label: "Weight limit", lhs: f("weight"), op: "<=", rhs: f("truck.cap") }],
      goal: { label: "Value aboard", sense: "max", expr: f("value") },
      options: { ...OPT },
    },
  });

  /* 9. Budget allocation */
  const opts9 = ["Savings", "Bonds", "Index fund", "Property fund", "Small companies"];
  T.push({
    id: "budget", title: "Budget allocation", tags: "Linear",
    blurb: "Split a budget across options with different expected returns and risk, under a risk limit. The numbers are samples, not advice.",
    model: {
      schemaVersion: 1, title: "Split a budget", description: "The highest expected return under a risk limit",
      things: [
        { id: "opts", label: "Options", one: "Option", kind: "table", blank: true, prompt: "What are the options, and what does each return and risk?",
          columns: [{ id: "ret", label: "Expected return", unit: "%" }, { id: "risk", label: "Risk score (1–10)", unit: "" }, { id: "maxShare", label: "Most of the budget", unit: "%" }],
          rows: rows(opts9, { ret: [3, 4.5, 7, 6, 9.5], risk: [1, 2, 5, 6, 9], maxShare: [100, 60, 50, 30, 20] }) },
        { id: "money", label: "The budget", kind: "single", properties: [
          P("budget", "to split", 50000, "$", "How much is there to split?"),
          P("risk", "average risk score, at most", 4, "", "What's the highest average risk score you'd accept?"),
        ] },
      ],
      decisions: [{ id: "put", label: "Amount", unit: "$", type: "continuous", lower: 0, upper: f("money.budget * opts.maxShare / 100"), indexBy: ["opts"] }],
      results: [{ id: "ret", label: "Expected return", unit: "$", expr: f("sum(opts, put * opts.ret / 100)") }],
      rules: [
        { id: "all", label: "Spend no more than the budget", lhs: f("sum(opts, put)"), op: "<=", rhs: f("money.budget") },
        { id: "risk", label: "Average risk within the limit", lhs: f("sum(opts, opts.risk * put)"), op: "<=", rhs: f("money.risk * money.budget") },
      ],
      goal: { label: "Expected return", sense: "max", expr: f("ret") },
      options: { ...OPT },
    },
  });

  /* 10. Pricing (nonlinear) */
  T.push({
    id: "pricing", title: "Pricing: the most profit", tags: "Nonlinear",
    blurb: "Raise the price and you sell fewer. Find the price where profit peaks.",
    model: {
      schemaVersion: 1, title: "Set a price", description: "Price against demand",
      things: [{ id: "market", label: "The market", kind: "single", properties: [
        P("base", "units you'd sell if it were free", 1000, "units", "How many would you sell at a price of zero (where the demand line starts)?"),
        P("drop", "units lost per $1 of price", 20, "units/$", "How many fewer do you sell for each $1 you add to the price?"),
        P("cost", "cost to make one", 12, "$/unit", "What does one unit cost you?"),
      ] }],
      decisions: [{ id: "price", label: "Price", unit: "$/unit", type: "continuous", lower: 0, upper: null }],
      results: [
        { id: "sold", label: "Units sold", unit: "units", expr: f("market.base - market.drop * price") },
        { id: "profit", label: "Profit", unit: "$", expr: f("(price - market.cost) * sold") },
      ],
      rules: [{ id: "pos", label: "Can't sell fewer than none", lhs: f("sold"), op: ">=", rhs: f("0") }],
      goal: { label: "Profit", sense: "max", expr: f("profit") },
      options: { ...OPT },
    },
  });

  const api = { list: T, get: (id) => T.find((t) => t.id === id) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PSTemplates = api;
})(typeof self !== "undefined" ? self : this);
