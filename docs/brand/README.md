# Brand files

The app's mark and name as the top bar draws them: a round meeting seen from above, four seats around it, the seat on the right in amber for the AI. The name is set in Bricolage Grotesque 800 with the amber-to-teal gradient from the stylesheet. Rendered at 1024x1024 for places that need a raster, such as the GitHub OAuth App logo.

| File | Use |
|---|---|
| `session-zero-logo-light.png` / `-dark.png` | Mark and name on the app's light or dark ground |
| `session-zero-mark-light.png` / `-dark.png` | The mark alone, square, for small icons |
| `session-zero-logo-transparent.png` | Mark and name with a transparent background (RGBA), neutral ring so it reads on either ground |
| `session-zero-mark-transparent.png` | The mark alone with a transparent background (RGBA) |

The in-app version of the mark is `web/src/components/Brand.tsx`, and the browser tab icon is the same drawing inlined in `web/index.html`; change all three together.

The `.html` files are the sources. Regenerate with headless Chrome (it refuses to write into some directories; render to a temporary path and copy the files in):

```
chrome --headless=new --window-size=1024,1024 --virtual-time-budget=8000 --screenshot=out.png file:///.../session-zero-logo-light.html
chrome --headless=new --window-size=1024,1024 --virtual-time-budget=8000 --default-background-color=00000000 --screenshot=out.png file:///.../session-zero-logo-transparent.html
```
