// Behaviour test for Slippy/Services/DocumentFileDownloader.swift (Foundation only), run against a throwaway local HTTP
// server that answers the way storage can: a real file, a file without an extension, an HTML error page with status 200,
// a 404 and an empty body. No network, no Supabase, no user data.
// Run: node ios/scripts/verify-document-download.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const sources = ['Utils/DocumentFileSupport.swift', 'Services/DocumentFileDownloader.swift']
  .map((name) => new URL(`../Slippy/${name}`, import.meta.url).pathname);

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const routes = {
  '/ok.png':      { status: 200, type: 'image/png', body: png },
  '/scan':        { status: 200, type: 'image/jpeg', body: Buffer.from('jpegbytes') },
  '/invoice.pdf': { status: 200, type: 'application/pdf', body: Buffer.from('%PDF-1.4 fake') },
  '/err.html':    { status: 200, type: 'text/html', body: Buffer.from('<html>error</html>') },
  '/missing':     { status: 404, type: 'application/json', body: Buffer.from('{"error":"not found"}') },
  '/empty.png':   { status: 200, type: 'image/png', body: Buffer.alloc(0) },
};
const server = createServer((req, res) => {
  const r = routes[req.url];
  if (!r) { res.writeHead(404); res.end(); return; }
  res.writeHead(r.status, { 'Content-Type': r.type, 'Content-Length': r.body.length });
  res.end(r.body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const directory = mkdtempSync(join(tmpdir(), 'slippy-document-download-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }
let base = CommandLine.arguments[1]
let docId = "0a1b2c3d-1111-4222-8333-444455556666"
let shareRoot = FileManager.default.temporaryDirectory.appendingPathComponent("slippy-share").standardizedFileURL

func attempt(_ path: String, filePath: String) async -> (URL?, String?) {
    do { return (try await DocumentFileDownloader.download(from: URL(string: base + path)!, filePath: filePath, documentId: docId), nil) }
    catch { return (nil, error.localizedDescription) }
}

// a normal file: right name, right bytes, inside the share folder
let (ok, okErr) = await attempt("/ok.png", filePath: "org/2026/receipt-001.png")
check(ok != nil && okErr == nil, "a normal file downloads (\\(okErr ?? ""))")
if let ok {
    check(ok.lastPathComponent == "receipt-001.png", "name comes from the stored path: \\(ok.lastPathComponent)")
    check((try? Data(contentsOf: ok)) == Data([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52]), "the bytes are the server's")
    check(ok.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL.path == shareRoot.path, "written under <tmp>/slippy-share/<uuid>/: \\(ok.path)")
}

// no extension in the stored path: it comes from the response's content type
let (scan, _) = await attempt("/scan", filePath: "org/scan")
check(scan?.lastPathComponent == "scan.jpg", "no extension -> from content type: \\(scan?.lastPathComponent ?? "nil")")
// the next download removed the previous copy, so copies never pile up
check(ok != nil && !FileManager.default.fileExists(atPath: ok!.path), "an earlier copy is purged by the next download")

let (pdf, _) = await attempt("/invoice.pdf", filePath: "org/invoice.pdf")
check(pdf?.lastPathComponent == "invoice.pdf", "pdf keeps its name")

// failures never leave a file, and say why
let (html, htmlErr) = await attempt("/err.html", filePath: "org/x.png")
check(html == nil && (htmlErr ?? "").contains("ไม่ใช่เอกสาร"), "an HTML error page served with 200 is refused: \\(htmlErr ?? "nil")")
let (missing, missingErr) = await attempt("/missing", filePath: "org/x.png")
check(missing == nil && (missingErr ?? "").contains("404"), "a 404 is reported with its code: \\(missingErr ?? "nil")")
let (empty, emptyErr) = await attempt("/empty.png", filePath: "org/x.png")
check(empty == nil && (emptyErr ?? "").contains("ว่างเปล่า"), "an empty body is refused: \\(emptyErr ?? "nil")")
let (refused, _) = await { () async -> (URL?, String?) in
    do { return (try await DocumentFileDownloader.download(from: URL(string: "http://127.0.0.1:1/never")!, filePath: "a.png", documentId: docId), nil) }
    catch { return (nil, error.localizedDescription) }
}()
check(refused == nil, "an unreachable server is an error")

// discard removes only the copy's own folder, and nothing outside the share folder
if let pdf {
    DocumentFileDownloader.discard(pdf)
    check(!FileManager.default.fileExists(atPath: pdf.path), "discard removes the file")
    check(!FileManager.default.fileExists(atPath: pdf.deletingLastPathComponent().path), "...and its folder")
}
let foreignFolder = FileManager.default.temporaryDirectory.appendingPathComponent("slippy-foreign-\\(UUID().uuidString)")
try FileManager.default.createDirectory(at: foreignFolder, withIntermediateDirectories: true)
let foreign = foreignFolder.appendingPathComponent("keep.txt")
try Data("x".utf8).write(to: foreign)
DocumentFileDownloader.discard(foreign)
check(FileManager.default.fileExists(atPath: foreign.path), "discard never deletes outside slippy-share")
try? FileManager.default.removeItem(at: foreignFolder)
try? FileManager.default.removeItem(at: shareRoot)

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: document download (name, bytes, purge, refusals, discard)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', ...sources, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  const code = await new Promise((resolve) => {
    const child = spawn(binary, [base], { stdio: 'inherit' });
    child.on('exit', resolve);
  });
  assert.equal(code, 0, 'the Swift checks failed');
} finally {
  server.close();
  rmSync(directory, { recursive: true, force: true });
}
