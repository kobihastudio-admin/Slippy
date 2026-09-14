/**
 * Vendor-registry verification — run with:  npm run verify:vendor-registry
 * Exercises the pure core of the Tax ID → official-name resolver: id
 * normalization, provider-chain ordering, name reconciliation, and the DBD
 * OpenAPI parser. No network, no DB, no LLM.
 */
import assert from "node:assert/strict"
import {
  normalizeTaxId, resolveJuristic, reconcileVendorName, parseDbdOpenApi, parseAiVendorResponse,
  mockProvider, type VendorRegistryProvider, type JuristicRecord,
} from "../pipeline/vendor-registry"

let passed = 0, failed = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✅ ${name}`) })
    .catch(err => { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) })
}

async function main() {
  console.log("\n▶ normalizeTaxId\n")

  await check("accepts a clean 13-digit id", () => {
    assert.equal(normalizeTaxId("0105561207571"), "0105561207571")
  })
  await check("strips formatting (dashes/spaces)", () => {
    assert.equal(normalizeTaxId("0-1055-61207-57-1"), "0105561207571")
    assert.equal(normalizeTaxId(" 0105 5612 07571 "), "0105561207571")
  })
  await check("rejects wrong length / junk / nullish", () => {
    assert.equal(normalizeTaxId("12345"), null)
    assert.equal(normalizeTaxId("01055612075710000"), null)
    assert.equal(normalizeTaxId("abcdefghijklm"), null)
    assert.equal(normalizeTaxId(null), null)
    assert.equal(normalizeTaxId(undefined), null)
  })

  console.log("\n▶ resolveJuristic — provider chain\n")

  const TAX = "0105561207571"

  await check("invalid tax id → null without touching providers", async () => {
    let touched = false
    const spy: VendorRegistryProvider = { name: "spy", async lookup() { touched = true; return null } }
    assert.equal(await resolveJuristic("nope", [spy]), null)
    assert.equal(touched, false)
  })

  await check("first provider with a hit wins; later ones not consulted", async () => {
    let secondCalled = false
    const first  = mockProvider({ [TAX]: { nameTh: "บริษัท ก จำกัด" } }, "first")
    const second: VendorRegistryProvider = { name: "second", async lookup() { secondCalled = true; return null } }
    const rec = await resolveJuristic(TAX, [first, second])
    assert.equal(rec?.nameTh, "บริษัท ก จำกัด")
    assert.equal(rec?.source, "first")
    assert.equal(secondCalled, false)
  })

  await check("falls through to the next provider on a miss", async () => {
    const first  = mockProvider({}, "first")                                   // no data
    const second = mockProvider({ [TAX]: { nameTh: "บริษัท ข จำกัด" } }, "second")
    const rec = await resolveJuristic(TAX, [first, second])
    assert.equal(rec?.nameTh, "บริษัท ข จำกัด")
    assert.equal(rec?.source, "second")
  })

  await check("a throwing provider is skipped, not fatal", async () => {
    const boom: VendorRegistryProvider = { name: "boom", async lookup() { throw new Error("502") } }
    const good = mockProvider({ [TAX]: { nameTh: "บริษัท ค จำกัด" } }, "good")
    const rec = await resolveJuristic(TAX, [boom, good])
    assert.equal(rec?.nameTh, "บริษัท ค จำกัด")
  })

  await check("normalizes the tax id onto the returned record", async () => {
    const p = mockProvider({ [TAX]: { nameTh: "บริษัท ง จำกัด" } }, "p")
    const rec = await resolveJuristic("0-1055-61207-57-1", [p])
    assert.equal(rec?.taxId, TAX)
  })

  console.log("\n▶ reconcileVendorName\n")

  const rec = (nameTh: string): JuristicRecord => ({ taxId: TAX, nameTh, source: "test" })

  await check("no registry record → keep OCR name, not official, unchanged", () => {
    const d = reconcileVendorName("ร้านลุงหนวด", null)
    assert.equal(d.name, "ร้านลุงหนวด")
    assert.equal(d.official, false)
    assert.equal(d.changed, false)
  })

  await check("official name replaces a wrong OCR reading and flags changed", () => {
    const d = reconcileVendorName("บ.ซีพ ออล", rec("บริษัท ซีพี ออลล์ จำกัด (มหาชน)"))
    assert.equal(d.name, "บริษัท ซีพี ออลล์ จำกัด (มหาชน)")
    assert.equal(d.official, true)
    assert.equal(d.changed, true)
    assert.equal(d.officialName, "บริษัท ซีพี ออลล์ จำกัด (มหาชน)")
  })

  await check("pure formatting differences are NOT a change (canonical key)", () => {
    // Same store, different spacing/legal-word punctuation → canonical keys match.
    const d = reconcileVendorName("บริษัท   ซีพีออลล์   จำกัด", rec("บริษัท ซีพีออลล์ จำกัด"))
    assert.equal(d.official, true)
    assert.equal(d.changed, false)
  })

  await check("empty OCR name → official adopted, still not a 'change' to learn", () => {
    const d = reconcileVendorName("", rec("บริษัท ง จำกัด"))
    assert.equal(d.name, "บริษัท ง จำกัด")
    assert.equal(d.official, true)
  })

  console.log("\n▶ parseDbdOpenApi\n")

  await check("parses the documented {data:[{...}]} shape incl. EN name + address object", () => {
    const json = {
      status: "success",
      data: [{
        juristicID:     TAX,
        juristicNameTH: "บริษัท ทดสอบ จำกัด",
        juristicNameEN: "TEST COMPANY LIMITED",
        juristicStatus: "ยังดำเนินกิจการอยู่",
        juristicType:   "บริษัทจำกัด",
        registerCapital: "1,000,000",
        registerDate:    "2542-01-15",
        address: { houseNumber: "40/25", soi: "77/4", street: "เพชรเกษม",
                   subDistrict: "หนองค้างพลู", district: "หนองแขม",
                   province: "กรุงเทพมหานคร", postalCode: "10160" },
      }],
    }
    const r = parseDbdOpenApi(json, TAX)
    assert.equal(r?.nameTh, "บริษัท ทดสอบ จำกัด")
    assert.equal(r?.nameEn, "TEST COMPANY LIMITED")
    assert.equal(r?.status, "ยังดำเนินกิจการอยู่")
    assert.equal(r?.entityType, "บริษัทจำกัด")
    assert.equal(r?.registeredCapital, 1000000)     // comma stripped → number
    assert.ok(r?.address?.includes("หนองแขม"))
    assert.equal(r?.source, "openapi.dbd.go.th")
  })

  await check("parses a flat (non-array) data object", () => {
    const r = parseDbdOpenApi({ data: { juristicNameTH: "หจก. ก", juristicType: "ห้างหุ้นส่วนจำกัด" } }, TAX)
    assert.equal(r?.nameTh, "หจก. ก")
    assert.equal(r?.entityType, "ห้างหุ้นส่วนจำกัด")
  })

  await check("no name in payload → null (not a phantom record)", () => {
    assert.equal(parseDbdOpenApi({ data: [{ juristicID: TAX }] }, TAX), null)
    assert.equal(parseDbdOpenApi({}, TAX), null)
    assert.equal(parseDbdOpenApi(null, TAX), null)
  })

  console.log("\n▶ parseAiVendorResponse (web-search provider)\n")

  await check("parses a clean confident JSON reply", () => {
    const r = parseAiVendorResponse('{"found": true, "nameTh": "บริษัท ทดสอบ จำกัด", "nameEn": "TEST CO", "confidence": 0.9}')
    assert.equal(r?.found, true)
    assert.equal(r?.nameTh, "บริษัท ทดสอบ จำกัด")
    assert.equal(r?.nameEn, "TEST CO")
    assert.equal(r?.confidence, 0.9)
  })

  await check("extracts JSON embedded in surrounding prose / markdown fences", () => {
    const r = parseAiVendorResponse('จากการค้นหา:\n```json\n{"found": true, "nameTh": "หจก. ก", "confidence": 0.8}\n```\nจบ')
    assert.equal(r?.nameTh, "หจก. ก")
    assert.equal(r?.found, true)
  })

  await check("found=false or empty name → not a usable hit", () => {
    assert.equal(parseAiVendorResponse('{"found": false, "nameTh": "", "confidence": 0.1}')?.found, false)
    assert.equal(parseAiVendorResponse('{"found": true, "nameTh": "", "confidence": 0.9}')?.found, false)
  })

  await check("no JSON / garbage → null", () => {
    assert.equal(parseAiVendorResponse("ขอโทษ ไม่พบข้อมูล"), null)
    assert.equal(parseAiVendorResponse(""), null)
    assert.equal(parseAiVendorResponse("{ not json"), null)
  })

  console.log("\n▶ Shop vs company — a tax id identifies the COMPANY\n")

  await check("the official name lands on company_name, shop name untouched", () => {
    // KOFUKU: the customer knows the branch; the tax id belongs to the operator.
    const doc = {
      vendor_name:  "KOFUKU Silom Complex",
      company_name: "บริษัท สยาม อัลเตอร ์กรุป จำกัด",   // OCR mangled
    }
    const d = reconcileVendorName(doc.company_name, rec("บริษัท สยาม อัลเตอร์ กรุ๊ป จำกัด"))
    assert.equal(d.official, true)
    assert.equal(d.name, "บริษัท สยาม อัลเตอร์ กรุ๊ป จำกัด", "company gets the registry name")
    assert.equal(doc.vendor_name, "KOFUKU Silom Complex", "the shop the user recognises must survive")
  })

  await check("no registry hit → both names are left exactly as read", () => {
    const d = reconcileVendorName("บริษัท ก จำกัด", null)
    assert.equal(d.name, "บริษัท ก จำกัด")
    assert.equal(d.official, false)
    assert.equal(d.changed, false)
  })

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
