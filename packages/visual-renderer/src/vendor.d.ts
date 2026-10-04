declare module "fonteditor-core/lib/ttf/woff2ttf" {
  type Converter = (
    buffer: ArrayBuffer,
    options: { inflate: (compressed: number[]) => Uint8Array },
  ) => ArrayBuffer;
  const converter: Converter | { default: Converter };
  export default converter;
}
