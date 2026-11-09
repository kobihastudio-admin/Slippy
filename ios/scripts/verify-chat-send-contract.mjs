import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../Slippy/ViewModels/MessagesViewModel.swift', import.meta.url), 'utf8');
const start = source.indexOf('func sendMessage(');
assert(start >= 0, 'sendMessage is missing');

const declaration = source.slice(Math.max(0, start - 40), source.indexOf('{', start));
assert(declaration.includes('@discardableResult'), 'sendMessage must be @discardableResult');
assert(/async\s*->\s*Bool/.test(declaration), 'sendMessage must return Bool');

const body = source.slice(start);
const marker = '// MESSAGE STORED:';
const markerAt = body.indexOf(marker);
assert(markerAt > 0, `missing "${marker}" marker separating insert from the best-effort touch`);

const beforeStored = body.slice(0, markerAt);
const afterStored = body.slice(markerAt, body.indexOf('\n    }\n', markerAt) === -1 ? undefined : body.indexOf('\n    }\n', markerAt));

const falseReturns = (beforeStored.match(/return false/g) || []).length;
assert(falseReturns >= 2, `expected guard + insert-failure "return false" before the marker, found ${falseReturns}`);
assert(!/return false/.test(afterStored), 'a failure AFTER the message is stored must not return false (it would restore the draft and duplicate the message)');
assert(/return true/.test(afterStored), 'sendMessage must return true once the message is stored');
assert(/self\.error\s*=/.test(afterStored), 'a touch failure must still be recorded in error');

const fixtureGuards = (source.match(/isFixture/g) || []).length;
assert(fixtureGuards >= 4, `isFixture must be declared and guard load/load/send (found ${fixtureGuards} mentions)`);
assert(/#if DEBUG[\s\S]*var isFixture/.test(source), 'isFixture must be DEBUG-only');

console.log('PASS: chat send contract (Bool result, touch failure keeps success, DEBUG-only fixture guard)');
