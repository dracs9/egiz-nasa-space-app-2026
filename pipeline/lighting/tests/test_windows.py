# Written with AI assistance (Codex); human review pending.
import pytest

from pipeline.lighting.windows import latitude_bin


def test_latitude_bin_boundaries():
    assert latitude_bin(-90) == 0
    assert latitude_bin(90) == 1799
    assert latitude_bin(0) == 900
    assert latitude_bin(-77.5) == 125
    with pytest.raises(ValueError):
        latitude_bin(91)
