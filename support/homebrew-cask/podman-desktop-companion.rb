cask "podman-desktop-companion" do
  arch arm: "arm64", intel: "x64"

  version "5.2.2-rc.1"
  sha256 arm:   "766e95f921ec223ade4ba06e82558a77cd890962f2a4e25d41a047d88c1b10bf",
         intel: "1b8431448986e6b110c68166ba09dacc1f7e632ed21e398e2f94ab24d5328daf"

  url "https://github.com/iongion/podman-desktop-companion/releases/podman-desktop-companion-#{arch}-#{version}.dmg",
      verified: "github.com/iongion/podman-desktop-companion/"
  name "Podman Desktop Companion"
  desc "General purpose container operations"
  homepage "https://iongion.github.io/podman-desktop-companion/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :catalina"

  app "Podman Desktop Companion.app"

  uninstall quit:   "io.github.iongion.PodmanDesktopCompanion",
            delete: "/Applications/Podman Desktop Companion.app",
            trash:  "~/Library/LaunchAgents/io.podman_desktop.PodmanDesktopCompanion.plist"

  zap trash: [
    "~/.local/share/podman-desktop-companion",
    "~/Library/Application Support/Podman Desktop Companion",
    "~/Library/Preferences/io.github.iongion.PodmanDesktopCompanion.plist",
    "~/Library/Saved Application State/io.github.iongion.PodmanDesktopCompanion.savedState",
  ]
end
