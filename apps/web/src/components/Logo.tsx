// The REMY wordmark: the outlined SVG from branding/logo, so it stays crisp at any size. `size` keeps
// its old meaning (the font size the ASCII art was set at), which sets the height: six rows of 1.1.
import wordmark from '../assets/brand/remy-wordmark-on-dark.svg';

/** The wordmark. `size` is px or any CSS length; the header uses the default. */
export function Logo({ size = 5.6 }: { size?: number | string }) {
  const height = typeof size === 'number' ? `${size * 6.6}px` : `calc(${size} * 6.6)`;
  return (
    <img
      src={wordmark}
      alt="Remy"
      draggable={false}
      className="block w-auto select-none"
      style={{ height }}
    />
  );
}
