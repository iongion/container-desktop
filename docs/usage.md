# General purpose guidelines

## How to deal with no code-signing

> IMPORTANT: Code signing should not be bypassed or avoided, it is much safer to clone the repo and create local builds than to download binaries that are not signed and force their installation.

### MacOS

- Allow unsigned application to execute - `xattr -d com.apple.quarantine /Applications/Container\ Desktop.app`

```bash
brew install colima
brew install docker
```

### Windows

- Download the application from Microsoft Store, it is digitally signed, courtesy of Microsoft. You can also install it using

```bash
winget install "Docker.DockerCLI"
winget install "Container Desktop"
```

### Linux

- Allow `*.AppImage` to execute - see <https://github.com/AppImage/AppImageKit/wiki/FUSE>
- See <https://github.com/boredsquirrel/dont-use-appimages> for some critique of `*.AppImage` format - see <https://mijorus.it/projects/gearlever/>
- Allow `*.flatpak` on Ubuntu - see <https://flatpak.org/setup/Ubuntu> - See <https://github.com/tchx84/Flatseal>
- See <https://ludocode.com/blog/flatpak-is-not-the-future> for some critique of `*.flatpak` format

#### AppImage fails to start with an EGL / graphics error

On some rolling-release distributions (Void, Arch, recent Fedora, …) an older AppImage can abort at
startup with:

```text
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

This happens when the AppImage bundles its own graphics libraries (`libEGL`, `libGL`, `libgbm`,
`libwayland-*`) and they clash with the host's newer Mesa/Wayland stack. Newer builds strip those
libraries during packaging so the app uses the host's copies. If you hit this on an affected build:

- Prefer the `*.deb` / `*.rpm` package or the `*.tar.gz` portable build, which do not bundle these
  libraries; or
- Work around it on an existing AppImage by extracting it and removing the bundled graphics libraries:

  ```bash
  ./container-desktop-linux-x86_64-*.AppImage --appimage-extract
  rm -f squashfs-root/usr/lib/*EGL*so* squashfs-root/usr/lib/*GL*so* \
        squashfs-root/usr/lib/*gbm*so* squashfs-root/usr/lib/*wayland*so*
  ./squashfs-root/AppRun
  ```
