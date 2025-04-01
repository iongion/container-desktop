cask "container-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.2.15"
  sha256 arm:   "766e95f921ec223ade4ba06e82558a77cd890962f2a4e25d41a047d88c1b10bf",
         intel: "1b8431448986e6b110c68166ba09dacc1f7e632ed21e398e2f94ab24d5328daf"

  url "https://github.com/iongion/container-desktop/releases/container-desktop-#{arch}-#{version}.dmg",
      verified: "github.com/iongion/container-desktop/"
  name "Container Desktop"
  desc "General purpose container operations"
  homepage "https://container-desktop.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :catalina"

  app "Container Desktop.app"

  uninstall quit:   "io.github.iongion.ContainerDesktop",
            delete: "/Applications/Container Desktop.app",
            trash:  "~/Library/LaunchAgents/io.podman_desktop.ContainerDesktop.plist"

  zap trash: [
    "~/.local/share/container-desktop",
    "~/Library/Application Support/Container Desktop",
    "~/Library/Preferences/io.github.iongion.ContainerDesktop.plist",
    "~/Library/Saved Application State/io.github.iongion.ContainerDesktop.savedState",
  ]
end
