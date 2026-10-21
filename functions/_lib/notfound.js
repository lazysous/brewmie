// Small inline 404 page, same palette as public/landing.html (warm light, dark variant by preference).
export const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Page not found | Brewmie</title>
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
  :root { --bg: #FAF7F2; --fg: #3D3529; --accent: #B8744A; --muted: #7A6F5F; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1E1A16; --fg: #EFE8DC; --accent: #D9966B; --muted: #A89C8A; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--fg);
         min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; }
  main { max-width: 420px; }
  h1 { font-family: 'Cormorant Garamond', serif; font-size: 42px; font-weight: 600; margin-bottom: 12px; }
  p { color: var(--muted); line-height: 1.5; margin-bottom: 24px; }
  a { color: var(--accent); font-weight: 600; text-decoration: none; }
  a:hover, a:focus { text-decoration: underline; }
</style>
</head>
<body>
<main>
  <h1>Page not found</h1>
  <p>That page does not exist. It may have moved, or the link is mistyped.</p>
  <p><a href="/">Back to Brewmie</a></p>
</main>
</body>
</html>
`
