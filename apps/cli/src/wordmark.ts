// The REMY wordmark (figlet Cosmike, hand-spaced). Source of truth is
// branding/logo/remy-wordmark.txt; theme.test.ts keeps this copy identical to it.
export const WORDMARK: readonly string[] = [
  ':::::::..    .,::::::    .        :     .-:.     ::-.',
  ";;;;``;;;;   ;;;;''''    ;;,.    ;;;     ';;.   ;;;;'",
  " [[[,/[[['    [[cccc     [[[[, ,[[[[,      '[[,[[['",
  ' $$$$$$c      $$""""     $$$$$$$$"$$$        c$$"',
  ' 888b "88bo,  888oo,__   888 Y88" 888o     ,8P"`',
  ' MMMM   "W"   """"YUMMM  MMM  M\'  "MMM    mM"',
];

export const WORDMARK_WIDTH = Math.max(...WORDMARK.map((l) => l.length));
export const TAGLINE = 'Real work, quietly done.';
