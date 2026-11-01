// The Academy, lessons 1 to 5: one idea each, a short scenario at Ambleford,
// a task list that ticks itself off, Ann's coaching (a retired controller;
// text for now, her voice later) and a short check to pass before the next
// lesson opens.
//
// A task: {text, coach, done(g, ev), hint(g)?, praise?}. done() is asked on
// every event (an instruction, a tap, something the simulation reports) and
// once a frame with ev = null; the first true ticks it. g is the game's
// lesson handle: g.sim, g.find(cs), g.taskTime (seconds on this task).
// A lesson's fail(g, ev) returns a sentence when it can't go on.
(function (root) {
  'use strict';
  const FV = root.FV = root.FV || {};

  const said = (ev, cs, t, test = () => true) =>
    !!ev && ev.kind === 'instruction' && ev.cs === cs && ev.cmds.some(c => c.t === t && test(c));
  const is = (ev, kind, cs) => !!ev && ev.kind === kind && (!cs || ev.cs === cs);
  const left = (g, ev) => (ev && ev.kind === 'left' ? `${ev.cs} flew out of your airspace. Have another go.` : null);
  const ring = cs => [{ kind: 'ring', cs }];

  const LESSONS = [
    {
      id: 1, title: 'Reading the scope',
      learn: 'Data tags, strips, range rings, what’s yours',
      intro: 'Everything on this screen is what a real approach controller sees, just tidier. Learn to read it at a glance.',
      setup(g) {
        g.spawn({ cs: 'SKY412', type: 'A320', x: 24, y: 7, hdg: 255, alt: 7000, ias: 240 });
        g.spawn({ cs: 'MDW6', type: 'BE20', x: 13, y: -9, hdg: 300, alt: 6000, cfl: 4000, ias: 190 });
        g.spawn({ cs: 'KES71', type: 'B77W', route: 'DNK', x: 33, y: 18, alt: 9000, ias: 240 });
      },
      fail: left,
      tasks: [
        {
          text: 'Tap Skylark 412 (SKY412) on the scope',
          coach: "Hello, I'm Ann. Each little square is an aircraft, and everything on this scope is real-world radar. Tap Skylark 412, east of the airport.",
          praise: 'That amber box means it’s selected: the one you’re talking to.',
          hint: () => ring('SKY412'),
          done: (g, ev) => is(ev, 'select', 'SKY412'),
        },
        {
          text: 'Find the aircraft that’s descending, and tap it',
          coach: 'The tag’s second line is altitude in hundreds of feet, the level it’s cleared to, then ground speed. 060↓040 210 reads “at 6,000 feet, descending to 4,000, 210 knots”. Which one is coming down?',
          praise: 'Meadow 6: the arrow points down, from where it is to where it’s cleared.',
          done: (g, ev) => is(ev, 'select', 'MDW6'),
        },
        {
          text: 'Tap the heavy’s strip on the left',
          coach: 'The letter after the callsign is its wake category: L light, M medium, H heavy. Heavies leave a bigger wake, so they need bigger gaps behind them. The strips on the left are the paper strips controllers still use, one per aircraft.',
          praise: 'Kestrel 71, a Boeing 777. Its strip says where it’s going: the Dunnock stack.',
          done: (g, ev) => is(ev, 'strip', 'KES71'),
        },
        {
          text: 'Watch the traffic move for 20 seconds',
          coach: 'The dots behind each aircraft are where it was at the last few sweeps; the line in front is where it’ll be in a minute. The rings are 5 miles apart. The dashed line east of the runway is the extended centreline, a tick every mile.',
          praise: 'That’s the scope. Now a few quick questions.',
          done: g => g.taskTime >= 20,
        },
      ],
      quiz: [
        { q: 'A tag reads 070↓050 240. The aircraft is…', options: ['At 7,000 ft, descending to 5,000, at 240 knots', 'At 5,000 ft, climbing to 7,000, at 240 knots', 'At 70 ft, cleared to land at 50 knots'], answer: 0 },
        { q: 'The range rings are…', options: ['1 mile apart', '5 miles apart', '10 miles apart'], answer: 1 },
        { q: 'An H after the callsign means…', options: ['It’s holding', 'It’s high', 'A heavy: it needs a bigger gap behind it'], answer: 2 },
      ],
    },
    {
      id: 2, title: 'Headings',
      learn: 'Turning aircraft, which way they turn, how long it takes',
      intro: 'Turning aircraft: which way they turn, and how long it takes. A heading is where the nose points, in degrees from north.',
      setup(g) {
        g.spawn({ cs: 'SKY412', type: 'A320', x: 22, y: -6, hdg: 270, alt: 7000, ias: 220 });
      },
      fail: left,
      tasks: [
        {
          text: 'Turn SKY412 right heading 360 with the dial',
          coach: 'Tap Skylark 412 and a dial opens round it. Drag the amber knob round the ring to 360 (north), check the Send button says “Right 360”, and send it.',
          praise: 'Listen: the pilot reads it back. They always do.',
          hint: () => [{ kind: 'heading', cs: 'SKY412', hdg: 360 }],
          done: (g, ev) => said(ev, 'SKY412', 'hdg', c => c.hdg === 360),
        },
        {
          text: 'Watch it turn: 90° takes about half a minute',
          coach: 'Airliners turn at about 3 degrees a second, a little slower for a heavy. The pilot takes a moment to start, too, so give turns early.',
          praise: 'Steady on 360.',
          done: g => { const a = g.find('SKY412'); return !!a && a.thdg == null && Math.abs(FV.Sim.diff(360, a.hdg)) < 1; },
        },
        {
          text: 'Type it this time: SKY412 L270, then Enter',
          coach: 'On a laptop the command line under the scope is faster. L270 is “turn left heading 270”, R for right. You only need the start of a callsign: SK and Tab fills in the rest.',
          praise: 'Same readback, either way you give it.',
          done: (g, ev) => said(ev, 'SKY412', 'hdg', c => c.hdg === 270 && ev.source === 'line'),
        },
        {
          text: 'Turn it right heading 180: the long way round',
          coach: 'From 270, the short way to 180 is left. Say “right” and it goes right, all the way round: 270 degrees. On the dial, drag clockwise; or type SKY412 R180. You’ll rarely want this, but you must know it happens.',
          praise: 'All the way round. The direction you say is the direction they turn.',
          done: (g, ev) => said(ev, 'SKY412', 'hdg', c => c.hdg === 180 && FV.Command.turnFor(c, g.find('SKY412') ? g.find('SKY412').hdg : 270) === 'R'),
        },
      ],
      quiz: [
        { q: 'At 3° a second, a 90° turn takes about…', options: ['10 seconds', '30 seconds', '2 minutes'], answer: 1 },
        { q: 'Heading 360, told “turn left heading 090”. Which way does it turn?', options: ['Right, the short way', 'Left, the long way round (270°)', 'It asks you which way'], answer: 1 },
      ],
    },
    {
      id: 3, title: 'Altitudes',
      learn: 'Climb and descent, cleared levels, rates',
      intro: 'Climbs and descents, cleared levels and how long they take. Below 6,000 ft altitudes are in feet; above it, flight levels.',
      setup(g) {
        g.spawn({ cs: 'SKY412', type: 'A320', x: 25, y: 5, hdg: 270, alt: 8000, ias: 220 });
        g.spawn({ cs: 'PUF27', type: 'B738', x: 4, y: -11, hdg: 90, alt: 5000, ias: 210 });
      },
      fail: left,
      tasks: [
        {
          text: 'Descend SKY412 to 5,000 ft',
          coach: 'Skylark 412 is at flight level 80: 8,000 feet on the standard pressure setting. On the dial, scroll the ALT column to 5000; or type SKY412 D50 (D for descend, in hundreds of feet).',
          praise: 'Look at its tag: 080↓050, cleared to 5,000.',
          hint: () => ring('SKY412'),
          done: (g, ev) => said(ev, 'SKY412', 'alt', c => c.ft === 5000),
        },
        {
          text: 'Wait for it to level at 5,000 ft',
          coach: 'An A320 comes down at about 1,800 feet a minute, so 3,000 feet takes nearly two minutes. Plan descents early: you can’t hurry them. Press ×2 at the top if you’d rather not wait.',
          praise: 'Level at 5,000.',
          done: g => { const a = g.find('SKY412'); return !!a && Math.abs(a.alt - 5000) < 10; },
        },
        {
          text: 'Climb PUF27 to 6,000 ft',
          coach: 'Climbs work the same way: SKY412 C60, or the dial. Puffin 27 is at 5,000.',
          done: (g, ev) => said(ev, 'PUF27', 'alt', c => c.ft === 6000),
        },
        {
          text: 'Descend SKY412 to 3,000 ft',
          coach: 'Notice the two never needed turning: with Puffin at 6,000 and Skylark at 5,000 and below, 1,000 feet keeps them apart. That’s the next lesson.',
          praise: 'Good. A few questions.',
          done: (g, ev) => said(ev, 'SKY412', 'alt', c => c.ft === 3000),
        },
      ],
      quiz: [
        { q: 'A tag reads 070↓050. It’s cleared to…', options: ['7,000 ft', '5,000 ft', 'Flight level 50'], answer: 1 },
        { q: 'Coming down at 1,500 ft a minute, 3,000 ft takes about…', options: ['20 seconds', '2 minutes', '10 minutes'], answer: 1 },
        { q: 'Above 6,000 ft here, levels are given as…', options: ['Flight levels: FL80', 'Thousands of feet', 'Metres'], answer: 0 },
      ],
    },
    {
      id: 4, title: 'Separation',
      learn: '3 miles or 1,000 feet, the conflict alert, fixing one early',
      intro: 'Keep every pair at least 3 miles apart, or 1,000 feet apart. The conflict alert warns you about a minute ahead; the best controllers fix it before then.',
      setup(g) {
        g.spawn({ cs: 'SKY412', type: 'A320', x: 30, y: 9, hdg: 270, alt: 6000, ias: 230 });
        g.spawn({ cs: 'MDW6', type: 'DH8D', x: 12, y: 9.3, hdg: 90, alt: 6000, ias: 220 });
      },
      fail(g, ev) {
        if (ev && ev.kind === 'los') return 'They came within 3 miles and 1,000 feet: a loss of separation. Act as soon as the alert shows, or before.';
        return left(g, ev);
      },
      tasks: [
        {
          text: 'Watch SKY412 and MDW6: same level, nose to nose',
          coach: 'Skylark 412 and Meadow 6 are both at 6,000 feet, heading straight for each other. Wait: in a moment the system will predict they’ll come within 3 miles and 1,000 feet in the next minute, and alert.',
          hint: () => ring('MDW6').concat(ring('SKY412')),
          done: (g, ev) => is(ev, 'stca') || (g.taskTime > 40 && !g.sim.conflicts.length),
        },
        {
          text: 'Fix it: turn one away, or put 1,000 ft between them',
          coach: 'There: red rings and red tags. You have about a minute. Turn one of them 30 degrees or more away, or climb or descend one by 1,000 feet. Vertical is quick to give, but descending 1,000 feet takes over half a minute.',
          done: g => !g.sim.conflicts.length && g.instructed,
        },
        {
          text: 'Keep them apart until they’ve passed',
          coach: 'The alert’s gone, so the prediction says they’ll stay apart. Keep watching until they’re past each other.',
          praise: 'Passed, and never closer than the minimum. That’s the whole job.',
          // Passed: the gap between them is opening, and nothing's predicted.
          done: g => {
            const a = g.find('SKY412'), b = g.find('MDW6');
            if (!a || !b) return true;
            const d = Math.hypot(a.x - b.x, a.y - b.y), before = g.memo.gap;
            g.memo.gap = d;
            return before != null && d > before + 1e-4 && d > 3 && !g.sim.conflicts.length && g.taskTime > 3;
          },
        },
      ],
      quiz: [
        { q: 'Two aircraft 2 miles apart, one at 5,000 ft and one at 4,000 ft. Separated?', options: ['Yes: 1,000 ft is enough', 'No: they’re under 3 miles'], answer: 0 },
        { q: 'The conflict alert looks ahead about…', options: ['10 seconds', 'A minute', '10 minutes'], answer: 1 },
        { q: 'The best time to fix a conflict is…', options: ['Before the alert', 'When the alert sounds', 'When the rings touch'], answer: 0 },
      ],
    },
    {
      id: 5, title: 'Intercepting the ILS',
      learn: '30°, below the glideslope, cleared for the approach',
      intro: 'Bring an aircraft onto the localiser at a gentle angle, below the glideslope, clear it for the approach and hand it to the tower.',
      setup(g) {
        g.spawn({ cs: 'SKY412', type: 'A320', x: 22, y: -9, hdg: 360, alt: 5000, ias: 220 });
      },
      fail(g, ev) {
        if (ev && ev.kind === 'missed') return 'It got inside 4 miles still on your frequency: the tower never heard of it. Hand over by 8 miles.';
        return left(g, ev);
      },
      tasks: [
        {
          text: 'Descend SKY412 to 3,000 ft',
          coach: 'Skylark 412 is on a base leg, heading north. The glideslope comes down 300 feet a mile: at 10 miles out it’s at about 3,200 feet. At 3,000 feet you’ll meet the localiser below it, which is what the autopilot needs.',
          hint: () => ring('SKY412'),
          done: (g, ev) => said(ev, 'SKY412', 'alt', c => c.ft <= 3500),
        },
        {
          text: 'Turn it left heading 300, to cut the localiser at 30°',
          coach: 'The final approach course is 270. A cut of 30 degrees or less, so 300 at most from this side, and it will turn onto the localiser by itself. Any steeper and it flies straight through.',
          hint: () => [{ kind: 'heading', cs: 'SKY412', hdg: 300 }],
          done: (g, ev) => said(ev, 'SKY412', 'hdg', c => c.hdg >= 270 && c.hdg <= 300),
        },
        {
          text: 'Clear it for the ILS',
          coach: 'Now clear it: Cleared ILS on the dial, or SKY412 ILS. Real controllers say it with the heading: “turn left heading 300, cleared ILS runway 27”.',
          done: (g, ev) => said(ev, 'SKY412', 'ils') || (g.find('SKY412') || {}).ils,
        },
        {
          text: 'Wait for it to establish on the localiser',
          coach: 'Watch the tag: ILS means cleared and waiting; LOC means it has captured the localiser. It’ll start down the glideslope by itself when it meets it.',
          praise: 'Established. It’s flying the approach itself now.',
          done: (g, ev) => is(ev, 'established', 'SKY412') || !!(g.find('SKY412') || {}).loc,
        },
        {
          text: 'Hand it to the tower before 8 miles',
          coach: 'Contact tower on the dial, or SKY412 TWR. The tower lands it; you’re free for the next one. The tick marks on the centreline count the miles.',
          done: (g, ev) => is(ev, 'handoff', 'SKY412') || (g.find('SKY412') || {}).freq === 'tower',
          praiseFor: (g, ev) => (ev && ev.on === 'late' ? 'A little late: by 8 miles next time, so the tower has time to plan.' : 'Right on time.'),
        },
        {
          text: 'Watch it land',
          coach: 'Nothing to do. A neat 30-degree cut, below the glideslope, handed off in good time: that’s a final vector.',
          praise: 'Down. That’s the job, start to finish.',
          done: (g, ev) => is(ev, 'landed', 'SKY412') || (g.find('SKY412') || {}).state === 'landed' || !g.find('SKY412'),
        },
      ],
      quiz: [
        { q: 'The steepest cut onto the localiser is…', options: ['30°', '45°', '90°'], answer: 0 },
        { q: 'Meeting the localiser, the aircraft should be…', options: ['Above the glideslope', 'Below the glideslope', 'It doesn’t matter'], answer: 1 },
        { q: 'Hand over to the tower by about…', options: ['8 miles out', '2 miles out', 'The runway'], answer: 0 },
      ],
    },
  ];

  FV.LESSONS = LESSONS;
})(window);
