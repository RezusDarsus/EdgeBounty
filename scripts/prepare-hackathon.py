"""Prepare attributed NASA photographs and two small ONNX demo models.

Run with the project's Python environment, then `npx tsx scripts/hackathon-demo.ts`.
No generated images or claims of proprietary NASA content are introduced.
"""
import importlib.util
import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".data" / "hackathon"
OUT.mkdir(parents=True, exist_ok=True)
IDS = ["KSC-07PD-2256", "08pd1567", "KSC-07PD-2949", "08pd1568", "KSC-07PD-3159"]
sources = []
for index, nasa_id in enumerate(IDS, 1):
    endpoint = "https://images-api.nasa.gov/search?nasa_id=" + urllib.parse.quote(nasa_id)
    with urllib.request.urlopen(endpoint, timeout=60) as response:
        result = json.load(response)
    item = next(i for i in result["collection"]["items"] if i["data"][0]["nasa_id"] == nasa_id)
    data = item["data"][0]
    image = item["links"][0]["href"]
    filename = f"photo-{index}.jpg"
    with urllib.request.urlopen(image, timeout=60) as response:
        (OUT / filename).write_bytes(response.read())
    sources.append({"id": nasa_id, "title": data["title"], "credit": data.get("photographer") or data.get("secondary_creator") or "NASA", "source": f"https://images.nasa.gov/details/{nasa_id}", "image": image, "file": filename})
(OUT / "sources.json").write_text(json.dumps(sources, indent=2), encoding="utf-8")
spec = importlib.util.spec_from_file_location("demo_models", ROOT / "services/model-validator/fixtures.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
fixtures.red_blue_model(OUT / "fixtures/model/red_blue.onnx")
fixtures.red_blue_model(OUT / "fixtures/model/color_baseline.onnx", accuracy_bias=0.05)
print("Prepared five source photographs and two ONNX color classifiers under .data/hackathon")
