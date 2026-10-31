# Picnic Raid — art brief

The cards are meant to be **painted pictures**, not drawings made in code.
The game already shows them: drop a file in `static/picnic/cards/` and every
card with that name uses it straight away. Cards with no picture yet show a
plain coloured placeholder, so the art can arrive a few cards at a time.

## How the files work

- **Folder:** `static/picnic/cards/`
- **Name:** the card's code (below), lower case: `ants.webp`, `s3.webp`, `back.webp`.
- **Type:** `.webp` preferred (small, sharp); `.png` or `.jpg` also work.
- **Shape:** portrait **5 : 7** — paint at **1000 × 1400 px**, export at
  **750 × 1050 px**. The picture fills the whole card; the app rounds the
  corners itself, so keep anything important about 4% in from every edge.
- **Words on the card:** paint them in. Louis reads, so each card should say
  what it is ("Ants", "Shoo!") in big friendly letters, and food cards need
  their number large in the top-left corner.
- **Food shortcut:** one picture per kind (`s.webp` for all sandwiches) also
  works — the app lays the number over the top-left corner. Separate pictures
  per size (`s1`, `s2`, `s3` showing one, two, three sandwiches) are nicer, and
  win when both exist.

## The look

A sunny summer picnic in a meadow, seen by a seven-year-old. Warm, bright,
storybook-flat with soft painted texture: think gouache or coloured pencil, not
glossy 3D or photo-real. Chunky shapes that read at thumbnail size (cards are
shown as small as 38 px wide on a phone). A cream border round every face, the
same on every card, with the card's colour as a band inside it.

The traps are **cheeky, never scary**: the ants march in a determined line
carrying crumbs, the wasp is buzzing about looking pleased with itself, the
seagull has a smug sideways look, the dog is a happy spaniel mid-gobble.
Defences are heroic: Shoo! is a big waving tea towel, the Umbrella a red
umbrella with rain bouncing off it.

It must be **our own art**. Not in the style of any published card game, and
no characters or logos from anywhere else.

## Every picture

| File | Card | What to paint | Card colour |
|---|---|---|---|
| `s1.` `s2.` `s3.` | Sandwiches 1–3 | 1, 2, 3 triangle sandwiches on a plate | mustard yellow |
| `b1.` `b2.` `b3.` | Strawberries 1–3 | 1, 2, 3 strawberries (3 = a little punnet) | strawberry red |
| `c1.` `c2.` `c3.` | Cupcakes 1–3 | 1, 2, 3 iced cupcakes with sprinkles | pink |
| `l1.` `l2.` `l3.` | Lemonade 1–3 | a glass, two glasses, a jug and glasses | lemon yellow |
| `h1.` `h2.` `h3.` | Cheese 1–3 | a wedge, two wedges, a cheeseboard | orange |
| `ants.` | Ants | a line of ants carrying snacks off over the grass | brown |
| `wasp.` | Wasp | a wasp chasing a cupcake away | yellow and black |
| `gull.` | Seagull | a seagull swooping off with a sandwich | sky grey-blue |
| `dog.` | Dog | a dog with its head in a picnic basket | russet |
| `shoo.` | Shoo! | a hand flapping a tea towel, "SHOO!" in big letters | mint green |
| `umbrella.` | Umbrella | a red umbrella, rain bouncing off it | blue |
| `back.` | The back of every card | red-and-white gingham with a little basket badge | red |

Or, instead of the fifteen food pictures, five: `s.` `b.` `c.` `l.` `h.`

That's **22 pictures** (or 12 with the food shortcut).

## Getting it made

Any of these work, as long as we own the result:

- **An illustrator.** Hand them this page. 22 small pieces in one style is a
  normal-sized commission; ask for the layered source files too.
- **Drawing them yourselves**, on paper or an iPad, then photographing or
  exporting them to the sizes above. A family deck drawn by the family is
  quite a thing to play with.
- **An image generator** (Midjourney, Adobe Firefly, Gemini, ChatGPT…). Keep
  one style sentence and add each card's line from the table, for example:

  > A children's storybook illustration in flat gouache with soft texture,
  > bright summer colours, chunky readable shapes, a cream card border with a
  > brown inner band, portrait 5:7 playing card. **A line of cheeky ants
  > marching over the grass carrying crumbs and a strawberry. The word "Ants"
  > in big friendly letters at the bottom.**

  Generate the back first and reuse it as a reference image for the rest, so
  the border and colours match. Check the service's terms let you use the
  pictures yourselves; most do for personal use.

When pictures arrive, check one on a phone at the smallest size (the basket
row on the table) before doing the rest: if you can't tell a cupcake from a
cheese at 38 px wide, the shapes need to be bolder.
