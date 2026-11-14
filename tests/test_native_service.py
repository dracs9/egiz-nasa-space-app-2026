"""Actual process lifecycle and cancellation, not mocked solver execution."""
import time

import pytest

from pipeline.dynamics.service import start, status


def wait(job_id):
    deadline = time.monotonic()+20
    while time.monotonic() < deadline:
        result = status(job_id)
        if result['status'] != 'running':
            return result
        time.sleep(.05)
    raise AssertionError('Native service job exceeded test timeout')


def test_native_job_returns_genuine_result():
    pytest.importorskip('mujoco')
    job = start({'kind': 'rover', 'duration': 2, 'course': 'flat'})
    result = wait(job['id'])
    assert result['status'] == 'complete', result
    assert result['result']['engine'].startswith('MuJoCo ')
    assert result['result']['states'][-1]['t'] == pytest.approx(2)


def test_native_cancel_kills_process():
    pytest.importorskip('mujoco')
    from pipeline.dynamics.service import JOBS
    job = start({'kind': 'rover', 'duration': 90, 'step': .001})
    assert status(job['id'], cancel=True)['status'] == 'cancelled'
    process = JOBS[job['id']]['process']
    process.wait(timeout=3)
    assert process.returncode != 0


def test_native_job_validates_before_start():
    with pytest.raises(ValueError):
        start({'kind': 'rover', 'duration': 100000})
