"""Cuts a wallpaper of nested glass sheets into one picture per sheet, so each can move by itself:
    python3 scripts/split-wallpaper.py dark.png frontend/public/bg/glass
    python3 scripts/split-wallpaper.py light.png frontend/public/bg/light 3
Writes <prefix>-0.webp (what's behind every sheet) to <prefix>-6.webp (the nearest sheet). Each
sheet is found by its bright rim (the last argument is how much brighter than its surroundings a
rim is, 4 unless given: lower for a pale picture); under a sheet, the one behind is painted over
with its own colour, so nothing of the front sheet stays behind when it moves. Needs
opencv-python and numpy, which the app doesn't."""
import sys
import cv2
import numpy as np

src, prefix = sys.argv[1], sys.argv[2]
threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 4
# The layers, back to front: for each, a point on every face it has, as shares of the width and
# height. These are the current wallpaper's: the background, then six waves. The fifth has two
# faces, because one wave comes out from under another there: moved apart, they'd leave a seam.
# Another picture needs its own
LAYERS = [
    [(0.02, 0.03)],
    [(0.48, 0.27)],
    [(0.18, 0.48)],
    [(0.6, 0.58)],
    [(0.48, 0.8), (0.18, 0.72)],
    [(0.06, 0.8)],
    [(0.06, 0.96)],
]
# where a rim fades out before it reaches the one it comes from under: a line to close the gap,
# or the faces on its two sides count as one
JOINS = [((0.296, 0.732), (0.32, 0.72))]

img = cv2.imread(src)
h, w = img.shape[:2]
grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
rim = (grey - cv2.GaussianBlur(grey, (0, 0), 6) > threshold).astype(np.uint8)
rim = cv2.dilate(rim, np.ones((3, 3), np.uint8))  # closes one-pixel gaps in a rim
for (x1, y1), (x2, y2) in JOINS:
    cv2.line(rim, (int(x1 * w), int(y1 * h)), (int(x2 * w), int(y2 * h)), 1, 3)
_, faces = cv2.connectedComponents(1 - rim, connectivity=4)
ids = [[faces[int(y * h), int(x * w)] for x, y in points] for points in LAYERS]
flat = sum(ids, [])
assert len(set(flat)) == len(flat) and 0 not in flat, f"the rims don't separate the faces: {ids}"

def disc(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

# depth[y, x]: which sheet a pixel is part of. A rim (and any speck that is no face) goes with the
# nearest sheet it touches, since a rim is the edge of the sheet in front
depth = np.zeros((h, w), np.uint8)
for k, group in enumerate(ids):  # back to front, so the nearer sheet wins a rim both touch
    depth[cv2.dilate(np.isin(faces, group).astype(np.uint8), disc(15)) == 1] = k
for k, group in enumerate(ids):  # and a face is always its own layer's
    depth[np.isin(faces, group)] = k
sheets = [(depth >= k).astype(np.uint8) for k in range(len(ids))]  # sheet k and all in front of it

for k, sheet in enumerate(sheets):
    out = img.copy()
    if k + 1 < len(sheets):
        # paint over the sheet in front (and its glow, up to 16 pixels out) with the nearest colour
        # of this one, then smooth the streaks that leaves
        hole = cv2.dilate(sheets[k + 1], disc(16))
        _, near = cv2.distanceTransformWithLabels(hole, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        ys, xs = np.nonzero(hole == 0)
        at = np.zeros(near.max() + 1, np.int64)
        at[near[ys, xs]] = np.arange(len(ys))
        filled = img[ys[at[near]], xs[at[near]]]
        soft = cv2.GaussianBlur(np.where(hole[..., None] == 1, filled, img), (0, 0), 12)
        out = np.where(hole[..., None] == 1, soft, img)
    # the rim and a little of its glow go with the sheet; the edge fades over a few pixels
    alpha = cv2.GaussianBlur(cv2.dilate(sheet, disc(8)).astype(np.float32), (0, 0), 2) if k else np.ones((h, w), np.float32)
    out[alpha == 0] = 0  # nothing to store where the sheet isn't
    rgba = np.dstack([out, (alpha * 255).round().astype(np.uint8)])
    # lossless (a quality above 100): at 90 the smooth dark gradients came out in visible squares.
    # It costs about 1.1 MB a picture, mostly the original's fine grain, which is also what keeps
    # those gradients from banding
    cv2.imwrite(f"{prefix}-{k}.webp", rgba, [cv2.IMWRITE_WEBP_QUALITY, 101])

# self-check: the sheets put back together are the picture
back = np.zeros((h, w, 3), np.float32)
for k in range(len(sheets)):
    layer = cv2.imread(f"{prefix}-{k}.webp", cv2.IMREAD_UNCHANGED).astype(np.float32)
    a = layer[..., 3:] / 255 if layer.shape[2] == 4 else 1  # an opaque layer comes back without alpha
    back = back * (1 - a) + layer[..., :3] * a
diff = np.abs(back - img).mean()
assert diff < 2, f"the sheets don't add up to the picture: mean difference {diff:.2f}"
print(f"{prefix}: {len(sheets)} layers, mean difference from the picture {diff:.2f} of 255")
