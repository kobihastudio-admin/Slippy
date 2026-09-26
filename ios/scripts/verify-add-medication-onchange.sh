#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
VIEW_FILE="$PROJECT_ROOT/ios/Slippy/Views/Health/AddMedicationView.swift"

if ! rg -Fq '.onChange(of: isBedtime) { _, newValue in' "$VIEW_FILE"; then
  echo "AddMedicationView must use the iOS 17 two-parameter onChange closure" >&2
  exit 1
fi

if rg -Fq '.onChange(of: isBedtime) { newValue in' "$VIEW_FILE"; then
  echo "Deprecated one-parameter onChange closure remains" >&2
  exit 1
fi

echo "AddMedicationView onChange verification passed"
