"""Pure helpers for locating CI-built release artifacts (no I/O).

The Windows CD job builds the Microsoft Store package but keeps it OFF the
public GitHub release (it is superseded there by the signed installer + portable
zip), so it only ever lives inside a run's ``container-desktop-windows`` upload
artifact. These helpers pick the right artifact and read a version out of an
AppX/MSIX filename; the ``gh``/filesystem orchestration lives in ``tasks.py``.
"""

import re


WINDOWS_ARTIFACT_NAMES = {
    "x64": "container-desktop-windows-x64",
    "arm": "container-desktop-windows-arm",
    "arm64": "container-desktop-windows-arm",
}
WINDOWS_ARTIFACT_NAME = WINDOWS_ARTIFACT_NAMES["x64"]
_APPX_VERSION_RE = re.compile(r"-(?:x64|arm64)-(?P<version>.+?)\.appx$")
_WINDOWS_STORE_PACKAGE_VERSION_RE = re.compile(r"-(?:x64|arm64)-(?P<version>.+?)\.(?:appx|msix)$")


def windows_artifact_name(arch="x64"):
    try:
        return WINDOWS_ARTIFACT_NAMES[arch.lower()]
    except KeyError as exc:
        raise ValueError(f"unsupported Windows artifact arch: {arch}") from exc


def select_windows_artifact(artifacts, name=None, arch="x64"):
    """Return the newest non-expired artifact named ``name``, or ``None``.

    ``artifacts`` is the parsed ``.artifacts`` list from the GitHub REST API
    (``repos/:owner/:repo/actions/artifacts``). "Newest" is the highest artifact
    ``id``, so the result never depends on the API's return order. The caller
    reads ``["workflow_run"]["id"]`` off the result to know which run to download.
    """
    name = name or windows_artifact_name(arch)
    candidates = [
        artifact for artifact in artifacts if artifact.get("name") == name and not artifact.get("expired", False)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda artifact: artifact.get("id", 0))


def parse_appx_version(filename):
    """Read the version out of an appx filename.

    ``container-desktop-x64-5.3.11.appx`` -> ``5.3.11``. Returns ``None`` when the
    name is not an appx (e.g. the ``.exe``/``.zip`` siblings in the same artifact).
    """
    match = _APPX_VERSION_RE.search(str(filename))
    return match.group("version") if match else None


def parse_windows_store_package_version(filename):
    """Read the version out of an AppX/MSIX Store package filename.

    ``container-desktop-x64-5.3.11.msix`` -> ``5.3.11``. Returns ``None`` when
    the name is not a Windows Store package (e.g. the ``.exe``/``.zip`` siblings
    in the same artifact).
    """
    match = _WINDOWS_STORE_PACKAGE_VERSION_RE.search(str(filename))
    return match.group("version") if match else None
