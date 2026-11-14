// Host test for Slippy/Utils/TabBarVisibility.swift (Foundation only): the floating tab bar shows only while the selected
// tab is at its root screen. Run: node ios/scripts/verify-tab-bar-visibility.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = new URL('../Slippy/Utils/TabBarVisibility.swift', import.meta.url).pathname;
assert(readFileSync(source, 'utf8').includes('struct TabBarVisibility'), 'TabBarVisibility.swift is missing');

const directory = mkdtempSync(join(tmpdir(), 'slippy-tab-bar-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }

var v = TabBarVisibility()
check(v.isVisible(selectedTab: 0), "at launch, before any root reports, the bar is shown")
v.rootAppeared(tab: 0)
check(v.isVisible(selectedTab: 0), "root on screen -> shown")

// push a screen (the chat room): the root disappears
v.rootDisappeared(tab: 0)
check(!v.isVisible(selectedTab: 0), "a pushed screen hides the bar")
// a deeper push reports nothing new: still hidden
check(!v.isVisible(selectedTab: 0), "still hidden at any depth")
// pop back to the root
v.rootAppeared(tab: 0)
check(v.isVisible(selectedTab: 0), "back at the root -> shown again")

// switching tabs: the old root disappears and the new one appears, in either order
v.rootDisappeared(tab: 0); v.tabSelected(1)
check(v.isVisible(selectedTab: 1), "new tab shown before its root reports (old root reported first)")
v.rootAppeared(tab: 1)
check(v.isVisible(selectedTab: 1), "new tab shown after its root reports")
var w = TabBarVisibility()
w.rootAppeared(tab: 0); w.tabSelected(1); w.rootAppeared(tab: 1); w.rootDisappeared(tab: 0)
check(w.isVisible(selectedTab: 1), "old root reporting LAST does not hide the new tab's bar")

// tab 0 was left on a pushed screen; coming back rebuilds it at its root: no stale hidden state
var x = TabBarVisibility()
x.rootAppeared(tab: 0); x.rootDisappeared(tab: 0)            // pushed
x.tabSelected(1); x.rootAppeared(tab: 1)                     // go to tab 1
x.tabSelected(0)                                             // come back
check(x.isVisible(selectedTab: 0), "returning to a tab does not start hidden")
x.rootAppeared(tab: 0)
check(x.isVisible(selectedTab: 0), "and stays shown once its root reports")

// a pushed screen in one tab never hides another tab's bar
var y = TabBarVisibility()
y.rootDisappeared(tab: 3)
check(y.isVisible(selectedTab: 0) && !y.isVisible(selectedTab: 3), "state is per tab")

// swipe-back started then cancelled: root appears, then disappears again
var z = TabBarVisibility()
z.rootAppeared(tab: 0); z.rootDisappeared(tab: 0); z.rootAppeared(tab: 0); z.rootDisappeared(tab: 0)
check(!z.isVisible(selectedTab: 0), "a cancelled swipe-back ends hidden")

if failures > 0 { print("\\(failures) failure(s)"); exit(1) }
print("PASS: tab bar visibility")
`);
  const bin = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', source, main, '-module-cache-path', join(directory, 'modcache'), '-o', bin], { stdio: 'inherit' });
  process.stdout.write(execFileSync(bin, { encoding: 'utf8' }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
