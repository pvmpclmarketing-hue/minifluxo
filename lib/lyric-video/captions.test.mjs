import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLyricsTiming } from './captions.js';
import { blocksFromTranscript } from './sync-lyrics.js';
import { buildShotstackEdit, layoutCaption, textWidth } from './build-shotstack-edit.js';

test('incomplete units preserve every word, including the formerly missing publicity phrase', () => {
  const text = 'Na faculdade de publicidade eu te encontrei Camila';
  const result = generateLyricsTiming(text, [{ start: 15, end: 23, text, units: [{ text: 'Na faculdade', start: 15, end: 17 }, { text: 'Camila', start: 21, end: 23 }] }]);
  assert.equal(result.blocks.flatMap(b => b.units.map(w => w.text)).join(' '), text);
});

test('long phrases are split without loss, fit the central safe region and retain previous lines', () => {
  const text = 'primeira amiga Riso leve conversa que acalmava a vida Sem perceber o coração foi mudando de lugar';
  const timing = [{ start: 23, end: 36, text }];
  const blocks = generateLyricsTiming(text, timing).blocks;
  assert.equal(blocks.map(b => b.text).join(' '), text);
  for (const block of blocks) {
    assert.ok(block.units.length <= 6);
    const { lines, size } = layoutCaption(block);
    assert.ok(lines.length <= 3);
    assert.ok(lines.every(l => textWidth(l.map(w => w.text.toUpperCase()).join(' '), size) <= 712));
  }
  const { edit } = buildShotstackEdit({ audioUrl: 'https://example.com/music.mp3', lyrics: text, lyricsTimestamps: timing });
  const clips = edit.timeline.tracks.flatMap(t => t.clips).filter(c => c.asset.type === 'rich-text' && c.start >= 23);
  assert.equal(clips.map(c => c.asset.text).join(' '), text.toUpperCase());
  for (const clip of clips) {
    assert.equal(clip.position, 'center');
    assert.equal(clip.offset.x, 0);
    const center = 960 - clip.offset.y * 1920;
    assert.ok(center - clip.height / 2 >= 480 && center + clip.height / 2 <= 1120);
    assert.ok(clip.length > 0);
    assert.ok(blocks.some(b => Math.abs(clip.start + clip.length - b.end) < 0.003));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(edit)) < 350000);
});

test('transcript keeps the final word crossing the 60-second cut', () => {
  const blocks = blocksFromTranscript([{word:'amor',start:59.1,end:59.6},{word:'eterno',start:59.6,end:60.4},{word:'depois',start:61,end:62}]);
  assert.equal(blocks.map(b => b.text).join(' '), 'amor eterno');
  assert.equal(blocks.at(-1).end, 60);
});
