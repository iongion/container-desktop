"""Unit tests for the release versioning helpers (support/versioning.py).

These cover the pure string transforms used by the ``bump`` / ``version-sync`` /
``publish-meta`` invoke tasks. They intentionally exercise the tricky cases that
caused version drift in the past:

* the version embedded in ``package.json`` ``main`` (a filename, not a field),
* not clobbering dependency pins or the ``manifest_version`` key,
* promoting the changelog ``[Unreleased]`` section,
* rewriting the docs download page (data-version, cache-busters, release URLs),
* rewriting only the homebrew cask version + per-arch sha256 (not ``arch`` lines).
"""

import pytest

from support.versioning import (
    bump_version,
    parse_version,
    promote_changelog,
    render_homebrew_rb,
    set_docs_version,
    set_manifest_version,
    set_package_json_version,
    set_plain_version,
)


# --- parse_version ---------------------------------------------------------


def test_parse_version_basic():
    assert parse_version("5.2.15") == (5, 2, 15)


def test_parse_version_ignores_prerelease():
    assert parse_version("5.2.2-rc.8") == (5, 2, 2)


# --- bump_version ----------------------------------------------------------


def test_bump_patch():
    assert bump_version("5.2.15", "patch") == "5.2.16"


def test_bump_defaults_to_patch():
    assert bump_version("5.2.15") == "5.2.16"


def test_bump_minor_resets_patch():
    assert bump_version("5.2.15", "minor") == "5.3.0"


def test_bump_major_resets_minor_and_patch():
    assert bump_version("5.2.15", "major") == "6.0.0"


def test_bump_rejects_unknown_part():
    with pytest.raises(ValueError):
        bump_version("5.2.15", "huge")


# --- set_package_json_version ----------------------------------------------


def test_set_package_json_version_updates_version_and_main_filename():
    text = (
        "{\n"
        '  "name": "container-desktop",\n'
        '  "version": "5.2.15",\n'
        '  "main": "build/main-5.2.15.cjs",\n'
        '  "dependencies": {\n'
        '    "react": "19.2.7"\n'
        "  }\n"
        "}\n"
    )
    out = set_package_json_version(text, "5.2.16")
    assert '"version": "5.2.16"' in out
    assert '"main": "build/main-5.2.16.cjs"' in out
    # dependency pins must be untouched
    assert '"react": "19.2.7"' in out


# --- set_manifest_version --------------------------------------------------


def test_set_manifest_version_leaves_manifest_version_key_alone():
    text = (
        "{\n"
        '  "manifest_version": 2,\n'
        '  "name": "Container Desktop",\n'
        '  "version": "5.2.15"\n'
        "}\n"
    )
    out = set_manifest_version(text, "5.2.16")
    assert '"manifest_version": 2' in out
    assert '"version": "5.2.16"' in out


# --- set_plain_version -----------------------------------------------------


def test_set_plain_version_replaces_content_and_keeps_trailing_newline():
    assert set_plain_version("5.2.14\n", "5.2.15") == "5.2.15\n"


# --- promote_changelog -----------------------------------------------------


def test_promote_changelog_inserts_dated_section_after_unreleased():
    text = "# Changelog\n\n## [Unreleased]\n\n## Added\n\n- Something\n"
    out = promote_changelog(text, "5.2.16", "2026-06-13")
    assert "## [Unreleased]\n\n## [5.2.16] - 2026-06-13\n" in out
    assert "- Something" in out


def test_promote_changelog_is_noop_without_unreleased():
    text = "# Changelog\n\n## [5.2.15] - 2026-01-01\n"
    assert promote_changelog(text, "5.2.16", "2026-06-13") == text


# --- set_docs_version ------------------------------------------------------


def test_set_docs_version_updates_data_version_cachebuster_and_urls():
    text = (
        '<html lang="en" data-version="5.2.13">\n'
        '<link rel="stylesheet" href="./css/common.css?v=5.2.13.3" />\n'
        '<a href="https://github.com/iongion/container-desktop/releases/download/'
        '5.2.13/container-desktop-x86_64-5.2.13.AppImage">AppImage</a>\n'
    )
    out = set_docs_version(text, "5.2.16")
    assert 'data-version="5.2.16"' in out
    assert "common.css?v=5.2.16.3" in out
    assert "releases/download/5.2.16/container-desktop-x86_64-5.2.16.AppImage" in out
    assert "5.2.13" not in out


def test_set_docs_version_is_noop_when_already_current():
    text = '<html lang="en" data-version="5.2.16">\n'
    assert set_docs_version(text, "5.2.16") == text


# --- render_homebrew_rb ----------------------------------------------------


def test_render_homebrew_rb_updates_version_and_per_arch_hashes_only():
    text = (
        'cask "container-desktop" do\n'
        '  arch arm: "arm64", intel: "x64"\n'
        "\n"
        '  version "5.2.15"\n'
        '  sha256 arm:   "aaa111",\n'
        '         intel: "bbb222"\n'
        "\n"
        '  url "https://github.com/iongion/container-desktop/releases/'
        'container-desktop-#{arch}-#{version}.dmg"\n'
        "end\n"
    )
    out = render_homebrew_rb(text, "5.2.16", "ccc333", "ddd444")
    assert 'version "5.2.16"' in out
    assert '"ccc333"' in out
    assert '"ddd444"' in out
    # the arch declaration must NOT be mistaken for a hash
    assert 'arch arm: "arm64", intel: "x64"' in out
    # url interpolation must be preserved
    assert "container-desktop-#{arch}-#{version}.dmg" in out
    assert "5.2.15" not in out
