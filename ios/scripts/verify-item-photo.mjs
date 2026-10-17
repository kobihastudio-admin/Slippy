import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ios = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = process.argv[2];
assert(packageRoot, 'Pass the resolved supabase-swift checkout path');
const vm = fs.readFileSync(path.join(ios, 'Slippy/ViewModels/TripsViewModel.swift'), 'utf8');
const ui = fs.readFileSync(path.join(ios, 'Slippy/Views/Trips/JourneyPrototypeView.swift'), 'utf8');

// Compile the actual payload types and selection block, not a parallel implementation.
function block(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, `Missing ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 1;
  let end = open + 1;
  for (; depth && end < source.length; end++) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
  }
  return { declaration: source.slice(start, end), body: source.slice(open + 1, end - 1) };
}
const fields = block(vm, 'struct TripItemFields').declaration;
const row = block(vm, 'private struct ItemRow').declaration.replace('private struct', 'struct');
const selection = block(ui, 'if photoChanged').body;
assert(ui.includes('FormCard(title: "รูปของรายการ"'));
assert(ui.includes('guard !saving, !loadingPhoto, canSave'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'slippy-item-photo-tests-'));
try {
  const models = fs.readFileSync(path.join(ios, 'Slippy/Models/TripModels.swift'), 'utf8').replace('import Supabase', '');
  fs.writeFileSync(path.join(temporary, 'Models.swift'), models);
  fs.writeFileSync(path.join(temporary, 'Payload.swift'), `import Foundation\nstruct TripsViewModel {\n${fields}\n${row}\n}`);
  fs.writeFileSync(path.join(temporary, 'main.swift'), `
import Foundation
func payload(item: TripItineraryItem?, changed: Bool, path: String?, asset: String?) throws -> [String: Any] {
    var fields = TripsViewModel.TripItemFields(type: "activity", title: "Test", status: "planned")
    let photoChanged = changed, photoPath = path, photoAsset = asset
    if photoChanged { ${selection} }
    let data = try JSONEncoder().encode(TripsViewModel.ItemRow(day_id: nil, sort_order: nil, f: fields))
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
}
let item = try JSONDecoder().decode(TripItineraryItem.self, from: Data(#"{"id":"item","day_id":"day","sort_order":0,"type":"activity","title":"Test","details":{"phone":"123","address":"Kyushu","payment_status":"paid","photo_path":"trip/old.jpg","photo_asset":"Old"}}"#.utf8))
assert(item.itemPhotoPath == "trip/old.jpg")
assert(item.itemPhotoAsset == "Old")
let unchanged = try payload(item: item, changed: false, path: nil, asset: nil)
assert(unchanged["details"] == nil)
let remote = try payload(item: item, changed: true, path: "trip/new.jpg", asset: nil)["details"] as! [String: String]
assert(remote == ["phone":"123", "address":"Kyushu", "payment_status":"paid", "photo_path":"trip/new.jpg"])
let bundled = try payload(item: item, changed: true, path: nil, asset: "KyushuYufuin")["details"] as! [String: String]
assert(bundled == ["phone":"123", "address":"Kyushu", "payment_status":"paid", "photo_asset":"KyushuYufuin"])
let automatic = try payload(item: item, changed: true, path: nil, asset: nil)["details"] as! [String: String]
assert(automatic == ["phone":"123", "address":"Kyushu", "payment_status":"paid"])
let newItem = try payload(item: nil, changed: true, path: "trip/new.jpg", asset: nil)["details"] as! [String: String]
assert(newItem == ["photo_path":"trip/new.jpg"])
print("7 item-photo model/payload checks passed")
`);
  const jsonDirectory = path.join(packageRoot, 'Sources/Helpers/AnyJSON');
  const executable = path.join(temporary, 'verify');
  const compile = spawnSync('xcrun', ['swiftc', path.join(jsonDirectory, 'AnyJSON.swift'), path.join(temporary, 'Models.swift'), path.join(temporary, 'Payload.swift'), path.join(temporary, 'main.swift'), '-o', executable], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  const run = spawnSync(executable, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  process.stdout.write(run.stdout);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
