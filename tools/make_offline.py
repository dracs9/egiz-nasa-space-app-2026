"""Package the built app with a portable local launcher. AI assistance: Codex; review pending."""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    source = ROOT / "web/dist"
    if not (source / "index.html").is_file():
        raise SystemExit("Build the web app before packaging it: make web")
    output = ROOT / "artifacts/egiz-offline"
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(source, output / "app")
    (output / "serve.py").write_text(
        '"""Start Egiz locally; no internet is required for data or app assets."""\n'
        "from functools import partial\nfrom http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer\n"
        "from pathlib import Path\nimport webbrowser\n"
        "import argparse\n"
        "parser = argparse.ArgumentParser(description='Serve the local Egiz bundle')\n"
        "parser.add_argument('--no-network', action='store_true')\n"
        "parser.add_argument('--no-browser', action='store_true')\n"
        "parser.add_argument('--port', type=int, default=4173)\n"
        "args = parser.parse_args()\n"
        "directory = Path(__file__).resolve().parent / 'app'\n"
        "class OfflineHandler(SimpleHTTPRequestHandler):\n"
        "    def end_headers(self):\n"
        "        if args.no_network:\n"
        "            self.send_header('Content-Security-Policy', \"default-src 'self' data: blob:; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' blob:; font-src 'self'\")\n"
        "        super().end_headers()\n"
        "handler = partial(OfflineHandler, directory=str(directory))\n"
        "server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)\n"
        "url = f'http://127.0.0.1:{args.port}'\n"
        "print(f'Egiz: {url} — Ctrl+C to stop', flush=True)\n"
        "if not args.no_browser:\n    webbrowser.open(url)\nserver.serve_forever()\n")
    (output / "README.txt").write_text(
        "Egiz offline demo\n\nRun: python3 serve.py\nThen open http://127.0.0.1:4173\n"
        "Keep app/ beside serve.py. Do not open index.html directly (browser fetch security).\n"
        "Map imagery needs internet; the local map/table and all mission data work without it.\n"
        "To verify independence from remote assets, run python3 serve.py --no-network.\n"
        "Choose Data source: Synthetic demo or Measured terrain pilot. Both are bundled separately.\n"
        "Measured pilot: nine Earth windows, two targets, incomplete environment; unvalidated.\n"
        "Mission Lab includes measured 200 m terrain, deterministic simulations, replay and exports.\n"
        "Native Engineering Lab includes authentic recorded MuJoCo/Basilisk results and a measured 10 m lunar atlas.\n"
        "New native runs require the separate optional Python service; no solver is silently substituted.\n"
        "Shared URLs include the data mode. No source is silently substituted.\n"
        "If the synthetic banner is present, every displayed measurement is invented test data.\n")
    archive = shutil.make_archive(str(ROOT / "artifacts/egiz-offline"), "zip", output)
    print(f"Offline directory: {output}\nArchive: {archive}")


if __name__ == "__main__":
    main()
