# Dashcam Bingo: logo guidelines

## 1. The logo
- **Idea:** the dashcam's frame locks onto your winning line. Two camera-frame corners say *dashcam*, and a 3 Ã— 3 card with its diagonal marked in green says *bingo*.
- **Versions:**
  - **Horizontal lockup:** symbol beside the name. This is the main version; use it in headers, banners and the site's top bar.
  - **Stacked:** symbol above the name, for square spaces like stickers, shirts and posters.
  - **Symbol:** on its own, for avatars and icons.
  - **Wordmark:** the name on its own.
- **Light and dark:** every version comes in two:
  - the plain file, with a charcoal frame, for light backgrounds
  - `-on-dark`, with a white frame, for dark backgrounds
- **Two sizes of symbol:**
  - `symbol`, with its six small dots, for **40 px and up**
  - `symbol-small`, with heavier corners and no dots, for **32 px and below**. The favicon and web icons already use it.

## 2. Clear space
Keep empty space around the logo at least **one green square wide** on every side. That's the width of one of the three green squares at whatever size you're using the logo, so the space scales with it.

## 3. Minimum size
| Version | Screen | Print |
|---|---|---|
| Horizontal lockup | 180 px wide | 40 mm wide |
| Stacked | 120 px wide | 25 mm wide |
| Symbol (full) | 40 px | 10 mm |
| Symbol (small cut) | 16 px | 5 mm |

## 4. Colour
| Name | Use | HEX | RGB | CMYK (approx.) |
|---|---|---|---|---|
| **Bingo Green** | the winning line | `#22C55E` | 34 197 94 | 83 0 52 23 |
| **Charcoal** | frame, dots and name on light backgrounds; icon tiles | `#111418` | 17 20 24 | 29 17 0 91 |
| **White** | frame, dots and name on dark backgrounds | `#FFFFFF` | 255 255 255 | 0 0 0 0 |

Bingo Green is also the site's default square colour, so the logo and the game share one signal colour. The CMYK values are straight conversions. For printing, ask the printer to match the HEX values with their colour profile, or match Bingo Green from a Pantone swatch book.

**Approved pairs**
- Full colour (charcoal frame) on white or light grey.
- Full colour `-on-dark` (white frame) on Charcoal, black or the site's dark theme.
- One-colour **white** on Bingo Green, on photos (on a calm area), or on any mid or dark colour.
- One-colour **black** or **Charcoal** on light colours, including Bingo Green.

**Avoid:** the full-colour logo on a green background (the green squares disappear), and the charcoal-frame version on dark backgrounds (the frame disappears).

## 5. Typography
- **Wordmark:** Plus Jakarta Sans ExtraBold (800) with âˆ’2 % letter spacing. In the logo files it's converted to outlines, so it looks the same everywhere and needs no font installed.
- **Site and other text:** Plus Jakarta Sans 400â€“800, falling back to `system-ui, sans-serif`.
- **Licence:** SIL Open Font License. It's free to use, including in logos (see `source/fonts/OFL.txt`).

## 6. Don'ts
- Don't stretch, squash, rotate or tilt the logo.
- Don't recolour it outside the palette, or change which squares are green.
- Don't add shadows, outlines, glows or gradients.
- Don't move or resize the symbol and the name separately in a lockup. Use the files as they are.
- Don't type "Dashcam Bingo" next to the symbol to make a lockup. Use the supplied lockup files.
- Don't use the full symbol (with dots) below 40 px. Use `symbol-small` instead.

## 7. Files
| Folder | What's in it |
|---|---|
| `logo/` | SVG masters: symbol, symbol-small, horizontal, stacked and wordmark, each light and `-on-dark`, plus `app-icon` (rounded tile) and `avatar` (square tile, safe for Discord's circle crop) |
| `logo/one-colour/` | Every version in all-black, all-white and all Bingo Green |
| `png/` | Large transparent PNGs: symbol and horizontal (light and dark), app icon, and a 512 px Discord server icon |
| `web/` | `favicon.ico`, `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest`, and `head-snippet.html` (the lines to paste into a page's `<head>`) |
| `presentation/` | The presentation board (`dashcam-bingo-logo.html`) and its slides as PNGs |

Questions about using the logo: the Dashcam Bingo owner. Master files: this kit.
