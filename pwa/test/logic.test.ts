// Self-check of the pure logic: `npm test` (Node 22+, no test framework).
import assert from 'node:assert/strict';
import { parseMaster, sortQualities, preferredQualityKey, qualityText, loginFromInput, vodStartFromInput,
  clipSlugFromInput, isVodInput, formatViewers, parseIRC, parseEmoteRanges, readableColor, isAdCue, adActive, rankSources, formatClock } from '../src/logic.ts';
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
console.log('logic: all checks passed');
