# Angelico by Mhd Al Sousi

Luxury menswear storefront. Static site, no build step.

## Run

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

A server is needed (not `file://`) once the video frame sequence is enabled.

## Structure

```
index.html            page skeleton, filled from content/site.json
content/site.json     ALL editable content (the admin edits this file)
css/style.css         design tokens (from the logo navy #2A3A4A) and layout
js/content.js         loads content/site.json and renders the page
js/main.js            GSAP + ScrollTrigger + Lenis animations, shop logic
admin/                the admin dashboard and CMS (no server needed)
assets/brand/         logo extracted from the original artwork (transparent PNG)
assets/products/      product photos (WebP, 900x1125)
assets/sequence/      Kling video frames (generated, see KLING.md)
scripts/extract-frames.sh   video to scroll frames
```

## Motion map

| Section | Effect |
|---|---|
| Loader | Logo mark wipe, counter, curtain lift |
| Hero (600vh pinned) | Man is dressed as you scroll: shirt, tie, jacket, finish, then logo reveal |
| Manifesto | Word by word scrubbed reveal |
| Marquee | Infinite, speeds up with scroll velocity |
| Collections | Pinned horizontal scroll gallery |
| Atelier | Counters, sticky stacking process cards |
| Shop | Filter transitions, 3D tilt, add to bag |
| Quote | Rotating parallax logo watermark |

Respects `prefers-reduced-motion`. Works without JavaScript CDNs (static fallback).

## Hero video

The hero ships with an animated illustration. Swap in a Kling AI video of a
man putting on his suit by following `KLING.md`.

## Placeholder content

Product names, prices (USD), atelier statistics and the appointment form
are placeholders. The form does not submit anywhere yet.

## Admin dashboard (CMS)

Open `/admin/` on the live site, for example `https://waleed178-del.github.io/angelico/admin/`.

It edits everything: products (add, edit, hide, mark sold out, reorder, duplicate,
delete), Wardrobe collections, hero text, manifesto, scrolling words, atelier
numbers and steps, quote, appointment form options, navigation, footer, logos,
currency, colors, and the image library.

### How it saves
GitHub Pages has no server, so the admin saves by committing to this repository
through the GitHub API. Press **Publish** and `content/site.json` (and any
uploaded images) are committed to the branch GitHub Pages deploys, normally
`gh-pages`. The live site updates in a minute or two. Every publish is a git
commit, so any version can be restored from the dashboard.

### Signing in
1. GitHub, Settings, Developer settings, Fine-grained tokens, Generate new token.
2. Repository access: only this repository.
3. Permissions: Contents Read and write. Optionally Pages Read-only for deploy status.
4. Paste the token on the admin sign-in screen. Leave "Remember me" off on shared computers.

Only people GitHub lets write to the repository can publish. The `/admin/` page
itself is public but does nothing without a valid token.

### Drafts and preview
Edits are saved as a draft in your browser until you publish. **Preview draft**
opens the real site showing your draft. **Discard changes** returns to the live version.

### Notes
* The hero has exactly four dressing steps, matching the animation.
* A product category only appears as a filter when a visible product uses it.
* Appointment requests need a contact email or a form endpoint (Settings).

## Arabic and English

The site ships in English and Arabic. A language button in the top bar switches
between them and remembers the visitor's choice. Arabic switches the whole page
to right-to-left, including the hero, the sideways gallery and the layout.

* Every text field in `content/site.json` is either a plain string (English) or
  `{ "en": "...", "ar": "..." }`. Prices, images, links and colors are shared.
* In `/admin/`, use the **EN / عربي** toggle in the top bar to choose which
  language you are editing. The English text is shown under each Arabic field.
  The dashboard shows how much is translated, and the product and collection
  lists flag items that need Arabic.
* Settings has a Languages card (turn Arabic on or off, pick the default) and an
  Interface words card for small labels such as the bag button and form messages.
* Arabic fonts (Amiri and Tajawal) load from Google Fonts only on the Arabic page.
* `?lang=ar` or `?lang=en` forces a language, for example in a link.
