"""Packs the readable frontend (index.html + style.css + js + data) into ONE html file you can email or double-click.
  python make_single_file.py            -> ../Worker_Fatigue_Monitor_single_file.html
"""
import os, re
H = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(os.path.join(H, p), encoding="utf8").read()
html = rd("index.html")
html, n = re.subn(r'<link\s+rel="stylesheet"\s+href="style.css"\s*/?>', lambda m: "<style>\n" + rd("style.css") + "\n</style>", html)
assert n == 1, "style.css link not found in index.html"
html = re.sub(r'<script src="([^"]+)"></script>', lambda m: "<script>\n" + rd(m.group(1)).replace("</script", "<\\/script") + "\n</script>", html)
out = os.path.join(H, "..", "Worker_Fatigue_Monitor_single_file.html")
open(out, "w", encoding="utf8").write(html); print(out, round(len(html) / 1e6, 1), "MB")
