cask "zak-desktop" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "https://github.com/zeemrx0/zak-app/releases/download/v#{version}/zak-desktop-#{version}-arm64.zip"
  name "zAgentKit"
  desc "Desktop app for managing agent kit installs with the zak CLI"
  homepage "https://github.com/zeemrx0/zak-app"

  depends_on arch: :arm64
  depends_on :macos

  app "zAgentKit.app"

  postflight_steps do
    run "/usr/bin/xattr",
        args:           ["-dr", "com.apple.quarantine", "{{appdir}}/zAgentKit.app"],
        writable_paths: ["zAgentKit.app"],
        writable_base:  :appdir,
        must_succeed:   false
  end

  uninstall quit: "dev.supercent.zak-desktop"

  zap trash: [
    "~/Library/Application Support/dev.supercent.zak-desktop",
    "~/Library/Caches/dev.supercent.zak-desktop",
    "~/Library/Preferences/dev.supercent.zak-desktop.plist",
    "~/Library/Saved Application State/dev.supercent.zak-desktop.savedState",
  ]
end
