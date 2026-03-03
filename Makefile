VENV     := .venv
PYTHON   := python3
PIP      := $(VENV)/bin/pip
PYTEST   := $(VENV)/bin/pytest

.PHONY: venv test clean

## Create the virtual environment and install all dependencies
venv: $(VENV)/bin/activate

$(VENV)/bin/activate: requirements-dev.txt
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip -q
	$(PIP) install -r requirements-dev.txt -q
	@touch $(VENV)/bin/activate

## Run the test suite inside the virtual environment
test: venv
	$(PYTEST) tests/ -v --tb=short

## Remove the virtual environment and cached files
clean:
	rm -rf $(VENV) __pycache__ .pytest_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
