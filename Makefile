# Written with AI assistance (Codex); human review pending.
PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
RUFF = $(PYTHON) -m ruff
PROJECT ?= $(EE_PROJECT)
EARTH_COUNT_PER_STRATUM ?= 1000
EARTH_OUT_DIR ?= data/processed
EARTH_ARGS ?=

.PHONY: setup fixtures data earth test check web dev offline serve clean

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
