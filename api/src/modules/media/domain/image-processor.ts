import { ImageVariant, VariantMeta } from './media-rules';

/**
 * Image processor port (IP-5 Step 6). The application service depends on this port, not
 * on sharp, so the pipeline is unit-testable without native binaries (5.3). The sharp
 * adapter lives in infrastructure.
 *
 * Contract: the processor validates the DECODED content (never the client-supplied
 * filename or MIME header), applies the J10 limits, auto-orients, strips metadata and
 * produces the three approved WebP variants. It throws MediaError for every rejection
 * so the API maps failures to safe client errors; no partial result is ever returned.
 */
export interface ProcessedVariant extends VariantMeta {
  readonly bytes: Uint8Array;
}

export interface ProcessedImage {
  /** Orientation-corrected dimensions of the original variant (<= 4000 px, J10). */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly variants: Readonly<Record<ImageVariant, ProcessedVariant>>;
}

export interface ImageProcessor {
  process(input: Uint8Array): Promise<ProcessedImage>;
}

export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR');
