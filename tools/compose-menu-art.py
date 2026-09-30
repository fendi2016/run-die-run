# Rebuilds both menu backgrounds (feed card + expanded menu share them via
# src/client/menu.css) from the in-game art: notebook paper, clouds, the
# ground tiles, the pencil case and the sharpener, with the hero pencil
# from ~/Desktop/Assets/pencil sprites/better idle.png.
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
        rows=1,
        # Kept clear of the title/Play group (right of centre, top half).
        title_zone=(640, 0, 1450, 420),
        # (cloud, centre x, centre y, width), as fractions of the image.
        clouds=[('cloud-a', 0.10, 0.12, 0.17), ('cloud-d', 0.30, 0.10, 0.10), ('cloud-c', 0.93, 0.52, 0.11)],
        sharpener=True,
    ),
    'menu-background-portrait': dict(
        size=(900, 1614),
        pencil_box=(341, 677, 554, 1303),
        ground_y=1285,
        rows=2,
        title_zone=(150, 0, 750, 560),
        clouds=[('cloud-a', 0.14, 0.45, 0.30), ('cloud-b', 0.86, 0.41, 0.30)],
        sharpener=False,
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


def compose(name, size, pencil_box, ground_y, rows, title_zone, clouds, sharpener):
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

    tile_h = round((H - ground_y) / rows)
    ends = [fit_h(load(f'paper/tiles/ground-{s}.webp'), tile_h) for s in ('left', 'right')]
    centers = [fit_h(load(f'paper/tiles/ground-center-{i}.webp'), tile_h) for i in (1, 2, 3)]
    for r in range(rows):
        y, x, i = ground_y + r * tile_h, 0, 0
        while x < W:
            tile = ends[0] if x == 0 else centers[(i + r) % 3]
            out.alpha_composite(tile, (x, y))
            x += tile.width
            i += 1

    body_h = pencil_box[3] - pencil_box[1]
    hero_src = Image.open(HERO).convert('RGBA')
    sx0, sy0, sx1, sy1 = body_box(hero_src)
    scale = body_h / (sy1 - sy0)
    hero = hero_src.resize((round(hero_src.width * scale), round(hero_src.height * scale)), Image.LANCZOS)
    cx = (pencil_box[0] + pencil_box[2]) / 2
    hero_pos = (round(cx - (sx0 + sx1) / 2 * scale), round(pencil_box[1] - sy0 * scale))

    # The pencil case stands left of him, as at a level's spawn, sized to
    # fit the gap between him and the edge.
    solid_cols = np.where((np.array(hero_src.getchannel('A')) > 128).any(axis=0))[0]
    hero_left = hero_pos[0] + round(solid_cols.min() * scale)
    case_src = load('markers/spawn.webp')
    case_h = min(round(body_h * 0.3), round((hero_left - 40) * case_src.height / case_src.width))
    case = fit_h(case_src, case_h)
    out.alpha_composite(case, (hero_left - 16 - case.width, ground_y - case.height + 8))
    if sharpener:
        sharp = fit_h(load('markers/finish.webp'), round(body_h * 0.34))
        out.alpha_composite(sharp, (W - 50 - sharp.width, ground_y - sharp.height + 8))

    out.alpha_composite(hero, hero_pos)
    with tempfile.NamedTemporaryFile(suffix='.png') as tmp:
        out.convert('RGB').save(tmp.name)
        subprocess.run(['cwebp', '-quiet', '-q', '88', tmp.name, '-o', str(A / f'ui/{name}.webp')], check=True)
    # Re-measure around where he should be (the case, sharpener and tiles
    # have yellows/reds of their own).
    x0, y0, x1, y1 = pencil_box
    region = (x0 - 40, y0 - 40, x1 + 40, y1 + 20)
    bx0, by0, bx1, by1 = body_box(Image.open(A / f'ui/{name}.webp').convert('RGBA').crop(region))
    print('wrote', name, 'pencil body box', (bx0 + region[0], by0 + region[1], bx1 + region[0], by1 + region[1]), 'was', pencil_box)


for layout_name, layout in LAYOUTS.items():
    compose(layout_name, **layout)
