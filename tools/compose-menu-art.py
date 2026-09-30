# Rebuilds both menu backgrounds (feed card + expanded menu share them via
# src/client/menu.css) from the in-game art: notebook paper, a few clouds,
# and a paper ledge (the platform tiles) just under the hero pencil's
# shoes, with the pencil from ~/Desktop/Assets/pencil sprites/better idle.png.
# usage: python3 tools/compose-menu-art.py
#
# The pencil must stay exactly where the CSS layout expects him (the Play
# group sits beside/below him, never over him), so he's placed by the
# yellow-body/red-shoe box measured on the previous art (PENCIL_BOX) and
# scaled by its height.
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

A = Path('public/assets')
HERO = Path.home() / 'Desktop/Assets/pencil sprites/better idle.png'
LAYOUTS = {
    'menu-background': dict(
        size=(1672, 941),
        pencil_box=(326, 206, 520, 799),
        ground_y=775,
        # Kept clear of the title/Play group (right of centre, top half).
        title_zone=(640, 0, 1450, 420),
        # (cloud, centre x, centre y, width), as fractions of the image.
        clouds=[('cloud-a', 0.10, 0.12, 0.17), ('cloud-d', 0.30, 0.09, 0.10), ('cloud-c', 0.93, 0.15, 0.10)],
    ),
    'menu-background-portrait': dict(
        size=(900, 1614),
        pencil_box=(341, 677, 554, 1303),
        ground_y=1285,
        # The group is centred on top, about 55% wide; clouds go either side.
        title_zone=(200, 0, 700, 720),
        clouds=[('cloud-a', 0.11, 0.24, 0.20), ('cloud-b', 0.89, 0.30, 0.20)],
    ),
}


def load(rel):
    return Image.open(A / rel).convert('RGBA')


def fit_h(im, h):
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def overlaps(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def body_box(im):
    # Yellow body + red eraser/shoes: the same box measured on the old art.
    a = np.array(im).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    mask = (al > 128) & (((r > 200) & (g > 160) & (b < 90)) | ((r > 190) & (g < 90) & (b < 110)))
    ys, xs = np.where(mask)
    return xs.min(), ys.min(), xs.max(), ys.max()


def compose(name, size, pencil_box, ground_y, title_zone, clouds):
    W, H = size
    out = Image.new('RGBA', size)
    paper = fit_h(load('ui/paper-bg.webp'), H)
    for x in range(0, W, paper.width):
        out.alpha_composite(paper, (x, 0))

    for key, fx, fy, fw in clouds:
        cloud = load(f'background/{key}.webp')
        w = round(fw * W)
        cloud = cloud.resize((w, round(cloud.height * w / cloud.width)), Image.LANCZOS)
        box = (round(fx * W - cloud.width / 2), round(fy * H - cloud.height / 2))
        assert not overlaps((*box, box[0] + cloud.width, box[1] + cloud.height), title_zone), key
        out.alpha_composite(cloud, box)

    body_h = pencil_box[3] - pencil_box[1]
    hero_src = Image.open(HERO).convert('RGBA')
    sx0, sy0, sx1, sy1 = body_box(hero_src)
    scale = body_h / (sy1 - sy0)
    hero = hero_src.resize((round(hero_src.width * scale), round(hero_src.height * scale)), Image.LANCZOS)
    cx = (pencil_box[0] + pencil_box[2]) / 2
    hero_pos = (round(cx - (sx0 + sx1) / 2 * scale), round(pencil_box[1] - sy0 * scale))

    # A three-piece paper ledge just under his shoes (the solid pixels in
    # the bottom tenth of the pencil), with a little overhang each side.
    solid = np.array(hero.getchannel('A')) > 128
    feet_rows = solid[int(hero.height * 0.9):]
    feet_cols = np.where(feet_rows.any(axis=0))[0]
    feet_left, feet_right = hero_pos[0] + feet_cols.min(), hero_pos[0] + feet_cols.max()
    ledge_w = (feet_right - feet_left) + 90
    pieces = [load(f'paper/tiles/platform-{s}.webp') for s in ('left', 'center-1', 'right')]
    piece_h = round(ledge_w / 3 * pieces[0].height / pieces[0].width)
    pieces = [fit_h(p, piece_h) for p in pieces]
    # Overlapped a little so the torn edges don't leave a seam.
    overlap = round(piece_h * 0.08)
    x = round((feet_left + feet_right) / 2 - (sum(p.width for p in pieces) - 2 * overlap) / 2)
    for piece in pieces:
        out.alpha_composite(piece, (x, ground_y - 6))
        x += piece.width - overlap

    out.alpha_composite(hero, hero_pos)
    with tempfile.NamedTemporaryFile(suffix='.png') as tmp:
        out.convert('RGB').save(tmp.name)
        subprocess.run(['cwebp', '-quiet', '-q', '88', tmp.name, '-o', str(A / f'ui/{name}.webp')], check=True)
    # Re-measure around where he should be (the ledge tiles
    # have yellows/reds of their own).
    x0, y0, x1, y1 = pencil_box
    region = (x0 - 40, y0 - 40, x1 + 40, y1 + 20)
    bx0, by0, bx1, by1 = body_box(Image.open(A / f'ui/{name}.webp').convert('RGBA').crop(region))
    print('wrote', name, 'pencil body box', (bx0 + region[0], by0 + region[1], bx1 + region[0], by1 + region[1]), 'was', pencil_box)


for layout_name, layout in LAYOUTS.items():
    compose(layout_name, **layout)
