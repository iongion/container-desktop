const APP_NAME = "container-desktop";

function artifactName(platform, arch, version, ext) {
  const platformPart = platform ? `${platform}-` : "";
  return `${APP_NAME}-${platformPart}${arch}-${version}.${ext}`;
}

function linuxArtifactName(arch, version, ext) {
  return artifactName("linux", arch, version, ext);
}

function macArtifactName(arch, version, ext) {
  return artifactName("mac", arch, version, ext);
}

function winArtifactName(arch, version, ext) {
  return artifactName("", arch, version, ext);
}

module.exports = {
  linuxArtifactName,
  macArtifactName,
  winArtifactName,
};
