import { describe, expect, it } from 'vitest';
import { isBareUrl, siteName } from './links.ts';

describe('siteName', () => {
  it('uses a known name, whatever the subdomain or path', () => {
    expect(siteName('https://www.soundguys.com/best-headphones-1234/')).toBe('SoundGuys');
    expect(siteName('https://www.tomsguide.com/best-picks/headphones')).toBe("Tom's Guide");
    expect(siteName('https://en.wikipedia.org/wiki/Remy')).toBe('Wikipedia');
  });
  it('falls back to the host without www', () => {
    expect(siteName('https://www.whathifi.com/best/headphones')).toBe('whathifi.com');
    expect(siteName('https://blog.acme.dev/post')).toBe('blog.acme.dev');
  });
  it('returns the text itself for something that is not a web address', () => {
    expect(siteName('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(siteName('nonsense')).toBe('nonsense');
  });
});

describe('isBareUrl', () => {
  it('spots a link that only repeats its address', () => {
    expect(isBareUrl('https://a.com/x')).toBe(true);
    expect(isBareUrl('the report')).toBe(false);
  });
});
