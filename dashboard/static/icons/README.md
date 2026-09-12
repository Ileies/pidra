# Icons

`icon.svg` is the source. It is the header logo, the favicon and the origin of every PNG here,
so the installed app, the browser tab and the dashboard header are visibly one thing. Editing it
means regenerating the PNGs: nothing does that automatically, and a stale PNG shows up only on
an Android install prompt, which is the last place anyone looks.

The PNGs exist because Android needs raster icons for the install prompt and the splash screen,
and needs a maskable variant so the launcher can crop to whatever shape the device uses.

```fish
nix shell nixpkgs#librsvg
# `any`: the artwork at 0.92 of the canvas, on the app background
rsvg-convert -w 192 -h 192 -b '#111214' icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 -b '#111214' icon.svg -o icon-512.png
# `maskable`: 0.66, so the safe zone survives a circular or squircle crop
rsvg-convert -w 338 -h 338 -b '#111214' icon.svg -o /tmp/mask-inner.png
# then centre that on a 512x512 #111214 canvas as icon-maskable-512.png
```

`rsvg-convert` is a one-off tool, deliberately not a project dependency: it runs by hand on the
rare occasion the logo changes.
