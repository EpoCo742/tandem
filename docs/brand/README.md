# Brand files

The mark as the app draws it: four threads on the left, the cloth they become on the right. Several people's contributions going in, one agreed design coming out. The name is set lowercase in Bricolage Grotesque 800, with `arch` in ink and `loom` in the amber accent, because arch is the domain and loom is the part that does the work. There is no tagline. Rendered at 1024x1024 for places that need a raster, such as the GitHub OAuth App logo.

| File | Use |
|---|---|
| `archloom-logo-light.png` / `-dark.png` | Mark and name on the app's light or dark ground |
| `archloom-mark-light.png` / `-dark.png` | The mark alone, square, for small icons |
| `archloom-logo-transparent.png` | Mark and name with a transparent background (RGBA), neutral ink so it reads on either ground |
| `archloom-mark-transparent.png` | The mark alone with a transparent background (RGBA) |

The in-app version of the mark is `web/src/components/Brand.tsx`, the browser tab icon is the same drawing inlined in `web/index.html`, and the social image for published pages redraws it in `server/src/routes/library.ts`. Change all four together.

The `.html` files are the sources. Regenerate with headless Chrome (it refuses to write into some directories; render to a temporary path and copy the files in):

```
chrome --headless=new --window-size=1024,1024 --virtual-time-budget=8000 --screenshot=out.png file:///.../archloom-logo-light.html
chrome --headless=new --window-size=1024,1024 --virtual-time-budget=8000 --default-background-color=00000000 --screenshot=out.png file:///.../archloom-logo-transparent.html
```
