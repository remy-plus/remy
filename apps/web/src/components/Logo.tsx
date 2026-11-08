// The REMY wordmark (figlet Cosmike), copied from branding/logo/remy-wordmark.txt.
const LINES = [
  ':::::::..    .,::::::    .        :     .-:.     ::-.',
  ";;;;``;;;;   ;;;;''''    ;;,.    ;;;     ';;.   ;;;;'",
  " [[[,/[[['    [[cccc     [[[[, ,[[[[,      '[[,[[['",
  ' $$$$$$c      $$""""     $$$$$$$$"$$$        c$$"',
  ' 888b "88bo,  888oo,__   888 Y88" 888o     ,8P"`',
  ' MMMM   "W"   """"YUMMM  MMM  M\'  "MMM    mM"',
];

export function Logo() {
  return (
    <pre
      role="img"
      aria-label="Remy"
      className="m-0 select-none bg-linear-to-b from-text to-stone bg-clip-text font-mono font-bold text-transparent"
      style={{ fontSize: '5.6px', lineHeight: 1.1 }}
    >
      {LINES.join('\n')}
    </pre>
  );
}
