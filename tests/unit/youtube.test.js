// tests/unit/youtube.test.js
import { describe, expect, it } from 'vitest';

import { youtubeEmbedUrl, youtubeId } from '../../src/app/screens/youtube.js';

describe('youtube links', () => {
  it.each([
    ['https://www.youtube.com/watch?v=oMmctHNRyBg', 'oMmctHNRyBg'],
    ['https://youtu.be/VAI3JUKTwz0', 'VAI3JUKTwz0'],
    ['https://youtube.com/shorts/VAI3JUKTwz0?feature=share', 'VAI3JUKTwz0'],
    ['https://www.youtube.com/embed/oMmctHNRyBg', 'oMmctHNRyBg'],
    ['https://m.youtube.com/watch?v=oMmctHNRyBg&t=30', 'oMmctHNRyBg'],
    ['https://vimeo.com/123', null],
    ['https://youtube.com/watch?v=bad', null],
    ['not a url', null],
  ])('reads %s', (url, id) => {
    expect(youtubeId(url)).toBe(id);
  });

  it('builds privacy-enhanced embed URLs', () => {
    expect(youtubeEmbedUrl('https://youtu.be/VAI3JUKTwz0')).toBe('https://www.youtube-nocookie.com/embed/VAI3JUKTwz0');
    expect(youtubeEmbedUrl('https://vimeo.com/1')).toBeNull();
  });
});
