"""Real optional native integrations; controlled physical invariants, not screenshots."""
import json
from pathlib import Path

import numpy as np
import pytest

from pipeline.dynamics.engines import BODIES, execute, validate


@pytest.mark.parametrize('field,value', [('duration', float('nan')), ('stiffness', -1), ('kind', 'fake'), ('body', 'venus'), ('speed', True), ('script', 'run')])
def test_native_rejects_invalid_input(field, value):
    with pytest.raises(ValueError):
        validate({'kind': 'rover', field: value})


@pytest.mark.parametrize('body', ['earth', 'moon', 'mars'])
def test_real_contact_static_equilibrium(body):
    pytest.importorskip('mujoco')
    r = execute({'kind': 'rover', 'body': body, 'duration': 12, 'course': 'flat', 'speed': 0})
    s = r['states'][-1]
    assert r['metrics']['mass'] == pytest.approx(900)
    assert sum(w['normalForce'] for w in s['wheels']) == pytest.approx(900*BODIES[body][0], rel=1e-5)
    assert s['tiltDeg'] < .5
    assert all(abs(np.linalg.norm(p[3:])-1) < 1e-10 for p in s['poses'])
    assert r['modelSha256']


def test_native_reproduces_and_responds_to_design():
    pytest.importorskip('mujoco')
    request = {'kind': 'rover', 'duration': 18}
    a, b = execute(request), execute(request)
    assert a['states'] == b['states']
    softer = execute({**request, 'stiffness': 1200})
    assert abs(softer['metrics']['energyWh']-a['metrics']['energyWh']) > .001
    assert softer['states'][-1]['poses'] != a['states'][-1]['poses']
    assert a['states'][-1]['wheels'][0]['spin'] != 0


def test_contact_time_step_convergence_flat():
    pytest.importorskip('mujoco')
    config = {'kind': 'rover', 'duration': 8, 'course': 'flat'}
    a = execute({**config, 'step': .002})
    b = execute({**config, 'step': .001})
    assert np.linalg.norm(np.array(a['states'][-1]['position'])-np.array(b['states'][-1]['position'])) < .02
    assert abs(a['metrics']['energyWh']-b['metrics']['energyWh']) < .01


@pytest.mark.parametrize('body', ['earth', 'moon', 'mars'])
def test_basilisk_circular_orbit_invariants(body):
    pytest.importorskip('Basilisk')
    record = execute({'kind': 'orbit', 'body': body, 'duration': 7200})
    states = record['states']
    radii = np.linalg.norm([s['position'] for s in states], axis=1)
    assert max(abs(radii-radii[0])) < .01
    assert record['metrics']['energyRelativeDrift'] < 1e-8
    assert record['metrics']['momentumRelativeDrift'] < 1e-8
    # Independent analytic two-body circular position at the final sample.
    angle = states[-1]['t']*record['metrics']['circularSpeed']/radii[0]
    inc = np.deg2rad(record['request']['inclinationDeg'])
    expected = radii[0]*np.array([np.cos(angle), np.sin(angle)*np.cos(inc), np.sin(angle)*np.sin(inc)])
    assert np.linalg.norm(expected-states[-1]['position']) < .02


def test_basilisk_initial_impulse_matches_vis_viva():
    pytest.importorskip('Basilisk')
    r = execute({'kind': 'orbit', 'duration': 7200, 'deltaV': 120})
    radius, mu, speed = r['metrics']['radius']+400000, r['metrics']['mu'], r['metrics']['circularSpeed']+120
    semimajor = 1/(2/radius-speed**2/mu)
    expected_apoapsis = 2*semimajor-radius-r['metrics']['radius']
    assert r['metrics']['maxAltitude'] == pytest.approx(expected_apoapsis, abs=1.)


def test_measured_pyramid_hashes_and_shared_seams():
    import hashlib
    root = Path('data/terrain/moon-mouton')
    if not root.exists():
        pytest.skip('Build measured terrain first')
    manifest = json.loads((root/'manifest.json').read_text())
    assert manifest['synthetic'] is False
    assert manifest['sourcePostingM'] == 5
    assert len(manifest['tiles']) == 21
    for info in manifest['tiles']:
        assert hashlib.sha256((root/f'{info["key"]}.json').read_bytes()).hexdigest() == info['sha256']
    a = json.loads((root/'2-0-0.json').read_text())
    b = json.loads((root/'2-1-0.json').read_text())
    assert np.array(a['elevations']).reshape(101, 101)[:, -1].tolist() == np.array(b['elevations']).reshape(101, 101)[:, 0].tolist()
    assert a['size']/100 == 10


def test_rolling_slip_uses_nonspinning_steering_frame():
    pytest.importorskip('mujoco')
    r = execute({'kind': 'rover', 'course': 'flat', 'duration': 12})
    last = r['states'][-1]
    assert last['speed'] == pytest.approx(.65, abs=.005)
    assert max(abs(w['slip']) for w in last['wheels']) < .005


@pytest.mark.parametrize('cg,radius', [(.65, .41), (.9, .6)])
def test_native_mass_distribution_preserves_configured_cg(cg, radius):
    pytest.importorskip('mujoco')
    record = execute({'kind': 'rover', 'duration': 2, 'cgHeight': cg, 'wheelRadius': radius, 'wheelbase': max(2.24, 4*radius+.1)})
    assert record['metrics']['initialCenterOfMassZ'] == pytest.approx(cg+.12, abs=1e-10)


def test_native_rejects_inapplicable_or_geometrically_invalid_inputs():
    with pytest.raises(ValueError, match='inapplicable'):
        validate({'kind': 'orbit', 'step': .002})
    with pytest.raises(ValueError, match='inapplicable'):
        validate({'kind': 'rover', 'deltaV': 120})
    with pytest.raises(ValueError, match='Wheel spacing'):
        validate({'kind': 'rover', 'wheelRadius': .8, 'wheelbase': 2.24})



@pytest.mark.parametrize('course', ['flat', 'steps', 'cross-slope'])
def test_native_course_starts_without_rigid_contact_penetration(course):
    mj = pytest.importorskip('mujoco')
    from pipeline.dynamics.engines import rover_xml
    model = mj.MjModel.from_xml_string(rover_xml(validate({'kind': 'rover', 'course': course})))
    data = mj.MjData(model)
    mj.mj_forward(model, data)
    assert all(contact.dist >= -1e-9 for contact in data.contact)
    assert all(model.geom(f'support{i}').bodyid == model.body('chassis').id for i in range(6))
