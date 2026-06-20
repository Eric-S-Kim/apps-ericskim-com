# Eric's Apps — Personal App Store

A PWA (Progressive Web App) that acts as Eric's personal app store. Lives at
`https://Eric-S-Kim.github.io/apps-ericskim-com/` and is installable on Android
via Chrome's "Add to Home Screen."

## Structure

```
/
├── index.html              # Store landing page (this is what installs as a PWA)
├── manifest.json           # PWA manifest
├── icon-any-{192,512}.png  # Standard icons
├── icon-maskable-{192,512}.png  # Adaptive icons for Android
└── apps/                   # Individual app subfolders (added one at a time)
```

## Adding a new app

Each app lives in its own subfolder under `apps/<slug>/` with its own
`index.html`, `manifest.json`, and icons. Add a card to the grid in
`index.html` linking to the app's subfolder.

## Brand

- Primary: `#0b2e15` (dark green)
- Background: `#f7f4ee` (warm beige)
- Font: Geist (sans) + Newsreader (serif italic)
- Source: ericskim.com brand identity
