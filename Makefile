# Written with AI assistance (Codex); human review pending.
PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,$(if $(wildcard .venv/Scripts/python.exe),.venv/Scripts/python.exe,python3))
RUFF = $(PYTHON) -m ruff
PROJECT ?= $(EE_PROJECT)
EARTH_COUNT_PER_STRATUM ?= 1000
EARTH_OUT_DIR ?= data/processed
EARTH_ARGS ?=

.PHONY: setup fixtures data earth test check web dev offline serve clean discover discover-acquire discover-check atlas atlas-verify atlas-discover atlas-check world world-verify world-check ml-validate-data ml-infer ml-test ml-example ml-infer-geo world-scene world-earth ml-env-acquire ml-infer-env

setup:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements.txt
	npm --prefix web ci

fixtures:
	$(PYTHON) tools/build_data.py --fixtures

data:
	$(PYTHON) tools/build_data.py

earth:
	$(PYTHON) -m pipeline.earth.acquire $(if $(strip $(PROJECT)),--project "$(PROJECT)",) --count-per-stratum $(EARTH_COUNT_PER_STRATUM) --out-dir "$(EARTH_OUT_DIR)" $(EARTH_ARGS)

test:
	$(PYTHON) -m pytest -q
	npm --prefix web test -- --run

science-build:
	$(PYTHON) -m pipeline.science.spice build
	node web/scripts/copy-data.mjs

science-fetch:
	$(PYTHON) -m pipeline.science.spice fetch

science-check:
	$(PYTHON) -m pytest -q tests/test_spice.py
	npm --prefix web test -- src/mission/engineering.test.ts src/mission/transfer.test.ts src/mission/openmctAdapter.test.ts

science-serve:
	$(PYTHON) -m pipeline.science.spice serve

check:
	$(PYTHON) tools/tasks.py validate
	$(RUFF) check pipeline tests tools/build_data.py tools/check_bundle.py tools/check_secrets.py tools/make_offline.py
	$(PYTHON) -m pytest -q
	$(PYTHON) tools/check_bundle.py
	$(PYTHON) tools/check_secrets.py
	npm --prefix web run typecheck
	npm --prefix web test -- --run
	npm --prefix web run build

web: data
	npm --prefix web run build

dev: data
	npm --prefix web run dev -- --host 127.0.0.1

offline: web
	$(PYTHON) tools/make_offline.py

serve:
	$(PYTHON) -m http.server 4173 --bind 127.0.0.1 --directory web/dist

clean:
	$(PYTHON) -c "import shutil; shutil.rmtree('web/dist', ignore_errors=True)"

# Optional native engines execute only when explicitly selected.
dynamics-build:
	$(PYTHON) -m pipeline.dynamics build
	node web/scripts/copy-data.mjs

dynamics-check:
	$(PYTHON) -m pytest -q tests/test_native_dynamics.py tests/test_native_service.py
	npm --prefix web test -- src/mission/dynamics.test.ts src/mission/robustCampaign.test.ts

terrain-build:
	$(PYTHON) -m pipeline.common.terrain_pyramid
	node web/scripts/copy-data.mjs

# ATLAS-Pi mission-conditioned transferability (additive; reads data/pilot only).
atlas:
	$(PYTHON) -m pipeline.analog_transfer build
	node web/scripts/copy-data.mjs

atlas-verify:
	$(PYTHON) -m pipeline.analog_transfer verify

atlas-discover:
	$(PYTHON) -m pipeline.analog_transfer discover

atlas-check:
	$(PYTHON) -m pytest -q tests/test_analog_transfer.py
	npm --prefix web test -- src/atlas

# EGIZ ASTRAL planetary world package (additive; reads data/raw/targets, writes data/world).
world:
	$(PYTHON) -m pipeline.world build
	node web/scripts/copy-data.mjs

world-verify:
	$(PYTHON) -m pipeline.world verify

world-check:
	$(PYTHON) -m pytest -q tests/test_world.py
	npm --prefix web test -- src/world src/studio

# Geospatial release (docs/GEOSPATIAL_DATA_INTERFACE.md). GEO_SCOPE=pilot|all; GEO_SAMPLE=N reselects sampled AOIs.
GEO_SCOPE ?= all
GEO_SAMPLE ?= 0
.PHONY: geo-audit geo-acquire geo-features geo-manifest geo-validate geo-illumination geo-test
geo-audit:
	$(PYTHON) -m pipeline.geodata audit
geo-acquire:
	$(PYTHON) -m pipeline.geodata acquire --scope $(GEO_SCOPE) --sample $(GEO_SAMPLE)
geo-features:
	$(PYTHON) -m pipeline.geodata features --scope $(GEO_SCOPE)
geo-manifest:
	$(PYTHON) -m pipeline.geodata manifest --scope $(GEO_SCOPE)
geo-illumination:
	$(PYTHON) -m pipeline.lighting.real_shadows
geo-validate:
	$(PYTHON) -m pipeline.geodata validate
geo-test:
	$(PYTHON) -m pytest -q pipeline/geodata

# ML intelligence layer (Stage 1). Written with AI assistance (Claude Code); human review pending.
ML_DATA ?= data/pilot
ML_OUT ?= artifacts/ml/discovery

ml-validate-data:
	$(PYTHON) -m pipeline.ml validate-data --data $(ML_DATA)

ml-infer:
	$(PYTHON) -m pipeline.ml infer --data $(ML_DATA) --out $(ML_OUT)

ml-test:
	$(PYTHON) -m pytest -q tests/test_ml_stage1.py tests/test_ml_geo.py

ml-example:
	$(PYTHON) -m pipeline.ml infer --data data/pilot --out contracts/ml/examples --created-at 2026-11-07T00:00:00+00:00

GEO_RELEASE ?= data/geo/geo-0.1.0

ml-infer-geo:
	$(PYTHON) -m pipeline.ml infer --geo $(GEO_RELEASE) --data data/pilot --out artifacts/ml/discovery-geo

# Measured egiz.world_scene package for Mission Studio (ASTRAL Jezero). Needs network on first run and SPICE kernels for illumination.
world-scene:
	$(PYTHON) -m pipeline.world.scene mars-jezero
	$(PYTHON) -m pipeline.world.illumination mars-jezero --days 3
	node web/scripts/copy-world.mjs

# EGIZ Discovery Engine (docs/discovery). discover-acquire needs network (public COGs and APIs, no credentials).
DISCOVER_DRAWS ?= 128
discover-acquire:
	$(PYTHON) -m pipeline.discovery acquire --set targets --set benchmark --set kz --set global --workers 16
discover:
	$(PYTHON) -m pipeline.discovery index
	$(PYTHON) -m pipeline.discovery build --draws $(DISCOVER_DRAWS)
	$(PYTHON) -m pipeline.discovery validate
	$(PYTHON) -m pipeline.discovery report
	node web/scripts/copy-data.mjs
# AlphaEarth needs Earth Engine: project id below; credentials from EE_SERVICE_ACCOUNT_KEY (JSON key kept
# outside the repo, default ~/.config/egiz/ee-key.json) or from `earthengine authenticate`.
EE_PROJECT ?= deft-cove-409713
EE_KEY_DEFAULT := $(wildcard $(HOME)/.config/egiz/ee-key.json)
EE_SERVICE_ACCOUNT_KEY ?= $(EE_KEY_DEFAULT)
export EE_PROJECT EE_SERVICE_ACCOUNT_KEY
discover-serve:
	$(PYTHON) -m pipeline.discovery serve
alphaearth-index:
	$(PYTHON) -m pipeline.discovery alphaearth-index
discover-check:
	$(PYTHON) -m pytest -q tests/test_discovery.py
	$(PYTHON) -m pipeline.discovery verify
	npm --prefix web test -- src/discover

# Measured 3D world (ASTRAL) for any Earth window of the discovery index: make world-earth WINDOW=PILOT_BOSZHIRA
world-earth:
	$(PYTHON) -m pipeline.world.scene earth:$(WINDOW)
	$(PYTHON) -m pipeline.world.illumination earth:$(WINDOW) --days 2
	node web/scripts/copy-world.mjs

EE_ENV_OUT ?= data/env/env-0.1.0

ml-env-acquire:
	$(PYTHON) tools/acquire_env_supplement.py --project $(PROJECT) --geo $(GEO_RELEASE) --out $(EE_ENV_OUT) --batch 8

ml-infer-env:
	$(PYTHON) -m pipeline.ml infer --geo $(GEO_RELEASE) --env $(EE_ENV_OUT) --data data/pilot --out artifacts/ml/discovery-env
