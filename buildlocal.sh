#!/bin/bash
# Builds the unsigned IPA on this Mac, the same way check.yml does on GitHub, and copies it to
# iCloud Drive for sideloading. Saves waiting for a GitHub macOS runner.
#
# Builds the last commit (what is pushed), in a temporary copy: the repo itself stays untouched
# (xcodegen, the icon catalog and the plist edits only happen in the copy).
# Needs Xcode and xcodegen (brew install xcodegen).

set -e
cd "$(dirname "$0")"
REPO="$(pwd)"
WORK="${TMPDIR:-/tmp}/twitchunblock-ipa"
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"

# Same version as CI: VERSION + app commits since it changed. CFBundleVersion: CI uses its run
# number; here the commit count (only needs to grow, the sideloading tool ignores it).
BASE=$(tr -d ' \n\r' < VERSION)
SINCE=$(git log -1 --format=%H -- VERSION)
PATCH=$(git rev-list --count --no-merges "$SINCE"..HEAD -- Sources Shared Widgets Info.plist project.yml buildipa.sh assets/icon.png assets/icons)
VERSION="$BASE.$PATCH"
BUILD=$(git rev-list --count HEAD)
echo "--- TwitchUnblock $VERSION ($BUILD), commit $(git rev-parse --short HEAD) ---"
if [ -n "$(git status --porcelain -- Sources Shared Widgets Info.plist project.yml)" ]; then
  echo "Note: uncommitted changes are not in this build (it builds the last commit)."
fi

rm -rf "$WORK"
mkdir -p "$WORK"
git archive HEAD | tar -x -C "$WORK"
cd "$WORK"

# ── Icons (check.yml: Create App Icon Folder) ──
CAT=Sources/Assets.xcassets
make_icon() {
  dir="$CAT/$1.appiconset"; mkdir -p "$dir"
  cp "$2" "$dir/icon.png"
  cp "assets/icons/$3-dark.png" "$dir/icon-dark.png"
  cp "assets/icons/$3-tinted.png" "$dir/icon-tinted.png"
  cat > "$dir/Contents.json" <<EOF
{
  "images" : [
    { "filename" : "icon.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    { "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ],
      "filename" : "icon-dark.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    { "appearances" : [ { "appearance" : "luminosity", "value" : "tinted" } ],
      "filename" : "icon-tinted.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
EOF
}
make_preview() {
  dir="$CAT/IconPreview-$1.imageset"; mkdir -p "$dir"
  cp "assets/icons/previews/$1.png" "$dir/preview.png"
  cat > "$dir/Contents.json" <<EOF
{
  "images" : [ { "filename" : "preview.png", "idiom" : "universal" } ],
  "info" : { "author" : "xcode", "version" : 1 }
}
EOF
}
make_icon AppIcon assets/icon.png AppIcon
for name in Default Purple Night Light Contrast Neon; do make_preview "$name"; done

# ── Project (check.yml: Inject XcodeGen Settings, Generate Xcode Project) ──
sed -i '' "s/PRODUCT_NAME: TwitchUnblock$/PRODUCT_NAME: TwitchUnblock\n        MARKETING_VERSION: $VERSION\n        CURRENT_PROJECT_VERSION: $BUILD\n        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon/g" project.yml
xcodegen generate --spec project.yml --quiet

# ── Info.plist (check.yml: Post-Generation Fix) ──
APP_PLIST=./Info.plist
plutil -replace CFBundleIdentifier -string "com.mxfia19.TwitchUnblock" "$APP_PLIST"
plutil -replace TUChannel -string "stable" "$APP_PLIST"
for P in "$APP_PLIST" ./Widgets/Info.plist; do
  plutil -replace CFBundleShortVersionString -string "$VERSION" "$P"
  plutil -replace CFBundleVersion -string "$BUILD" "$P"
done
plutil -replace CFBundleIconName -string "AppIcon" "$APP_PLIST"
plutil -replace TUPingKey -string "" "$APP_PLIST"
plutil -remove UILaunchStoryboardName "$APP_PLIST" 2>/dev/null || true
plutil -replace UILaunchScreen -xml "<dict/>" "$APP_PLIST"
plutil -replace UIBackgroundModes -json '["audio","fetch"]' "$APP_PLIST"

# ── Build (check.yml: Build iOS IPA) ──
chmod +x ./buildipa.sh
if ! ./buildipa.sh > build.log 2>&1; then
  grep -E "error:" build.log | sort -u | head -40
  echo "Build failed, full log: $WORK/build.log"
  exit 1
fi

cp build/TwitchUnblock.ipa "$ICLOUD/TwitchUnblock.ipa"
echo "--- Done: TwitchUnblock $VERSION in iCloud Drive (TwitchUnblock.ipa) ---"
