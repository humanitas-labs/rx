// Host-side loader for the WASM decoder boundary (ADR-003).
//
// The module is instantiated with ZERO imports: it cannot reach the
// filesystem, network, or clock. The caller supplies the wasm bytes; this
// package takes no environment dependencies so main-process and test code
// load it the same way.

import { decodedBodySchema, type DecodedBody } from '@rx/contract';

export type DecodeResult = { ok: DecodedBody } | { err: string };

interface DecoderExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  decode(ptr: number, len: number): number;
  free_result(ptr: number): void;
}

export interface BodyDecoder {
  /** Decode one attributedBody payload. Never throws on malformed input. */
  decode(bytes: Uint8Array): DecodeResult;
}

export async function createDecoder(wasmBytes: BufferSource): Promise<BodyDecoder> {
  // Zero-import instantiation is the isolation contract: if the module ever
  // requests an import, instantiation fails loudly here.
  const module = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(module, {});
  const exports = instance.exports as unknown as DecoderExports;

  return {
    decode(bytes: Uint8Array): DecodeResult {
      const inputPtr = exports.alloc(bytes.length);
      try {
        // Views must be rebuilt after any call that can grow memory.
        new Uint8Array(exports.memory.buffer, inputPtr, bytes.length).set(bytes);
        const resultPtr = exports.decode(inputPtr, bytes.length);
        try {
          const view = new DataView(exports.memory.buffer);
          const jsonLen = view.getUint32(resultPtr, true);
          const jsonBytes = new Uint8Array(exports.memory.buffer, resultPtr + 4, jsonLen);
          const parsed: unknown = JSON.parse(new TextDecoder().decode(jsonBytes));
          return validateOutcome(parsed);
        } finally {
          exports.free_result(resultPtr);
        }
      } catch (error) {
        return { err: `decoder host failure: ${String(error)}` };
      } finally {
        exports.dealloc(inputPtr, bytes.length);
      }
    },
  };
}

function validateOutcome(parsed: unknown): DecodeResult {
  if (typeof parsed === 'object' && parsed !== null) {
    if ('err' in parsed && typeof parsed.err === 'string') {
      return { err: parsed.err };
    }
    if ('ok' in parsed) {
      const body = decodedBodySchema.safeParse(parsed.ok);
      if (body.success) {
        return { ok: body.data };
      }
      return { err: `decoder output failed schema validation: ${body.error.message}` };
    }
  }
  return { err: 'decoder returned an unrecognized result shape' };
}
