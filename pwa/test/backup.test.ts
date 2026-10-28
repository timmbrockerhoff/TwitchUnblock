// Backup export/import (iOS format, merge rules): `npm test`.
import assert from 'node:assert/strict';
import { buildBackup, mergeBackup, type Snapshot } from '../src/backup.ts';

const defaults: any = { accent: '#9146ff', quality: 'source', speed: 1, topLang: 'de', homeListLayout: 'grid', showRecentChannels: true,
  chatTimestamps: true, chatShowDeleted: false, chatLoadRecent: true, chatHideBots: false, chatHideCommands: false,
  chatMutedWords: [], chatBlockedUsers: [], chatHighlightWords: [], autoPoints: true, showPinned: true, showDropsNotice: true, showStreak: true,
  showEvents: true, enableRaids: true, lowLatency: true, fillScreen: false, landscapeChat: 'column', chatFont: 13, chatSpacing: 4,
  chatBadgeScale: 1, chatEmoteScale: 1, chatWidth: 0.32, chatAutocomplete: true, sourceOrder: ['as', 'al', 'eu', 'twitch'] };
const snap = (): Snapshot => ({ settings: { ...defaults }, follows: ['alpha'], accountFollows: ['beta'],
  hiddenChannels: ['old'], hiddenInfo: { old: { name: 'Old', at: 100 } }, hiddenCategories: [{ id: '1', name: 'Cat', box: '', at: 50 }],
  favCategories: [{ id: '9', name: 'Fav', boxArt: '' }], pinned: ['alpha'], history: [{ kind: 'vod', id: '1', title: 'a', login: 'x', name: 'X', thumb: '', at: 10 }],
  progress: { '1': 100 } });

// Export: iOS keys present, the web extras under `web`.
const out = buildBackup(snap()) as any;
assert.equal(out.format, 'twitchunblock-backup');
assert.equal(out.version, 1);
assert.deepEqual(out.follows, ['alpha']);
assert.deepEqual(out.hidden.channels, [{ login: 'old', name: 'Old', at: 100 }]);
assert.equal(out.settings.homeList, false);
assert.equal(out.settings.qualityPref, 'source');
assert.equal(out.settings.ios_chatFontSize, 13);
assert.equal(out.web.pinned[0], 'alpha');
assert.ok(!('ios_immersivePlayer' in out.settings)); // never overwrite an iPhone setting with a default

// Round trip merges without duplicates.
const rt = mergeBackup(snap(), defaults, JSON.parse(JSON.stringify(out)))!;
assert.deepEqual(rt.snap.follows, ['alpha', 'beta']);
assert.equal(rt.added, 1);
assert.equal(rt.skipped, 0);
assert.deepEqual(rt.snap.hiddenChannels, ['old']);

// An iOS backup: merge (nothing removed), validation, newest hide wins, settings mapped.
const ios = { format: 'twitchunblock-backup', version: 1, platform: 'ios',
  follows: ['Gamma', 'bad login!', 'alpha'], accountFollows: ['delta'],
  followedCategories: [{ id: '2', name: 'New', box: 'https://x/b.jpg' }, { id: 'abc', name: 'invalid' }],
  hidden: { channels: [{ login: 'OLD', name: 'Newer', at: 200 }, { login: 'zeta', at: 5 }, { login: '', at: 1 }],
    categories: [{ id: '1', name: 'Cat2', at: 20 }, { id: '7', name: 'Seven', box: 'http://insecure', at: 30 }] },
  settings: { topLang: 'zh_hk', homeList: true, hideBots: true, mutedWords: ['A', 'b'], vodSpeed: 1.5, qualityPref: '936', ios_landscapeChat: 'overlay',
    ios_chatFontSize: 99, ios_showPinned: false } };
const r = mergeBackup(snap(), defaults, ios)!;
assert.deepEqual(r.snap.follows, ['alpha', 'gamma', 'delta']);
assert.equal(r.added, 2);
assert.deepEqual(r.snap.favCategories.map(c => c.id), ['9', '2']);
assert.deepEqual(r.snap.hiddenChannels, ['old', 'zeta']);
assert.equal(r.snap.hiddenInfo.old.name, 'Newer');
assert.equal(r.snap.hiddenInfo.zeta.name, 'zeta');
assert.deepEqual(r.snap.hiddenCategories.map(c => [c.id, c.name, c.box]), [['1', 'Cat', ''], ['7', 'Seven', '']]); // older stamp keeps ours, newest first
assert.equal(r.snap.settings.topLang, 'zh-hk');
assert.equal(r.snap.settings.homeListLayout, 'list');
assert.equal(r.snap.settings.chatHideBots, true);
assert.deepEqual(r.snap.settings.chatMutedWords, ['a', 'b']);
assert.equal(r.snap.settings.speed, 1.5);
assert.equal(r.snap.settings.quality, '1080');
assert.equal(r.snap.settings.landscapeChat, 'overlay');
assert.equal(r.snap.settings.chatFont, 24); // clamped
assert.equal(r.snap.settings.showPinned, false);
assert.equal(r.snap.settings.accent, '#9146ff'); // untouched

// Follow cap: 300 at most, but the ones already here all stay.
const big = { format: 'twitchunblock-backup', follows: Array.from({ length: 400 }, (_, i) => `u${i}`) };
const capped = mergeBackup(snap(), defaults, big)!;
assert.equal(capped.snap.follows.length, 300);
assert.equal(capped.added, 299);
assert.equal(capped.skipped, 101);

// Earlier web format: still readable, merged too.
const legacy = { app: 'TwitchUnblock-PWA', v: 1, settings: { accent: '#ff0000', quality: 'audio', bogus: 1 }, follows: ['legacy'],
  hiddenChannels: ['hid'], hiddenCategories: [{ id: '3', name: 'Three' }], history: [{ kind: 'vod', id: '1', title: 'newer', login: 'x', name: 'X', thumb: '', at: 20 }],
  progress: { '1': 50, '2': 70 } };
const l = mergeBackup(snap(), defaults, legacy)!;
assert.equal(l.snap.settings.accent, '#ff0000');
assert.equal(l.snap.settings.quality, 'audio');
assert.ok(!('bogus' in l.snap.settings));
assert.deepEqual(l.snap.follows, ['alpha', 'legacy']);
assert.ok(l.snap.hiddenChannels.includes('hid'));
assert.equal(l.snap.hiddenCategories.find(c => c.id === '3')?.name, 'Three');
assert.equal(l.snap.history[0].title, 'newer');
assert.deepEqual(l.snap.progress, { '1': 100, '2': 70 }); // the larger position wins

assert.equal(mergeBackup(snap(), defaults, { foo: 1 }), undefined);
assert.equal(mergeBackup(snap(), defaults, null), undefined);
console.log('backup: all checks passed');
