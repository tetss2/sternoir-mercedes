"""Reproducible mobile derivatives of the existing STERNOIR photographs."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps
from fontTools.ttLib import TTFont
import base64, io, json, tarfile

root = Path(__file__).resolve().parents[1]
assets = root / 'public/assets'
target = assets / 'mobile-v1'
target.mkdir(exist_ok=True)

def optimize(path):
    name = str(path.relative_to(assets))
    with Image.open(path) as source:
        source = ImageOps.exif_transpose(source).convert('RGB')
        w, h = source.size
        image = source.copy()
        image.thumbnail((768, 1200), Image.Resampling.LANCZOS)
        output = target / name
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, 'WEBP', quality=68, method=6)
        tiny = source.copy()
        tiny.thumbnail((24, 24), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        tiny.save(buffer, 'WEBP', quality=30, method=4)
        return name, {'width': w, 'height': h, 'placeholder': base64.b64encode(buffer.getvalue()).decode(), 'bytes': output.stat().st_size, 'originalBytes': path.stat().st_size}

files = [p for p in assets.rglob('*.webp') if 'mobile-v1' not in p.parts]
with ThreadPoolExecutor(max_workers=6) as pool:
    manifest = dict(pool.map(optimize, files))
(root / 'public/image-info.js').write_text('export const imageInfo = ' + json.dumps(manifest, separators=(',', ':')) + ';\n')
for path in (assets / 'fonts').glob('new-*.woff'):
    font = TTFont(path)
    font.flavor = 'woff2'
    font.save(path.with_suffix('.woff2'))
with tarfile.open(assets / 'mobile-v1.tar.gz', 'w:gz') as archive:
    archive.add(target, arcname='mobile-v1')
print(json.dumps({'images': len(files), 'originalBytes': sum(m['originalBytes'] for m in manifest.values()), 'mobileBytes': sum(m['bytes'] for m in manifest.values()), 'archiveBytes': (assets / 'mobile-v1.tar.gz').stat().st_size}))
