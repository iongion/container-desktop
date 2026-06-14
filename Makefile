PROJECT_ROOT:=$(shell dirname $(abspath $(lastword $(MAKEFILE_LIST))))
TEMP_DIR:=$(PROJECT_ROOT)/temp
UV_VERSION:=0.6.11


.PHONY: clean prepare check format build-website

clean:
	@echo "Cleaning build artifacts"
	rm -fr bin build

prepare:
	@echo "Preparing the project - synchronizing dependencies - $(PROJECT_ROOT)"
	python -m pip install --disable-pip-version-check "uv==$(UV_VERSION)"
	uv sync --locked --dev --no-install-project
	mkdir -p "$(TEMP_DIR)"

check:
	@echo "Checking the project"
	uv run --locked ruff check --fix tasks.py ./support ./tests

format:
	@echo "Formatting the project"
	uv run --locked ruff format tasks.py ./support ./tests
	yarn format

build-website:
	@echo "Building the website (website-src -> website)"
	rm -fr website
	yarn build:website
