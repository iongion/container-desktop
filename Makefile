# Globals
SHELL:=/bin/bash

# Constants
export PROJECT_HOME:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

%:
	@$(PROJECT_HOME)/support/cli.sh $@ $(filter-out $@,$(MAKECMDGOALS))
