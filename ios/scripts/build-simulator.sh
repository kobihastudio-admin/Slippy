#!/bin/sh
set -eu

# Do not pass `-sdk iphonesimulator` here. Slippy embeds a watchOS target;
# forcing one SDK across the scheme makes actool evaluate Watch AppIcon as an
# iOS icon set and report that it has no applicable content.
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DERIVED_DATA_PATH=${SLIPPY_DERIVED_DATA_PATH:-/private/tmp/slippy-simulator-derived}
DESTINATION=${SLIPPY_SIMULATOR_DESTINATION:-platform=iOS Simulator,name=iPhone 16 Pro,OS=26.5}

exec xcodebuild \
  -project "$PROJECT_DIR/Slippy.xcodeproj" \
  -scheme Slippy \
  -destination "$DESTINATION" \
  -configuration Debug \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  ONLY_ACTIVE_ARCH=YES \
  build
