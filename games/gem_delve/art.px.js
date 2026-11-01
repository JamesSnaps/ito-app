// Gem Delve test cave: every sprite and tile the game draws. 16px tiles; the miner is 14x16 with outline.
pal({
  k: "#14101c", v: "#1e1828", V: "#2a2236",
  d: "#6b4a2f", D: "#8a6340", e: "#4a3220",
  r: "#5a5a6e", R: "#7c7c92", q: "#3c3c4c", Q: "#2c2c38",
  x: "#c0284a", X: "#ff6f8a", z: "#1f8a5b", Z: "#6fe0a8", c: "#2a5fc0", C: "#7fb0ff", o: "#c99a14", O: "#ffe27a",
  w: "#fff6e0",
  y: "#e8b828", Y: "#ffe680", s: "#f0b890", S: "#c8886a", b: "#3060a8", B: "#20407a",
  n: "#6a4a30", N: "#4a3020", g: "#a0a0b0", G: "#d8d8e4", K: "#2a1a10",
  l: "#a07040", L: "#6a4a28",
  p: "#3a2450", P: "#6a4a8a", h: "#e0405a", H: "#ff9aa8",
})

// ------------------------------------------------------------------ tiles
const ROCK = [
  rect(0, 0, 16, 16, "r"), rect(0, 0, 16, 1, "R"), rect(0, 0, 1, 16, "R"),
  rect(0, 15, 16, 1, "q"), rect(15, 0, 1, 16, "q"),
  line(4, 3, 7, 8, "q"), line(7, 8, 6, 12, "q"), line(11, 2, 13, 6, "q"),
]
sprite("rock", { w: 16, h: 16 }, ...ROCK)
sprite("bedrock", { base: "rock", swap: { r: "q", R: "r", q: "Q" } })

const DIRT = [
  rect(0, 0, 16, 16, "d"),
  hline(2, 6, 4, "e"), hline(9, 11, 4, "e"), hline(1, 13, 3, "e"),
  px(5, 3, "D"), px(12, 8, "D"), px(8, 13, "D"), px(2, 10, "D"),
]
sprite("dirt", { w: 16, h: 16 }, ...DIRT)

sprite("_shard", `
  .X.
  XxX
  .x.`)
for (const [name, a, A] of [["emerald", "z", "Z"], ["sapphire", "c", "C"], ["ruby", "x", "X"], ["gold", "o", "O"]]) {
  const sw = { swap: { x: a, X: A } }
  sprite("ore_" + name, { w: 16, h: 16 }, ...DIRT,
    stamp("_shard", 2, 3, sw), stamp("_shard", 9, 2, sw), stamp("_shard", 10, 9, sw), stamp("_shard", 4, 10, sw))
}

sprite("ladder", { w: 16, h: 16 },
  rect(3, 0, 2, 16, "l"), rect(11, 0, 2, 16, "l"), vline(4, 0, 16, "L"), vline(12, 0, 16, "L"),
  rect(3, 3, 10, 1, "l"), rect(3, 4, 10, 1, "L"), rect(3, 11, 10, 1, "l"), rect(3, 12, 10, 1, "L"))

sprite("backwall", { w: 16, h: 16 },
  rect(0, 0, 16, 16, "V"), hline(0, 5, 16, "v"), hline(0, 12, 16, "v"), vline(6, 0, 5, "v"), vline(12, 5, 7, "v"), vline(3, 12, 4, "v"))

sprite("spikes", { w: 16, h: 16 }, (cv) => {
  for (let i = 0; i < 4; i++) {
    const x = i * 4
    cv.poly([x, 16, x + 2, 9, x + 4, 16], "g")
    cv.line(x + 2, 10, x + 3, 15, "q")
    cv.px(x + 2, 9, "G")
  }
})

// Mine-shaft way out: timber frame, dark inside, a lantern on the lintel.
sprite("exit", { w: 16, h: 16 },
  rect(2, 3, 12, 13, "k"), rect(1, 2, 2, 14, "l"), rect(13, 2, 2, 14, "l"),
  rect(0, 1, 16, 2, "l"), hline(0, 3, 16, "L"), vline(2, 4, 12, "L"), vline(14, 4, 12, "L"),
  rect(7, 4, 2, 3, "O"), px(7, 4, "w"), hline(6, 7, 4, "L"))

// ------------------------------------------------------------------ the miner (faces right)
sprite("_head", `
  ...yyyy...
  ..yYYYyw..
  .yyyyyyyy.
  ..ssss....
  ..sssks...
  ..sssS....`)
sprite("_body", `
  ...bbbggg.
  ..bbbbbg..
  ..bBbbsg..
  ..bbbb.g..`)
sprite("_body_climb", `
  ..bbbbbs..
  ..bbbb....
  ..bBbb....
  ..bbbb....`)
sprite("_body_up", `
  .gbbbb....
  .gbbbbs...
  ..bBbb....
  ..bbbb....`)
sprite("_body_down", `
  ...bbb......
  ..bbbbbsgg..
  ..bBbb...gg.
  ..bbbb....g.`)
sprite("_legs", `
  ...nnn....
  ...nNn....
  ..nn.nn...
  ..KK.KK...`)
sprite("_legs_a", `
  ...nnn....
  ..nnNnn...
  .nn...nn..
  .KK....KK.`)
sprite("_legs_b", `
  ...nnn....
  ...nNn....
  ...nnn....
  ...KKK....`)
sprite("_legs_c", `
  ...nnn....
  ..nnNn....
  ..nn.nn...
  .KK...KK..`)
sprite("_legs_jump", `
  ...nnn....
  ..nnNnn...
  ..nn.nn...
  ..KK..KK..`)
sprite("_legs_step", `
  ...nnn....
  ...nNnn...
  ...n.KK...
  ...KK.....`)

const miner = (name, body, legs, extra = []) =>
  sprite(name, { w: 12, h: 14, outline: "k" }, stamp("_head", 0, 0), stamp(body, 0, 6), stamp(legs, 0, 10), ...extra)

miner("m_idle", "_body", "_legs")
miner("m_run1", "_body", "_legs_a")
miner("m_run2", "_body", "_legs_b")
miner("m_run3", "_body", "_legs_c")
miner("m_jump", "_body", "_legs_jump")
miner("m_climb1", "_body_climb", "_legs")
miner("m_climb2", "_body_climb", "_legs_step")
miner("m_swing1", "_body_up", "_legs", [hline(0, 3, 2, "g"), px(0, 4, "g")])
miner("m_swing2", "_body_down", "_legs")

// ------------------------------------------------------------------ critters, gems, HUD
sprite("bat_up", { outline: "k" }, `
  p.......p
  pp.....pp
  .ppPPPpp.
  ..PhPhP..
  ...PPP...`)
sprite("bat_down", { outline: "k" }, `
  .........
  ..PPPPP..
  .pPhPhPp.
  pp.PPP.pp
  p.......p`)
sprite("bat_hang", { outline: "k" }, `
  ...P.P...
  ..pPPPp..
  ..pPPPp..
  ..PhPhP..
  ...PPP...`)

sprite("gem_ruby", { outline: "k" }, `
  ..xx..
  .xXXx.
  xXwXxx
  xxXxxx
  .xxxx.
  ..xx..`)
sprite("gem_emerald", { base: "gem_ruby", swap: { x: "z", X: "Z" } })
sprite("gem_sapphire", { base: "gem_ruby", swap: { x: "c", X: "C" } })
sprite("gem_gold", { base: "gem_ruby", swap: { x: "o", X: "O" } })

sprite("heart", { outline: "k" }, `
  .hh.hh.
  hHhhhhh
  hhhhhhh
  .hhhhh.
  ..hhh..
  ...h...`)
sprite("heart_empty", { base: "heart", swap: { h: "q", H: "r" } })

// One picture of everything, for checking the art at a glance.
const ALL = ["rock", "bedrock", "dirt", "ore_emerald", "ore_sapphire", "ore_ruby", "ore_gold", "ladder", "backwall", "spikes", "exit"]
const ACTORS = ["m_idle", "m_run1", "m_run2", "m_run3", "m_jump", "m_climb1", "m_climb2", "m_swing1", "m_swing2", "bat_up", "bat_down", "bat_hang", "gem_ruby", "gem_emerald", "gem_sapphire", "gem_gold", "heart", "heart_empty"]
scene("contact", { w: 16 * 11 + 4, h: 40, bg: "V" },
  ...ALL.map((n, i) => stamp(n, 2 + i * 16, 2)),
  ...ACTORS.map((n, i) => stamp(n, 2 + i * 10 - (i > 8 ? 0 : 0), 22)))
