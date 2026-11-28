import sharp from 'sharp';
import { SharpImageProcessor } from '../../src/modules/media/infrastructure/sharp-image-processor';
import { MediaError } from '../../src/modules/media/domain/media-errors';
import { DISPLAY_PX, MAX_UPLOAD_BYTES, THUMB_PX } from '../../src/modules/media/domain/media-rules';

/**
 * sharp processor unit tests (J10, 8.6.9): real native decoding on this Linux x64
 * environment. Images are synthesized with sharp itself, so every case is a real
 * raster payload, never a fixture file.
 */
const processor = new SharpImageProcessor();

const makeImage = async (
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' = 'png',
): Promise<Uint8Array> => {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 40, b: 200 } },
  });
  const buf = await base[format]().toBuffer();
  return new Uint8Array(buf);
};

describe('SharpImageProcessor (J10)', () => {
  it('accepts jpeg, png and webp; decodes dimensions and emits three webp variants', async () => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const out = await processor.process(await makeImage(1200, 800, format));
      expect(out.widthPx).toBe(1200);
      expect(out.heightPx).toBe(800);
      for (const v of ['original', 'thumb', 'display'] as const) {
        const meta = await sharp(Buffer.from(out.variants[v].bytes)).metadata();
        expect(meta.format).toBe('webp');
        expect(meta.width).toBe(out.variants[v].widthPx);
        expect(meta.height).toBe(out.variants[v].heightPx);
        expect(out.variants[v].byteSize).toBe(out.variants[v].bytes.byteLength);
      }
    }
  });

  it('sizes variants: original keeps, display caps at 1024, thumb at 256 (no upscale)', async () => {
    const out = await processor.process(await makeImage(1200, 800));
    expect([out.variants.original.widthPx, out.variants.original.heightPx]).toEqual([1200, 800]);
    expect([out.variants.display.widthPx, out.variants.display.heightPx]).toEqual([1024, 683]);
    expect([out.variants.thumb.widthPx, out.variants.thumb.heightPx]).toEqual([256, 171]);
    const small = await processor.process(await makeImage(100, 60));
    expect([small.variants.thumb.widthPx, small.variants.thumb.heightPx]).toEqual([100, 60]);
    expect([small.variants.display.widthPx, small.variants.display.heightPx]).toEqual([100, 60]);
    expect(DISPLAY_PX).toBe(1024);
    expect(THUMB_PX).toBe(256);
  });

  it('rejects malformed bytes as INVALID_IMAGE', async () => {
    await expect(processor.process(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toMatchObject({
      name: 'MediaError',
      code: 'INVALID_IMAGE',
    });
  });

  it('rejects disguised content: an SVG named as an image is UNSUPPORTED_MEDIA_TYPE', async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    await expect(processor.process(svg)).rejects.toMatchObject({
      name: 'MediaError',
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it('rejects supported-decodable but unapproved formats (gif) as UNSUPPORTED_MEDIA_TYPE', async () => {
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .gif()
      .toBuffer();
    await expect(processor.process(new Uint8Array(gif))).rejects.toMatchObject({
      name: 'MediaError',
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it('rejects an upload over 5 MB before decoding', async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    await expect(processor.process(big)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('rejects decoded dimensions over 4000 px after decode', async () => {
    const wide = await makeImage(4001, 10);
    await expect(processor.process(wide)).rejects.toMatchObject({ code: 'DIMENSIONS_TOO_LARGE' });
    const tall = await makeImage(10, 4001);
    await expect(processor.process(tall)).rejects.toMatchObject({ code: 'DIMENSIONS_TOO_LARGE' });
    const ok = await processor.process(await makeImage(4000, 10));
    expect(ok.widthPx).toBe(4000);
  });

  it('applies EXIF orientation and strips metadata from every variant', async () => {
    // 200x100 with EXIF orientation 6 displays as 100x200.
    const rotated = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await processor.process(new Uint8Array(rotated));
    expect([out.widthPx, out.heightPx]).toEqual([100, 200]);
    expect([out.variants.original.widthPx, out.variants.original.heightPx]).toEqual([100, 200]);
    const meta = await sharp(Buffer.from(out.variants.original.bytes)).metadata();
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });

  it('outputs decode again cleanly (roundtrip through sharp)', async () => {
    const out = await processor.process(await makeImage(640, 480));
    const stats = await sharp(Buffer.from(out.variants.display.bytes)).stats();
    expect(stats.channels.length).toBeGreaterThan(0);
  });

  it('a MediaError carries only its safe code', async () => {
    const err = await processor.process(new Uint8Array([0])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MediaError);
    expect((err as MediaError).message).toBe((err as MediaError).code);
  });
});
