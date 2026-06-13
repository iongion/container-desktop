"""Pure version-string transforms shared by the release invoke tasks.

Every function here takes file *contents* and returns new contents. All file IO,
git and network side effects live in ``tasks.py``. Keeping these pure makes the
fiddly rules -- the version embedded in ``package.json`` ``main`` (a filename),
the docs cache-busters, the per-arch homebrew hashes -- straightforward to unit
test (see ``tests/test_versioning.py``).
"""

from __future__ import annotations

import re


PARTS = ("major", "minor", "patch")


def parse_version(value: str) -> tuple[int, int, int]:
    """Return ``(major, minor, patch)`` from a version string.

    Tolerates a leading ``v`` and any ``-prerelease`` / ``+build`` suffix.
    """
    core = value.strip().lstrip("v").split("+", 1)[0].split("-", 1)[0]
    parts = core.split(".")
    return (int(parts[0]), int(parts[1]), int(parts[2]))


def bump_version(value: str, part: str = "patch") -> str:
    """Increment ``value`` by ``part`` (``major`` / ``minor`` / ``patch``)."""
    if part not in PARTS:
        raise ValueError(f"unknown version part: {part!r} (expected one of {PARTS})")
    major, minor, patch = parse_version(value)
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def _replace_json_string_value(text: str, key: str, value: str) -> str:
    pattern = re.compile(r'("' + re.escape(key) + r'":\s*")[^"]*(")')
    return pattern.sub(rf"\g<1>{value}\g<2>", text, count=1)


def set_package_json_version(text: str, version: str) -> str:
    """Update ``version`` and the version embedded in ``main`` (a filename)."""
    text = _replace_json_string_value(text, "version", version)
    return re.sub(
        r'("main":\s*"build/main-)[^"]*(\.cjs")',
        rf"\g<1>{version}\g<2>",
        text,
        count=1,
    )


def set_manifest_version(text: str, version: str) -> str:
    """Update the ``version`` field, leaving ``manifest_version`` untouched."""
    return _replace_json_string_value(text, "version", version)


def set_plain_version(text: str, version: str) -> str:
    """Replace a plaintext VERSION file body, preserving a trailing newline."""
    suffix = "\n" if text.endswith("\n") else ""
    return f"{version}{suffix}"


def promote_changelog(text: str, version: str, today: str) -> str:
    """Insert a dated ``[version]`` section under ``[Unreleased]``.

    No-op when there is no ``## [Unreleased]`` heading.
    """
    marker = "## [Unreleased]"
    if marker not in text:
        return text
    return text.replace(marker, f"{marker}\n\n## [{version}] - {today}", 1)


def set_website_version(text: str, version: str) -> str:
    """Point the website download page at ``version``.

    The current version is read from the ``data-version`` attribute and every
    literal occurrence is rewritten -- this covers ``data-version``, the
    ``?v=x.y.z[.n]`` asset cache-busters and the release download URLs.
    """
    match = re.search(r'data-version="([^"]+)"', text)
    if match is None:
        raise ValueError("docs page has no data-version attribute")
    current = match.group(1)
    if current == version:
        return text
    return text.replace(current, version)


def render_homebrew_rb(text: str, version: str, sha_arm: str, sha_intel: str) -> str:
    """Update the cask ``version`` and the per-arch ``sha256`` values.

    The download URL uses ``#{version}`` interpolation so it needs no change, and
    the ``arch arm:/intel:`` declaration must not be mistaken for the hashes.
    """
    text = re.sub(r'(version\s+")[^"]*(")', rf"\g<1>{version}\g<2>", text, count=1)
    return re.sub(
        r'(sha256\s+arm:\s*")[^"]*(",\s*intel:\s*")[^"]*(")',
        rf"\g<1>{sha_arm}\g<2>{sha_intel}\g<3>",
        text,
        count=1,
    )
