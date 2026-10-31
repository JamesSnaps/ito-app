// Airports, in play order. Coordinates are in the 960x600 world.
// Runways: `x,y` is the landing threshold, `angle` (degrees, 0 = east, 90 = south)
// is the direction aircraft roll after touching down, `length` is the runway length.
// Pads only need a centre point.
//
// traffic.types     relative spawn weights per aircraft type
// traffic.interval  [start, end] seconds between arrivals; eases toward `end` as the level progresses
// traffic.maxPlanes cap on aircraft in the air at once (including ones about to arrive)
// traffic.fuel      seconds of fuel an arrival has (+/- a little)
// traffic.warning   seconds an arrival's marker shows before it appears (default 2)

// Landscape palettes. `farm` themes get a patchwork of fields and hedgerows; `desert` gets dunes and rock.
const THEMES = {
  meadow: {
    style: 'farm', clouds: true, river: true,
    base: '#93b764', fields: ['#9cc06c', '#8bb35d', '#b2c879', '#c8cd84', '#7eaa58', '#a5bd68', '#d6cb8c'],
    rows: 'rgba(52,74,26,0.17)', hedge: '#557d3b', tree: ['#3c6631', '#4d7c3b', '#68954d'],
    airfield: '#a8c977', airfieldStripe: '#9ec06e', road: '#ddd3b7', roadEdge: '#b1a587',
    river: '#5a9cbf', riverEdge: '#8cbdd2', concrete: '#cfcbc1', taxi: '#b9b6ae', asphalt: '#454a4e',
    roof: ['#b5523b', '#c9b48a', '#8d4a3a', '#d8d2c4'],
  },
  coast: {
    style: 'farm', clouds: true, sea: true,
    base: '#8fb862', fields: ['#97bf69', '#86b05a', '#adc776', '#c4cb80', '#7aa755', '#d3c98a'],
    rows: 'rgba(52,74,26,0.17)', hedge: '#527a39', tree: ['#3a6430', '#4b7a3a', '#66934b'],
    airfield: '#a5c875', airfieldStripe: '#9bbf6c', road: '#ddd3b7', roadEdge: '#b1a587',
    sea: '#2f7fa6', shallows: '#5bb0c5', sand: '#ead8a6', concrete: '#cfcbc1', taxi: '#b9b6ae', asphalt: '#454a4e',
    roof: ['#e9e4d8', '#4f7fa0', '#b5523b'],
  },
  desert: {
    style: 'desert', clouds: true,
    base: '#e0c08a', dune: '#d2aa70', duneLight: '#efd6a6', rock: '#b97f53', rockLight: '#cf9867', rockDark: '#8a5a39',
    scrub: ['#8a8d52', '#9c9d5f', '#767a45'], airfield: '#e6d0a2', airfieldStripe: '#e0c997',
    road: '#c9ae86', roadEdge: '#a78c63', concrete: '#dad3c5', taxi: '#c3bcae', asphalt: '#4a4a48',
    roof: ['#efe8d8', '#c96f4a', '#d9c7a6'],
  },
  snow: {
    style: 'farm', clouds: true, river: true, snowfall: true, treeSnow: true,
    base: '#e7eef2', fields: ['#eef3f6', '#e3eaee', '#f7fafb', '#dce5ea', '#e9eff2'],
    rows: 'rgba(110,130,148,0.13)', hedge: '#a3b2b8', tree: ['#355750', '#44665d', '#5a7c71'],
    airfield: '#dfe7eb', airfieldStripe: '#d5dfe4', road: '#c3cbcf', roadEdge: '#a2adb3',
    river: '#bcd6e1', riverEdge: '#f2f7f9', concrete: '#c9d0d4', taxi: '#b4bcc1', asphalt: '#4a5054',
    roof: ['#f4f7f8', '#9c4b3c', '#e9eef0'],
  },
  night: {
    style: 'farm', night: true, river: true,
    base: '#1b2a36', fields: ['#1d2f3d', '#203546', '#192935', '#233849', '#1c2e3a'],
    rows: 'rgba(0,0,0,0.2)', hedge: '#121f28', tree: ['#0d1820', '#11212c', '#172b38'],
    airfield: '#1f3443', airfieldStripe: '#1d3140', road: '#2c3943', roadEdge: '#17222a',
    river: '#162e44', riverEdge: '#1f3d55', concrete: '#36424b', taxi: '#2f3a42', asphalt: '#262b2f',
    roof: ['#2a353d', '#30282a'],
  },
};

const LEVELS = [
  {
    id: 1, code: 'MDS', name: 'Meadow Strip', theme: 'meadow', target: 6,
    hint: 'Drag from a plane to draw its route. Bring it in along the yellow approach lights to land on the strip.',
    runways: [{ kind: 'short', x: 380, y: 320, angle: 0, length: 200 }],
    traffic: { types: { prop: 1 }, interval: [8, 6], maxPlanes: 3, fuel: 100, warning: 3 },
  },
  {
    id: 2, code: 'TWF', name: 'Twin Fields', theme: 'meadow', target: 10,
    hint: 'Jets are faster and need the long red runway. Colours always match: yellow to yellow, red to red.',
    runways: [
      { kind: 'long', x: 280, y: 390, angle: 0, length: 320 },
      { kind: 'short', x: 640, y: 190, angle: 180, length: 190 },
    ],
    traffic: { types: { prop: 1, jet: 1 }, interval: [7, 4.5], maxPlanes: 4, fuel: 90, warning: 3 },
  },
  {
    id: 3, code: 'RTW', name: 'Rotor Wash', theme: 'coast', target: 14,
    hint: 'Helicopters land on the blue pad from any direction. A red line between two aircraft means they are too close.',
    runways: [
      { kind: 'long', x: 220, y: 420, angle: 0, length: 320 },
      { kind: 'short', x: 600, y: 150, angle: 90, length: 170 },
      { kind: 'pad', x: 730, y: 430 },
    ],
    traffic: { types: { prop: 1, jet: 1, heli: 0.9 }, interval: [6.5, 4], maxPlanes: 5, fuel: 90, warning: 3 },
  },
  {
    id: 4, code: 'XRD', name: 'Crossroads', theme: 'desert', target: 16,
    hint: 'Angled runways. Line your approach up with the lights; coming in sideways won\'t count.',
    runways: [
      { kind: 'long', x: 250, y: 470, angle: -30, length: 360 },
      { kind: 'short', x: 330, y: 170, angle: 40, length: 200 },
      { kind: 'pad', x: 760, y: 190 },
    ],
    traffic: { types: { prop: 1, jet: 1, heli: 0.8 }, interval: [6, 3.8], maxPlanes: 6, fuel: 85 },
  },
  {
    id: 5, code: 'FUM', name: 'Running on Fumes', theme: 'meadow', target: 16,
    hint: 'These arrivals are low on fuel. A gauge appears when the tank runs low. Run dry and they divert, costing a strike.',
    runways: [
      { kind: 'long', x: 180, y: 300, angle: 0, length: 300 },
      { kind: 'short', x: 780, y: 430, angle: 180, length: 180 },
      { kind: 'pad', x: 520, y: 150 },
    ],
    traffic: { types: { prop: 1, jet: 1, heli: 0.8 }, interval: [6, 3.8], maxPlanes: 6, fuel: 45 },
  },
  {
    id: 6, code: 'THD', name: 'Thunderheads', theme: 'coast', target: 18,
    hint: 'Storm cells drift across the field. Anything that flies into one diverts. Route around them.',
    runways: [
      { kind: 'long', x: 200, y: 330, angle: 15, length: 320 },
      { kind: 'short', x: 640, y: 150, angle: 120, length: 170 },
      { kind: 'pad', x: 700, y: 470 },
    ],
    storms: 2,
    traffic: { types: { prop: 1, jet: 1, heli: 0.8 }, interval: [6, 3.6], maxPlanes: 6, fuel: 80 },
  },
  {
    id: 7, code: 'WVN', name: 'Weathervane', theme: 'snow', target: 18,
    hint: 'The wind shifts every 40 seconds and the runways reverse. Aircraft on approach to the old end have to go around.',
    runways: [
      { kind: 'long', x: 270, y: 240, angle: 0, length: 360 },
      { kind: 'short', x: 360, y: 440, angle: 0, length: 200 },
      { kind: 'pad', x: 800, y: 140 },
    ],
    windShift: 40,
    traffic: { types: { prop: 1, jet: 1, heli: 0.8 }, interval: [6, 3.6], maxPlanes: 6, fuel: 85 },
  },
  {
    id: 8, code: 'HVY', name: 'Heavy Metal', theme: 'snow', target: 20,
    hint: 'Heavies are big, fast, and need extra room. Two long runways to keep them apart.',
    runways: [
      { kind: 'long', x: 200, y: 450, angle: -15, length: 360 },
      { kind: 'long', x: 260, y: 170, angle: 10, length: 340 },
      { kind: 'short', x: 800, y: 470, angle: 180, length: 170 },
      { kind: 'pad', x: 820, y: 250 },
    ],
    traffic: { types: { prop: 1, jet: 1.2, heavy: 1, heli: 0.8 }, interval: [5.5, 3.4], maxPlanes: 7, fuel: 85 },
  },
  {
    id: 9, code: 'NGT', name: 'Night Shift', theme: 'night', target: 24,
    hint: 'Everything at once: storms, wind shifts and heavies, after dark.',
    runways: [
      { kind: 'long', x: 230, y: 330, angle: 0, length: 320 },
      { kind: 'short', x: 700, y: 120, angle: 90, length: 170 },
      { kind: 'pad', x: 780, y: 470 },
    ],
    storms: 1, windShift: 50,
    traffic: { types: { prop: 1, jet: 1, heavy: 0.6, heli: 0.8 }, interval: [5.5, 3.2], maxPlanes: 7, fuel: 80 },
  },
  {
    id: 10, code: 'INF', name: 'Endless', theme: 'coast', endless: true, unlock: 5,
    hint: 'No target. Traffic keeps building. How many can you land?',
    runways: [
      { kind: 'long', x: 200, y: 400, angle: 0, length: 320 },
      { kind: 'short', x: 620, y: 140, angle: 90, length: 170 },
      { kind: 'pad', x: 720, y: 460 },
    ],
    storms: 1, windShift: 60,
    traffic: { types: { prop: 1, jet: 1, heavy: 0.5, heli: 0.8 }, interval: [6, 2.6], maxPlanes: 9, fuel: 85 },
  },
];
