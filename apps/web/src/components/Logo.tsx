// The REMY wordmark (figlet Cosmike), copied from branding/logo/remy-wordmark.txt.
const LINES = [
  ':::::::..    .,::::::    .        :     .-:.     ::-.',
  ";;;;``;;;;   ;;;;''''    ;;,.    ;;;     ';;.   ;;;;'",
  " [[[,/[[['    [[cccc     [[[[, ,[[[[,      '[[,[[['",
  ' $$$$$$c      $$""""     $$$$$$$$"$$$        c$$"',
  ' 888b "88bo,  888oo,__   888 Y88" 888o     ,8P"`',
  ' MMMM   "W"   """"YUMMM  MMM  M\'  "MMM    mM"',
];

/** The wordmark. `size` is the font size in px; the header uses the default. */
export function Logo({ size = 5.6 }: { size?: number }) {
  return (
    <pre
      role="img"
      aria-label="Remy"
      className="m-0 select-none bg-linear-to-b from-text to-stone bg-clip-text font-mono font-bold text-transparent"
      style={{ fontSize: `${size}px`, lineHeight: 1.1 }}
    >
      {LINES.join('\n')}
    </pre>
  );
}
