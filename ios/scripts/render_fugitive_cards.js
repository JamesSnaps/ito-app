// Renders Fugitive's card art for the iOS app from the web's own drawing
// code (static/fugitive.js), so a card looks the same in both. Writes one
// imageset per card into the app's asset catalogue.
//
//   node ios/scripts/render_fugitive_cards.js
//
// Needs Node and Playwright (npm i -g playwright && npx playwright install
// chromium). Run it again whenever cardSVG/backSVG or the footprints change;
// the PNGs are committed, so a build never needs it.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..');
const out = path.join(root, 'ios', 'GameNight', 'Assets.xcassets', 'Fugitive');
const engine = fs.readFileSync(path.join(root, 'games', 'fugitive', 'engine.py'), 'utf8');
const twos = new Set((engine.match(/TWO_FOOTPRINTS = frozenset\(\{([^}]*)\}\)/) || [, ''])[1]
  .split(',').map(s => Number(s.trim())).filter(n => !isNaN(n)));
const steps = n => n === 42 ? 0 : twos.has(n) ? 2 : 1;

const WIDTH = 80;   // points; rendered at 3x
const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${root}/static/fugitive.css">
<style>
  body { margin: 0; background: transparent; }
  .card { width: ${WIDTH}px; height: ${WIDTH * 1.4}px; }
  .card .fg-art { filter: none; width: 100%; height: 100%; display: block; }
</style></head>
<body class="fugitive" style="background: transparent">
<div id="slot" class="card"></div>
<script src="file://${root}/static/fugitive.js"></script>
</body></html>`;

function imageset(name, png) {
  const dir = path.join(out, `${name}.imageset`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.png`), png);
  fs.writeFileSync(path.join(dir, 'Contents.json'), JSON.stringify({
    images: [{ filename: `${name}.png`, idiom: 'universal', scale: '3x' }],
    info: { author: 'render_fugitive_cards.js', version: 1 }
  }, null, 2) + '\n');
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'Contents.json'),
    JSON.stringify({ info: { author: 'render_fugitive_cards.js', version: 1 } }, null, 2) + '\n');
  const browser = await chromium.launch();
  const tab = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 200, height: 200 } });
  const file = path.join(require('os').tmpdir(), 'fugitive-cards.html');
  fs.writeFileSync(file, page);
  await tab.goto('file://' + file);
  await tab.evaluate(() => document.fonts.ready);
  const slot = await tab.$('#slot');
  for (let n = 0; n <= 42; n++) {
    await tab.evaluate(([n, s]) => { document.getElementById('slot').innerHTML = cardSVG(n, s); }, [n, steps(n)]);
    await tab.evaluate(() => document.fonts.ready);
    imageset(`fugitive-card-${n}`, await slot.screenshot({ omitBackground: true }));
  }
  await tab.evaluate(() => { document.getElementById('slot').innerHTML = backSVG(); });
  imageset('fugitive-card-back', await slot.screenshot({ omitBackground: true }));
  await browser.close();
  console.log(`wrote 44 cards to ${path.relative(root, out)}`);
})();
