use crate::html::escape;

/// `root` is "" for the home page and "../" for an engine page.
pub fn page(title: &str, root: &str, first_engine: &str, body: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>{title}</title>
<link rel="stylesheet" href="{root}static/palette.css">
<link rel="stylesheet" href="{root}static/base.css">
</head>
<body>
<header class="hd">
  <div class="wrap">
    <a class="brand" href="{root}index.html"><span class="logo" aria-hidden="true">K</span>Kalsa</a>
    <nav class="nav" aria-label="Main">
      <a href="{root}index.html">Home</a>
      <a href="{root}{first_engine}">Engines</a>
    </nav>
  </div>
</header>
<main class="wrap">
{body}
</main>
<footer class="wrap" style="padding:32px 24px;color:var(--ink2);font-size:13.5px">
  Kalsa is not affiliated with the authors of the listed projects.
</footer>
</body>
</html>
"#,
        title = escape(title),
        root = root,
        first_engine = escape(first_engine),
        body = body,
    )
}
