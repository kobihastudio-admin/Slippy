import assert from "node:assert/strict"
import test from "node:test"
import { appleMapsDirectionsUrl, appleMapsPinUrl } from "./apple-maps-links.ts"

test("appleMapsPinUrl preserves a coordinate and human-readable label", () => {
  const url = new URL(appleMapsPinUrl([33.5902, 130.4017], "Fukuoka Airport"))
  assert.equal(url.origin, "https://maps.apple.com")
  assert.equal(url.searchParams.get("ll"), "33.5902,130.4017")
  assert.equal(url.searchParams.get("q"), "Fukuoka Airport")
})

test("appleMapsDirectionsUrl opens driving directions to the requested stop", () => {
  const url = new URL(appleMapsDirectionsUrl({ destination: [32.8031, 130.7079], label: "Kumamoto Castle" }))
  assert.equal(url.searchParams.get("daddr"), "32.8031,130.7079")
  assert.equal(url.searchParams.get("dirflg"), "d")
  assert.equal(url.searchParams.get("q"), "Kumamoto Castle")
})
