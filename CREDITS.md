# Credits

This file lists third-party assets used by DreamBike and where they come from.
So far it covers the fonts. Dependencies, photos and other assets are added
before submission.

## Fonts

The estimate PDF embeds these font files from `public/fonts/`. They are
unmodified copies from the official IBM Plex releases. The PDF embeds only the
glyphs it uses (a subset).

| File | Family and version | Source |
| --- | --- | --- |
| `IBMPlexSans-Regular.ttf` | IBM Plex Sans 3.005, package `@ibm/plex-sans` 1.1.0 | https://github.com/IBM/plex/releases/tag/%40ibm%2Fplex-sans%401.1.0 |
| `IBMPlexSans-SemiBold.ttf` | IBM Plex Sans SemiBold 3.005, package `@ibm/plex-sans` 1.1.0 | same release |
| `IBMPlexMono-Regular.ttf` | IBM Plex Mono 2.005, package `@ibm/plex-mono` 2.5.0 | https://github.com/IBM/plex/releases/tag/%40ibm%2Fplex-mono%402.5.0 |

Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". Licensed under the
SIL Open Font License, Version 1.1. The full license text is in
`public/fonts/OFL.txt`, copied unchanged from the release archives.

The app's screen fonts are the same IBM Plex families, loaded at build time
through `next/font/google` under the same license.
