"""Shared, bounded character animation payload for the local prototype."""
import json
from pathlib import Path

STYLE = json.loads((Path(__file__).resolve().parents[1] / 'cloud/motion-style.json').read_text())


def motion_request(record, index, image, model=None):
    page = record['result']['pages'][index]
    return {
        **{key: STYLE[key] for key in ('duration', 'resolution', 'aspect_ratio', 'generate_audio')},
        'model': model or STYLE['model'],
        'frame_images': [{'type': 'image_url', 'image_url': {'url': image}, 'frame_type': kind} for kind in ('first_frame', 'last_frame')],
        'prompt': STYLE['prompt'] + json.dumps({'title': page['title']['zh'], 'text': page['text']['zh'], 'visual': page['scene']['description']['zh']}, ensure_ascii=False, separators=(',', ':')),
    }
