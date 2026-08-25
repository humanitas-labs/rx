// Design glyphs, rendered from the exported Figma SVGs via CSS masks so one
// asset serves every tint (active/inactive tabs, hover states). The SVG files
// in assets/ are the design's own vectors — never hand-drawn substitutes.

export function Icon(props: {
  src: string;
  width: number;
  height: number;
  /** CSS color; defaults to currentColor so the parent controls the tint. */
  color?: string;
}) {
  const mask = `url("${props.src}")`;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: props.width,
        height: props.height,
        backgroundColor: props.color ?? 'currentColor',
        WebkitMaskImage: mask,
        maskImage: mask,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}
