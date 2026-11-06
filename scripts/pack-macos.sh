#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source_dir="${BEAD_SOURCE_DIR:-$root}"
output="${BEAD_OUTPUT_DIR:-$root/release/macos}"
archive="${NODE_ARCHIVE:-}"
expected='f84b69c5e25f44efa65808e6026a604fa94086b312d2acbdb3366feb919c2fd822272e72ded8708637055eee530483e37dd1fb6b4fdb6a6f30ae8597d1f3f246'
[ "$(uname -s)-$(uname -m)" = Darwin-arm64 ] || { echo '需要 Apple 芯片 Mac。' >&2; exit 1; }
[ -f "$source_dir/server/server.js" ] && [ -f "$source_dir/dist/index.html" ] && [ -f "$source_dir/package.json" ] || { echo '缺少 server/server.js、package.json 或 dist/index.html；请先构建项目。' >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if [ -z "$archive" ]; then
  archive="$tmp/node.tgz"
  curl -fL --proto '=https' --tlsv1.2 'https://registry.npmjs.org/node-bin-darwin-arm64/-/node-bin-darwin-arm64-22.16.0.tgz' -o "$archive"
fi
[ "$(shasum -a 512 "$archive" | awk '{print $1}')" = "$expected" ] || { echo 'Node 运行时 SHA-512 校验失败。' >&2; exit 1; }
tar -xzf "$archive" -C "$tmp" package/bin/node package/LICENSE
[ "$("$tmp/package/bin/node" --version)" = v22.16.0 ] || { echo 'Node 版本不匹配。' >&2; exit 1; }
file "$tmp/package/bin/node" | grep -q 'arm64' || { echo 'Node 不是 arm64。' >&2; exit 1; }
if otool -L "$tmp/package/bin/node" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' ; then echo 'Node 依赖非系统动态库。' >&2; exit 1; fi
mkdir -p "$output"
app="$output/AI拼豆图纸.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/app"
cp "$tmp/package/bin/node" "$app/Contents/Resources/node"
cp "$tmp/package/LICENSE" "$app/Contents/Resources/Node-LICENSE.txt"
cp "$root/macos/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
ditto "$source_dir/server" "$app/Contents/Resources/app/server"
ditto "$source_dir/dist" "$app/Contents/Resources/app/dist"
cp "$source_dir/package.json" "$app/Contents/Resources/app/package.json"
for license in LICENSE NOTICE; do [ ! -f "$source_dir/$license" ] || cp "$source_dir/$license" "$app/Contents/Resources/app/$license"; done
swiftc -module-cache-path "$tmp/module-cache" -swift-version 5 -target arm64-apple-macos12.0 -O "$root/macos/Launcher.swift" -o "$app/Contents/MacOS/BeadLauncher"
file "$app/Contents/MacOS/BeadLauncher" | grep -q 'arm64' || { echo '启动器不是 arm64。' >&2; exit 1; }
if otool -L "$app/Contents/MacOS/BeadLauncher" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' ; then echo '启动器依赖非系统动态库。' >&2; exit 1; fi
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>AI拼豆图纸</string>
<key>CFBundleDisplayName</key><string>AI拼豆图纸</string>
<key>CFBundleIdentifier</key><string>local.aibeaddrawing.app</string>
<key>CFBundleExecutable</key><string>BeadLauncher</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
cp "$root/macos/使用说明.txt" "$output/使用说明.txt"
rm -f "$output/AI拼豆图纸-macOS-arm64.zip"
mkdir -p "$tmp/AI拼豆图纸-macOS-arm64"
ditto "$app" "$tmp/AI拼豆图纸-macOS-arm64/AI拼豆图纸.app"
cp "$root/macos/使用说明.txt" "$tmp/AI拼豆图纸-macOS-arm64/使用说明.txt"
ditto -c -k --sequesterRsrc --keepParent "$tmp/AI拼豆图纸-macOS-arm64" "$output/AI拼豆图纸-macOS-arm64.zip"
echo "完成：$app"
