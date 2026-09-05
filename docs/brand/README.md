# Brand files

The app's wordmark as drawn by the top bar: Bricolage Grotesque 800 with the amber-to-teal gradient from the stylesheet. Rendered at 1024x1024 for places that need a raster, such as the GitHub OAuth App logo.

| File | Use |
|---|---|
| `tandem-logo-light.png` / `-dark.png` | Wordmark on the app's light or dark ground |
| `tandem-monogram-light.png` / `-dark.png` | Single-letter square for small icons |

The `.html` files are the sources. Regenerate with headless Chrome:

```
chrome --headless=new --window-size=1024,1024 --virtual-time-budget=8000 --screenshot=out.png file:///.../tandem-logo-light.html
```
