# General purpose guidelines

## How to deal with no code-signing

> IMPORTANT: Code signing should not be bypassed or avoided, it is much safer to clone the repo and create local builds than to download binaries that are not signed and force their installation.

### MacOS

- Allow unsigned application to execute - `xattr -d com.apple.quarantine /Applications/Container\ Desktop.app`

### Windows

- Download the application from Microsoft Store, it is digitally signed, courtesy of Microsoft. You can also install it using `winget install "Container Desktop"`

### Linux

- Allow `*.AppImage` to execute - see <https://github.com/AppImage/AppImageKit/wiki/FUSE>
- See <https://github.com/boredsquirrel/dont-use-appimages> for some critique of `*.AppImage` format - see <https://mijorus.it/projects/gearlever/>
- Allow `*.flatpak` on Ubuntu - see <https://flatpak.org/setup/Ubuntu> - See <https://github.com/tchx84/Flatseal>
- See <https://ludocode.com/blog/flatpak-is-not-the-future> for some critique of `*.flatpak` format
