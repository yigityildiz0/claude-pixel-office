"""Build the original MIT character sheets from the repository's PNG strips.

Run: python -I tools/char_data_uret.py piksel-ofis/hooks/char-data.ts
Requires Pillow. Paths to input assets are relative to this script, never the cwd.

The renderer places the sheet at y - ay * scale. Use the idle frame's exclusive
opaque bottom when it is above the manifest anchor: otherwise transparent padding
would leave the feet floating. Currently this corrects only evren (34 -> 33);
the other characters keep y=34. The manifest's horizontal anchor is preserved.
"""

import base64
import json
from pathlib import Path
import sys

from PIL import Image


KINDS = (
    'pofu', 'pofu-opus', 'pofu-sonnet', 'pofu-haiku', 'pofu-boss',
    'gunes', 'dunya', 'ay', 'yildiz', 'kristal', 'evren', 'diger',
)
STATES = ('idle', 'walk', 'wave', 'work', 'think', 'read', 'wait', 'done', 'fail', 'run')
STRIPS = (*STATES, 'walk_sol')
REQUIRED = STATES[:9]
ASSETS = Path(__file__).resolve().parent.parent / 'characters'


def frame_box(image, frame, width, height):
    alpha = image.crop((frame * width, 0, (frame + 1) * width, height)).getchannel('A')
    box = alpha.point(lambda value: 255 if value >= 128 else 0).getbbox()
    if box is None:
        raise ValueError(f'Empty frame: {frame}')
    return box


def positive(value, label, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise ValueError(f'{label}: expected a positive number')
    if integer and int(value) != value:
        raise ValueError(f'{label}: expected an integer')
    return int(value) if integer else value


def build():
    manifest = json.loads((ASSETS / 'manifest.json').read_text(encoding='utf-8'))
    characters = manifest['karakterler']
    if set(characters) != set(KINDS):
        raise ValueError('Expected exactly the 12 original character keys')
    entries = []
    strip_count = 0
    largest = ('', 0)
    for kind in KINDS:
        character = characters[kind]
        width = positive(character['w'], f'{kind}.w', integer=True)
        height = positive(character['h'], f'{kind}.h', integer=True)
        scale = positive(character['olcek_onerisi'], f'{kind}.scale')
        ax, anchor_y = character['anker']['x'], character['anker']['y']
        if not (0 <= ax <= width and 0 <= anchor_y <= height):
            raise ValueError(f'{kind}: anchor outside frame')
        states = character['durumlar']
        if not set(REQUIRED) <= set(states) or set(states) - set(STRIPS):
            raise ValueError(f'{kind}: missing or unknown state')
        if ('run' in states) != (kind == 'pofu'):
            raise ValueError(f'{kind}: only pofu has a run strip')
        if ('walk_sol' in states) != (kind == 'evren'):
            raise ValueError(f'{kind}: only evren has a walk_sol strip')
        lines = []
        for state in STRIPS:
            if state not in states:
                continue
            info = states[state]
            count = positive(info['n'], f'{kind}/{state}.n', integer=True)
            fps = positive(info['fps'], f'{kind}/{state}.fps')
            source = ASSETS / kind / f'{state}.png'
            raw = source.read_bytes()
            with Image.open(source) as image:
                if image.format != 'PNG' or image.size != (width * count, height):
                    raise ValueError(f'{kind}/{state}: unexpected PNG dimensions')
                rgba = image.convert('RGBA')
                for frame in range(count):
                    frame_box(rgba, frame, width, height)
                if state == 'idle':
                    left, top, right, bottom = frame_box(rgba, 0, width, height)
            encoded = base64.b64encode(raw).decode('ascii')
            strip_count += 1
            if len(encoded) > largest[1]:
                largest = (f'{kind}/{state}', len(encoded))
            lines.append(f"      {state}: {{ n: {count}, fps: {fps}, b64: '{encoded}' }},")
        ay = min(anchor_y, bottom)
        entries.append(
            f"  '{kind}': {{\n"
            f"    w: {width}, h: {height}, scale: {scale}, ax: {ax}, ay: {ay},\n"
            f"    fig: {{ top: {top}, bottom: {bottom}, left: {left}, right: {right} }},\n"
            "    states: {\n" + '\n'.join(lines) + "\n    },\n  },"
        )
    header = (
        '// generated from characters/manifest.json by tools/char_data_uret.py; do not edit by hand\n'
        '// Original characters, MIT. Horizontal PNG strips; base64 excludes the data URL prefix.\n'
        '// fig: idle frame 0, alpha >= 128, exclusive right/bottom.\n'
        '// ay: min(manifest anchor.y, idle opaque bottom), so transparent padding stays below the feet.\n'
        'export type CharKind = ' + ' | '.join(f"'{kind}'" for kind in KINDS) + '\n'
        'export type CharState = ' + ' | '.join(f"'{state}'" for state in STATES) + '\n'
        'export type CharStrip = { n: number; fps: number; b64: string }\n'
        'export type CharSheet = {\n'
        '  w: number; h: number; scale: number; ax: number; ay: number\n'
        '  fig: { top: number; bottom: number; left: number; right: number }\n'
        "  states: Partial<Record<CharState | 'walk_sol', CharStrip>>\n"
        '}\n\n'
        'export const CHAR_SET: Readonly<Record<CharKind, CharSheet>> = {\n'
    )
    return header + '\n'.join(entries) + '\n}\n', strip_count, largest


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python -I tools/char_data_uret.py <output char-data.ts>')
    text, count, largest = build()
    target = Path(sys.argv[1])
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('w', encoding='utf-8', newline='\n') as output:
        output.write(text)
    print(f'Generated {count} strips; largest: {largest[0]}, {largest[1]} base64 characters')


if __name__ == '__main__':
    main()
