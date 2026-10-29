// Renders Wildwood's card art for the iOS app from the web's own drawing
// code (static/wildwood.js), so a card looks the same in both. Writes one
// imageset per distinct face, the back, and the computer seats' animals into
// the app's asset catalogue.
//
//   node ios/scripts/render_wildwood_cards.js
//
// Needs Node and Playwright, as render_fugitive_cards.js does — or just
// playwright-core with CHROMIUM_PATH pointing at a Chromium (a cached
// Playwright build, or Chrome itself). Run it again whenever
// cardSVG/backSVG/critterSVG change; the PNGs are committed, so a build
// never needs it.
const fs = require('fs');
const path = require('path');
const { chromium } = (() => {
  try { return require('playwright'); } catch (e) { return require('playwright-core'); }
})();

const root = path.resolve(__dirname, '..', '..');
const out = path.join(root, 'ios', 'GameNight', 'Assets.xcassets', 'Wildwood');

const COLOURS = ['r', 'g', 'b', 'y'];
const SYMBOLS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'R', 'D'];
const CARDS = [...COLOURS.flatMap(c => SYMBOLS.map(s => c + s)), 'W', 'W4'];
const CRITTERS = ['Hedgehog', 'Rabbit', 'Squirrel', 'Mole'];

const WIDTH = 90;   // points; rendered at 3x
const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${root}/static/wildwood.css">
<style>
  /* Only the shared sheet's typeface, not its page. */
  @font-face {
    font-family: "Baloo 2";
    src: url("file://${root}/static/fonts/baloo2-variable.woff2") format("woff2-variations");
    font-weight: 400 800;
  }
  :root { --font-display: "Baloo 2", ui-rounded, sans-serif; }
  html, body { margin: 0; background: transparent; }
  .card { width: ${WIDTH}px; height: ${WIDTH * 1.4}px; }
  .card .ww-art { filter: none; width: 100%; height: 100%; display: block; }
  .critter { width: 64px; height: 64px; }
</style></head>
<body class="wildwood" style="background: transparent">
<div id="slot" class="card"></div>
<div id="face" class="critter"></div>
<script src="file://${root}/static/wildwood.js"></script>
</body></html>`;

function imageset(name, png) {
  const dir = path.join(out, `${name}.imageset`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.png`), png);
  fs.writeFileSync(path.join(dir, 'Contents.json'), JSON.stringify({
    images: [{ filename: `${name}.png`, idiom: 'universal', scale: '3x' }],
    info: { author: 'render_wildwood_cards.js', version: 1 }
  }, null, 2) + '\n');
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'Contents.json'),
    JSON.stringify({ info: { author: 'render_wildwood_cards.js', version: 1 } }, null, 2) + '\n');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const tab = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 240, height: 240 } });
  const file = path.join(require('os').tmpdir(), 'wildwood-cards.html');
  fs.writeFileSync(file, page);
  await tab.goto('file://' + file);
  await tab.evaluate(() => document.fonts.ready);
  const slot = await tab.$('#slot');
  for (const card of CARDS) {
    await tab.evaluate(c => { document.getElementById('slot').innerHTML = cardSVG(c); }, card);
    await tab.evaluate(() => document.fonts.ready);
    imageset(`wildwood-card-${card}`, await slot.screenshot({ omitBackground: true }));
  }
  await tab.evaluate(() => { document.getElementById('slot').innerHTML = backSVG(); });
  await tab.evaluate(() => document.fonts.ready);
  imageset('wildwood-card-back', await slot.screenshot({ omitBackground: true }));
  const face = await tab.$('#face');
  for (const name of CRITTERS) {
    await tab.evaluate(n => { document.getElementById('face').innerHTML = critterSVG(n); }, name);
    imageset(`wildwood-critter-${name}`, await face.screenshot({ omitBackground: true }));
  }
  await browser.close();
  console.log(`${CARDS.length} faces, the back and ${CRITTERS.length} animals → ${path.relative(root, out)}`);
})();
