#!/usr/bin/env python3
"""Stage exactly the approved final movie, poster, captions and hosting files."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--video', type=Path, required=True)
parser.add_argument('--poster', type=Path, required=True)
parser.add_argument('--captions', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True, help='A new, private build directory outside the source repository')
args = parser.parse_args()
source = Path(__file__).resolve().parent
output = args.output.expanduser().resolve()
repo = source.parents[2]
if output == repo or repo in output.parents:
    parser.error('Keep generated media/build output outside the source repository.')
video, poster, captions = (p.expanduser().resolve(strict=True) for p in (args.video, args.poster, args.captions))
if not 0 < video.stat().st_size <= 128 * 1024 * 1024:
    parser.error('The final MP4 must be nonempty and at most 128 MiB for this bounded Cloud Run demo.')
with video.open('rb') as stream:
    if stream.read(12)[4:8] != b'ftyp':
        parser.error('The selected video must be an MP4 container.')
with poster.open('rb') as stream:
    magic = stream.read(8)
if magic.startswith(b'\x89PNG\r\n\x1a\n'):
    poster_type = 'image/png'
elif magic.startswith(b'\xff\xd8\xff'):
    poster_type = 'image/jpeg'
else:
    parser.error('The poster must be PNG or JPEG.')
caption_text = captions.read_text(encoding='utf-8-sig')
if not caption_text.startswith('WEBVTT') or '-->' not in caption_text:
    parser.error('The captions must be a nonempty WebVTT file.')
output.mkdir(parents=True, exist_ok=False, mode=0o700)
for name in ('Dockerfile', 'index.html', 'cloudbuild.yaml'):
    shutil.copyfile(source / name, output / name)
config = (source / 'nginx.conf').read_text().replace('default_type image/jpeg;', f'default_type {poster_type};')
(output / 'nginx.conf').write_text(config)
for original, destination in ((video, 'RELAY-demo.mp4'), (poster, 'poster'), (captions, 'captions.vtt')):
    shutil.copyfile(original, output / destination)
(output / '.gcloudignore').write_text('*\n!Dockerfile\n!index.html\n!nginx.conf\n!cloudbuild.yaml\n!RELAY-demo.mp4\n!poster\n!captions.vtt\n!.gcloudignore\n')
files = sorted(p.name for p in output.iterdir())
expected = ['.gcloudignore', 'Dockerfile', 'RELAY-demo.mp4', 'captions.vtt', 'cloudbuild.yaml', 'index.html', 'nginx.conf', 'poster']
assert files == expected
manifest = {name: {'bytes': (output / name).stat().st_size, 'sha256': hashlib.sha256((output / name).read_bytes()).hexdigest()} for name in ('RELAY-demo.mp4', 'poster', 'captions.vtt')}
print(json.dumps({'output': str(output), 'files': files, 'selectedMedia': manifest}, indent=2))
