# Profile SVG generator

Builds every image in the profile README (`../assets/*.svg`), light and dark: the hello chat, the generated "Now" card, the case study chip, the closing bubble and the contact pills. Each is set in Geist (subset and embedded), sized to its text and animated.

## Change something

1. Edit the copy in `gen.mjs`: the hello bubbles in `hero()`, the card rows in `now()`, the closing bubble in `closing()`, the buttons in `PILLS`.
2. Build:

   ```sh
   npm install
   npx playwright-core install chromium-headless-shell   # once; or set CHROME_PATH to a Chrome you have
   npm run build
   ```

3. Bump `?v=` on the changed images in `../README.md`, or GitHub may keep showing the cached ones.

## Source

- `source/geist-latin.woff2`: Geist (latin, variable), SIL Open Font License, by Vercel.
- `source/avatar.png`, `source/logos/`: from requixite.my.id.
