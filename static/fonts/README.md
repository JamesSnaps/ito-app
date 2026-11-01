# Bundled fonts

Self-hosted rather than linked from Google's CDN so the app works on a LAN
with no internet, and so no player's browser calls out to a third party
mid-game. Latin subsets only.

| File | Family | Used by | Licence |
|---|---|---|---|
| `bricolage-grotesque-latin-wght.woff2` | **Bricolage Grotesque** (96pt optical size), weights 200–800 | the whole hub (`--font-display`) | SIL OFL 1.1, `BricolageGrotesque-OFL.txt` |
| `bebas-neue-latin.woff2` | **Bebas Neue** 400 | Fugitive: title, card numbers, nameplates | SIL OFL 1.1, `BebasNeue-OFL.txt` |
| `special-elite-latin.woff2` | **Special Elite** 400 | Fugitive: case tags, notes, stamps | Apache 2.0, `SpecialElite-LICENSE.txt` (© 2010 Brian J. Bonislawsky, Astigmatic) |
| `caveat-variable-latin.woff2` | **Caveat**, weights 400–700 | Fugitive: the Marshal's notepad | SIL OFL 1.1, `Caveat-OFL.txt` |

All four come from the Fontsource packages on npm
(`@fontsource-variable/bricolage-grotesque`, `@fontsource/bebas-neue`,
`@fontsource/special-elite`, `@fontsource-variable/caveat`, v5.3.0), which repackage the Google Fonts
releases.
