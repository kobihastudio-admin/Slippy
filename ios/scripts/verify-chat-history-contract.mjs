// Source-contract test: the chat view model and room view must use ChatPaging (newest-page history, merge on
// refresh, exact direct-room lookup) and the room must not jump to the bottom when older messages are prepended.
// The pure rules themselves are tested by verify-chat-paging.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vm = readFileSync(new URL('../Slippy/ViewModels/MessagesViewModel.swift', import.meta.url), 'utf8');
const room = readFileSync(new URL('../Slippy/Views/Chat/FriendChatRoomView.swift', import.meta.url), 'utf8');

function body(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `${signature} is missing`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  assert.fail(`unbalanced braces after ${signature}`);
}

// --- messages conform to the paging protocol ---
assert(/extension\s+FriendMessage\s*:\s*PagedMessage/.test(vm + readFileSync(new URL('../Slippy/Models/MessageModels.swift', import.meta.url), 'utf8')),
  'FriendMessage must conform to PagedMessage');

// --- newest page first, merged, never "oldest 100" ---
const load = body(vm, 'func loadMessages(');
assert(load.includes('.order("created_at", ascending: false)'), 'loadMessages must read newest first');
assert(load.includes('.limit(ChatPaging.pageSize)'), 'loadMessages must read one page');
assert(!load.includes('ascending: true'), 'loadMessages must not read oldest first');
assert(!/\.limit\(100\)/.test(load), 'the oldest-100 query must be gone');
assert(load.includes('ChatPaging.merge('), 'the refresh must MERGE a page, not replace what is on screen');

// --- older pages ---
const older = body(vm, 'func loadOlder(');
assert(older.includes('ChatPaging.cursorValue('), 'loadOlder must build the cursor with ChatPaging.cursorValue (no raw "+")');
assert(older.includes('.lte("created_at"'), 'loadOlder reads rows at or before the oldest loaded one (ties are removed by the merge)');
assert(older.includes('ChatPaging.hasMoreOlder('), 'loadOlder must decide has-more with ChatPaging.hasMoreOlder');
assert(older.includes('.order("created_at", ascending: false)'), 'loadOlder reads newest-first within the older range');
assert(/func hasOlder\(/.test(vm), 'the view model must expose hasOlder(_:)');

// --- direct room: only a direct room of exactly the two people ---
const direct = body(vm, 'func getOrCreateDirectConversation(');
assert(direct.includes('ChatPaging.pickDirectConversation('), 'direct lookup must use ChatPaging.pickDirectConversation');
assert(direct.includes('.eq("type", value: "direct")'), 'direct lookup must only consider type = direct');
assert(!direct.includes('.limit(1)'), 'the "first shared room of any kind" query must be gone');

// --- re-entering a room must count as a FIRST page (review finding: otherwise messages that arrived while the reader
// was away, beyond the newest page, are merged around and silently skipped) ---
const reset = body(vm, 'func resetRoom(');
assert(/messages\.removeAll\s*\{[^}]*conversationId/.test(reset) || /messages\s*=\s*messages\.filter\s*\{[^}]*!=\s*conversationId/.test(reset),
  'resetRoom must drop this room\'s loaded messages');
assert(reset.includes('setHasOlder(false'), 'resetRoom must clear the older-messages flag of the room');
assert(reset.includes('isFixture'), 'resetRoom must leave fixture data alone');

// --- the room view ---
assert(!room.includes('.onChange(of: vm.messages)'),
  'scrolling to the bottom must not follow every change of the list (loading older messages would jump the view)');
assert(room.includes('visibleMessages.last?.id'), 'scroll to the bottom only when the NEWEST message changes');
assert(room.includes('vm.hasOlder(conversationId)') && room.includes('vm.loadOlder('), 'the room must offer "load older messages"');
assert(room.includes('proxy.scrollTo('), 'after prepending older messages the room must keep the reader where they were');
const task = body(room, '.task');
assert(task.indexOf('vm.resetRoom(conversationId)') >= 0 && task.indexOf('vm.resetRoom(conversationId)') < task.indexOf('vm.loadMessages('),
  'entering the room must reset it BEFORE the first loadMessages');

console.log('PASS: chat history contract (newest page, merge, older pages, exact direct room, stable scroll)');
