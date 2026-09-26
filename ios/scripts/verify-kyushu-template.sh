#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
TEMPLATE_FILE="$PROJECT_ROOT/ios/Slippy/Views/Trips/JourneyPrototypeView.swift"

assert_contains() {
  local expected="$1"
  if ! rg -Fq "$expected" "$TEMPLATE_FILE"; then
    echo "Missing Kyushu template value: $expected" >&2
    exit 1
  fi
}

assert_absent() {
  local unexpected="$1"
  if rg -Fq "$unexpected" "$TEMPLATE_FILE"; then
    echo "Stale Kyushu template value remains: $unexpected" >&2
    exit 1
  fi
}

assert_contains 'KYUSHU AUTUMN ESCAPE · 2026'
assert_contains 'Sakura 401 · Hakata → Kumamoto'
assert_contains '07:58'
assert_contains 'AVIS Kumamoto Station · #00010850016'
assert_contains 'Sakura 772 · Kumamoto → Hakata'
assert_contains '19:38'
assert_contains 'AVIS Hakata Station Chikushi Exit · #00010859204'
assert_contains 'Yufuin Bath Satoyamasafu'
assert_contains 'คืนรถ AVIS Hakata Station Chikushi Exit'
assert_contains '19:00'
assert_contains 'JR Kyushu Hotel Blossom Hakata Chuo'
assert_contains 'เที่ยวบิน 11:00 น.'
assert_absent 'รับรถเช่า (รอตัดสินใจ)'
assert_absent 'คืนรถเช่า", "Kumamoto Station Shinkansen Exit'

day_count="$(sed -n '/private static let kyushuTemplate:/,/^    ]/p' "$TEMPLATE_FILE" | rg -c '\.init\(date:')"
if [[ "$day_count" -ne 8 ]]; then
  echo "Expected 8 Kyushu itinerary days, found $day_count" >&2
  exit 1
fi

echo "Kyushu template verification passed"
