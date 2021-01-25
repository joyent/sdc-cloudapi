#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2020 Joyent, Inc.
#

#
# Makefile: CloudAPI Makefile
#
#
NAME	:= cloudapi
#
# Tools
#
TAP	:= ./node_modules/.bin/tap

#
# Files
#
DOC_FILES	 = index.md admin.md dev.md
RESTDOWN_FLAGS	 = --brand-dir=deps/restdown-brand-remora
EXTRA_DOC_DEPS += deps/restdown-brand-remora/.git
# We explicitly don't want to lint node-http-signature, as it's an external
# repository that is exceptionally bundled in this repo to ensure backward
# compatibilty when handling different signature formats.
JS_FILES	:= $(shell ls *.js) $(shell find lib -name '*.js' | grep -v node-http-signature) \
	$(shell find test -name '*.js') $(shell find bench -name '*.js') \
	$(shell find plugins -name '*.js') \
	$(shell find test -name '*.javascript')
ESLINT_FILES	= $(JS_FILES)
SMF_MANIFESTS_IN    = smf/manifests/cloudapi.xml.in smf/manifests/haproxy.xml.in

CLEAN_FILES	+= node_modules

# The prebuilt sdcnode version we want. See
# "tools/mk/Makefile.node_prebuilt.targ" for details.
NODE_PREBUILT_VERSION=v6.17.1
ifeq ($(shell uname -s),SunOS)
	# minimal-64-lts@19.4.0
	NODE_PREBUILT_IMAGE=5417ab20-3156-11ea-8b19-2b66f5e7a439
	NODE_PREBUILT_TAG=zone64
else
	NPM=npm
	NODE=node
	NPM_EXEC=$(shell which npm)
	NODE_EXEC=$(shell which node)
endif

ENGBLD_USE_BUILDIMAGE	= true
ENGBLD_REQUIRE		:= $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.defs
endif
include ./deps/eng/tools/mk/Makefile.smf.defs

#
# Variables
#

# Mountain Gorilla-spec'd versioning.

ROOT			:= $(shell pwd)
RELEASE_TARBALL		:= $(NAME)-pkg-$(STAMP).tar.gz
RELSTAGEDIR		:= /tmp/$(NAME)-$(STAMP)
# triton-origin-x86_64-19.4.0
BASE_IMAGE_UUID = 59ba2e5e-976f-4e09-8aac-a4a7ef0395f5
BUILDIMAGE_NAME = $(NAME)
BUILDIMAGE_DESC	= SDC CloudAPI
BUILDIMAGE_PKGSRC = \
	openssl \
	haproxy
AGENTS		= amon config registrar

#
# Env vars
#
PATH	:= $(NODE_INSTALL)/bin:/opt/local/bin:${PATH}

#
# Repo-specific targets
#
.PHONY: all
all: build sdc-scripts

.PHONY: build
build: $(SMF_MANIFESTS) | $(TAP) $(REPO_DEPS)
	$(NPM) install

$(TAP): | $(NPM_EXEC)
	$(NPM) install

DOC_CLEAN_FILES = docs/{index,admin,dev}.{html,json} build/docs
.PHONY: clean-docs
clean-docs:
	-$(RMTREE) $(DOC_CLEAN_FILES)
clean:: clean-docs

.PHONY: release
release: check all docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/cloudapi
	@mkdir -p $(RELSTAGEDIR)/site
	@touch $(RELSTAGEDIR)/site/.do-not-delete-me
	@mkdir -p $(RELSTAGEDIR)/root
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/cloudapi/ssl
	cp -r	$(ROOT)/bin \
		$(ROOT)/etc \
		$(ROOT)/lib \
		$(ROOT)/plugins \
		$(ROOT)/main.js \
		$(ROOT)/node_modules \
		$(ROOT)/package.json \
		$(ROOT)/sapi_manifests \
		$(ROOT)/smf \
		$(ROOT)/test \
		$(ROOT)/tools \
		$(RELSTAGEDIR)/root/opt/smartdc/cloudapi/
	mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/boot
	cp -R $(ROOT)/deps/sdc-scripts/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	cp -R $(ROOT)/boot/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build
	cp -r \
		$(TOP)/build/node \
		$(TOP)/build/docs \
		$(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build
	(cd $(RELSTAGEDIR) && $(TAR) -I pigz -cf $(ROOT)/$(RELEASE_TARBALL) root site)
	@rm -rf $(RELSTAGEDIR)


.PHONY: publish
publish: release
	mkdir -p $(ENGBLD_BITS_DIR)/$(NAME)
	cp $(ROOT)/$(RELEASE_TARBALL) $(ENGBLD_BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)


include ./deps/eng/tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.targ
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
