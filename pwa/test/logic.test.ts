// Self-check of the pure logic: `npm test` (Node 22+, no test framework).
import assert from 'node:assert/strict';
import { parseMaster, sortQualities, preferredQualityKey, qualityText, loginFromInput, vodStartFromInput,
  clipSlugFromInput, isVodInput, formatViewers, parseIRC, parseEmoteRanges, readableColor, isAdCue, adActive, rankSources, adBridgePlan, formatClock, chatSync,
  LiveSyncEstimator, rejectionText, followerDuration, chatHidden, chatMentions, replayHistory, readHype, applyHype, endHypeFlash, type LiveHype } from '../src/logic.ts';
import { workerVariants } from '../src/vod.ts';

const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="chunked",FRAME-RATE=60.000
https://a/chunked.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,VIDEO="720p60",FRAME-RATE=60.000
https://a/720p60.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,VIDEO="720p30",FRAME-RATE=30.000
720p30.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"
https://a/audio.m3u8`;
const m = parseMaster(master, 'https://base.example/x/master.m3u8');
assert.deepEqual(Object.keys(m.links).sort(), ['720p30', '720p60', 'Source', 'audio_only']);
assert.equal(m.links['720p30'], 'https://base.example/x/720p30.m3u8');
assert.equal(m.variants.Source.height, 1080);
assert.deepEqual(sortQualities(Object.keys(m.links), m.variants), ['Source', '720p60', '720p30', 'audio_only']);
assert.equal(preferredQualityKey(Object.keys(m.links), '720', m.variants), '720p60');
assert.equal(preferredQualityKey(Object.keys(m.links), '480', m.variants), '720p30'); // nothing lower → lowest video
assert.equal(preferredQualityKey(Object.keys(m.links), 'audio', m.variants), 'audio_only');
assert.equal(preferredQualityKey(Object.keys(m.links), 'source', m.variants), 'Source');
assert.equal(qualityText('720p30'), '720p');
assert.equal(qualityText('audio_only'), 'Nur Audio');
assert.deepEqual(workerVariants({ Source: { h: 1080, fps: 60, bw: 8000000 }, audio_only: { h: 0 } }), {
  Source: { height: 1080, fps: 60, bandwidth: 8000000 }, audio_only: { height: 0, fps: 0, bandwidth: 0 },
});

assert.equal(loginFromInput('https://www.twitch.tv/xQc/clips'), 'xqc');
assert.equal(loginFromInput('@Gotaga'), 'gotaga');
assert.equal(loginFromInput('twitch.tv/directory'), 'twitch.tv/directory');
assert.equal(vodStartFromInput('https://www.twitch.tv/videos/123456789?t=1h2m3s'), 3723);
assert.equal(clipSlugFromInput('https://clips.twitch.tv/FunnyClip-AbC_12'), 'FunnyClip-AbC_12');
assert.ok(isVodInput('https://www.twitch.tv/videos/2911306589'));
assert.equal(formatClock(3723), '1:02:03');

const irc = parseIRC('@badges=moderator/1;color=#1E90FF;display-name=Foo;emotes=25:0-4;id=abc;system-msg=a\\sb :foo!foo@foo.tmi.twitch.tv PRIVMSG #chan :Kappa hi :)');
assert.ok(irc);
assert.equal(irc.command, 'PRIVMSG');
assert.deepEqual(irc.params, ['#chan', 'Kappa hi :)']);
assert.equal(irc.tags['system-msg'], 'a b');
assert.equal(parseIRC('PING :tmi.twitch.tv')?.params[0], 'tmi.twitch.tv');
// Code points, not UTF-16: the emoji takes one position for Twitch.
const text = '😀 Kappa';
assert.deepEqual(parseEmoteRanges('25:2-6', text), [['25', 3, 8]]);
assert.equal(text.slice(3, 8), 'Kappa');
assert.deepEqual(parseEmoteRanges('25:5-1', 'Kappa'), []);
assert.equal(readableColor('#000000') !== '#000000', true);
assert.ok(isAdCue('stitched-ad-123', {}));
assert.ok(isAdCue('', { key: 'X-TV-TWITCH-STREAM-SOURCE', data: 'Amazon' }));
assert.ok(!isAdCue('', { key: 'X-TV-TWITCH-STREAM-SOURCE', data: 'live' }));
assert.equal(formatViewers(3811600), '3,8 Mio.');
// Measured in the Simulator: both cues stay active after a pre-roll.
const amazon = { id: '', start: 3, value: { key: 'X-TV-TWITCH-STREAM-SOURCE', data: 'Amazon|2474283100494' } };
const adKey = { id: '', start: 3, value: { key: 'X-TV-TWITCH-AD-AD-FORMAT', data: 'standard_video_ad' } };
const live = { id: '', start: 34, value: { key: 'X-TV-TWITCH-STREAM-SOURCE', data: 'live' } };
assert.ok(adActive([amazon, adKey]));
assert.ok(!adActive([amazon, adKey, live]));
assert.ok(adActive([live, { ...adKey, start: 90 }]));   // mid-roll after live
assert.ok(!adActive([live]));
assert.deepEqual(rankSources(['as', 'al', 'eu'], { as: [6, 3600], al: [1, 3600] }), ['al', 'as', 'eu']);
assert.deepEqual(rankSources(['as', 'al', 'eu'], { as: [6, 3600], al: [1, 600] }), ['as', 'al', 'eu']); // only one ≥ 20 min

// Ad bridge: never the source playing now; same break (< 5 min) keeps walking, never back.
const cands = ['embed', 'popout', 'autoplay', 'al', 'eu', 'as'];
const p1 = adBridgePlan(undefined, 'as', 0, cands);
assert.deepEqual(p1.next, ['embed', 'popout', 'autoplay', 'al', 'eu']);
p1.tried.push('embed');                                       // switched to embed, it got a pre-roll too
const p2 = adBridgePlan(p1, 'embed', 30_000, cands);
assert.deepEqual(p2.next, ['popout', 'autoplay', 'al', 'eu']);
assert.equal(p2.at, 0);
assert.deepEqual(adBridgePlan({ tried: cands, at: 0 }, 'eu', 60_000, cands).next, []); // all tried: stay
assert.deepEqual(adBridgePlan(p2, 'popout', 400_000, cands).next, ['embed', 'autoplay', 'al', 'eu', 'as']); // a new break later

// Chat sync: PDT lag − 6 s, edge distance without PDT (or with a late clock), replay > 5 min in the recording.
const now = 1_000_000_000;
assert.deepEqual(chatSync({ now, t: 100, pdt0: now - 120_000, edge: 105 }), { delay: 14, replay: false });
assert.deepEqual(chatSync({ now, t: 100, edge: 108 }), { delay: 8, replay: false });
assert.deepEqual(chatSync({ now, t: 100, pdt0: now - 102_000, edge: 108 }), { delay: 8, replay: false });
assert.deepEqual(chatSync({ now, t: 100 }), { delay: 0, replay: false });
assert.deepEqual(chatSync({ now, t: 3500, archiveStart: now - 3600_000 }), { delay: 94, replay: false });
assert.equal(chatSync({ now, t: 3000, archiveStart: now - 3600_000 }).replay, true);
assert.deepEqual(chatSync({ now, t: 100, pdt0: now - 120_000, edge: 105, nudge: 5 }), { delay: 19, replay: false });
assert.deepEqual(chatSync({ now, t: 100, pdt0: now - 120_000, edge: 105, nudge: -20 }), { delay: 0, replay: false });

// Sync estimator: the edge's measured age replaces the fixed 6 s once 6 samples are in; one odd
// sample (an ad cue's date) doesn't move the 10th percentile.
const est = new LiveSyncEstimator();
for (let i = 0; i < 4; i++) est.offset(20, 8, now + i * 1000);
assert.equal(chatSync({ now, t: 100, pdt0: now - 120_000, edge: 108, est }).delay, 14);   // 5th sample: 20 − 6 until ready
assert.equal(est.ready, false);
assert.equal(chatSync({ now, t: 100, pdt0: now - 120_000, edge: 108, est }).delay, 8);    // 6th: 20 − 12 (measured edge age)
assert.equal(est.ready, true);
est.offset(90, 8, now + 6000);                                                              // ad cue: age 82, ignored by the percentile
assert.equal(est.offset(20, 8, now + 7000), 8);
assert.equal(est.offset(20, 8, now + 70000), 8);                                            // old samples gone: plain edge distance
assert.equal(new LiveSyncEstimator().offset(undefined, 7), 7);

// Twitch refusals in German; follower duration like ChatRoomModes.duration.
assert.equal(followerDuration(30), '30 Min.');
assert.equal(followerDuration(90), '1 Std. 30 Min.');
assert.equal(followerDuration(1500), '1 Tag 1 Std.');
assert.equal(followerDuration(2880), '2 Tage');
assert.equal(rejectionText('msg_followersonly_followed', 'x', 10), 'Nachricht nicht gesendet: Du musst dem Kanal seit 10 Min. folgen, um zu chatten.');
assert.equal(rejectionText('msg_slowmode', 'x'), 'Nachricht nicht gesendet: Langsamer Modus, warte etwas zwischen den Nachrichten.');
assert.equal(rejectionText('msg_something_new', 'Raw text'), 'Nachricht nicht gesendet: Raw text');
assert.equal(rejectionText('no_permission', 'x'), undefined);

// Filters: own lines never hidden; bots and "!commands" are separate switches; muted words substring.
const f = { me: 'Me', blockedUsers: ['troll'], mutedWords: ['Spoiler'], hideBots: true, hideCommands: false, highlightWords: ['hallo'] };
assert.ok(chatHidden('troll', 'hi', f));
assert.ok(chatHidden('nightbot', 'hi', f));
assert.ok(chatHidden('blerp', 'hi', f));
assert.ok(!chatHidden('nightbot', '!cmd', { ...f, hideBots: false }));
assert.ok(chatHidden('bob', '!cmd', { ...f, hideCommands: true }));
assert.ok(chatHidden('bob', 'ein SPOILER', f));
assert.ok(!chatHidden('me', 'spoiler', f));
assert.deepEqual(chatMentions('bob', 'hey @Me!', 'me', ['hallo']), { mention: true, highlighted: false });
assert.deepEqual(chatMentions('bob', 'Hallo, alle', 'me', ['hallo']), { mention: false, highlighted: true });
assert.deepEqual(chatMentions('me', 'me hallo', 'me', ['hallo']), { mention: false, highlighted: false });

// History replay: rm-deleted, CLEARCHAT on a login, CLEARMSG on an id; sorted by tmi-sent-ts.
const hist = [
  '@id=b;tmi-sent-ts=2000 :bob!bob@bob.tmi.twitch.tv PRIVMSG #c :late',
  '@id=a;tmi-sent-ts=1000;rm-deleted=1 :ann!ann@ann.tmi.twitch.tv PRIVMSG #c :gone',
  '@id=c;tmi-sent-ts=1500 :cat!cat@cat.tmi.twitch.tv PRIVMSG #c :hi',
  '@tmi-sent-ts=2100 :tmi.twitch.tv CLEARCHAT #c :cat',
  '@target-msg-id=b;tmi-sent-ts=2200 :tmi.twitch.tv CLEARMSG #c :late',
  '@id=d;tmi-sent-ts=2300 :cat!cat@cat.tmi.twitch.tv PRIVMSG #c :after the ban',
].map(parseIRC).filter(Boolean) as any[];
assert.deepEqual(replayHistory(hist).map(h => [h.irc.tags.id, h.deleted]), [['a', true], ['c', true], ['b', true], ['d', false]]);

// Hype train: approach → kickoff (1.5 s) → departed (10 s) → level done (4 s) → ended (15 s).
const t0 = 1_000_000;
const approach = readHype({ approaching: { id: 'h1', goal: 3, participants: [{}], eventsRemaining: [{ events: 2, secondsRemaining: 100 }, { events: 1, secondsRemaining: 100 }] } }, t0)!;
assert.equal(approach.phase, 'approaching'); assert.equal(approach.left, 1); assert.equal(approach.bigGoal, false);
const run1 = readHype({ execution: { id: 'h1', progress: { goal: 1000, progression: 250, remainingSeconds: 300, level: { value: 1, goal: 1000 } } } }, t0)!;
assert.equal(run1.percent, 0.25); assert.equal(run1.endsAt, t0 + 300_000);
assert.equal(readHype({ execution: { id: 'h1', endedAt: 'x', progress: {} } }, t0), undefined);
assert.equal(readHype({ execution: { id: 'h1', progress: { goal: 1, total: 5, level: { value: 2, goal: 3 } } } }, t0)!.percent, 1); // total − (level.goal − goal) = 3 ≥ goal
let h: LiveHype | undefined = applyHype(approach, run1, t0 + 5000);
assert.deepEqual(h!.flash, { k: 'kickoff' }); assert.equal(h!.flashUntil, t0 + 6500);
h = endHypeFlash(h!, t0 + 6500);
assert.deepEqual(h!.flash, { k: 'departed' });
const run2 = { ...run1, level: 2, percent: 0.1 };
h = applyHype(h, run2, t0 + 10_000);                     // level up while "departed" shows: waits
assert.deepEqual(h!.flash, { k: 'departed' }); assert.equal(h!.pendingLevelDone, 1);
h = endHypeFlash(h!, t0 + 16_500);
assert.deepEqual(h!.flash, { k: 'levelDone', n: 1 });
h = endHypeFlash(h!, t0 + 20_500);
assert.equal(h!.flash, undefined);
h = applyHype(h, undefined, (run2.endsAt ?? 0) - 1000);  // gone at its deadline after level 1: ended
assert.deepEqual(h!.flash, { k: 'ended', level: 2, percent: 10 });
assert.equal(endHypeFlash(h!, 0), undefined);
assert.equal(applyHype(run1, undefined, t0), undefined); // level 1 expired: nothing shown
assert.deepEqual(applyHype(undefined, run1, t0)!.flash, { k: 'departed' });
console.log('logic: all checks passed');
