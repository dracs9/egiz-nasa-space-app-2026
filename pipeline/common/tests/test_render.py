import numpy as np
from PIL import Image

from pipeline.common.render import render_same_sun


def test_same_sun_renders_deterministically(tmp_path):
    z = np.zeros((40, 40))
    a = render_same_sun(z, 30, 5, 90, tmp_path/"a.webp")
    b = render_same_sun(z, 30, 5, 90, tmp_path/"b.webp")
    assert a.read_bytes() == b.read_bytes()
    assert Image.open(a).size == (40, 40)
