//! Decoder-only Node-API boundary: raw attributedBody bytes -> decoded text.

use crabstep::{deserializer::iter::Property, TypedStreamDeserializer};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

/// Decode an `attributedBody` typedstream payload to its plain text.
/// Returns `null` for payloads with no text (attachment-only, app balloons).
/// Throws on malformed streams.
#[napi]
pub fn decode_body_text(payload: Buffer) -> napi::Result<Option<String>> {
    let bytes: &[u8] = &payload;
    let mut ts = TypedStreamDeserializer::new(bytes);
    let mut iter = ts
        .iter_root()
        .map_err(|e| napi::Error::from_reason(format!("typedstream: {e:?}")))?;
    Ok(iter
        .next()
        .as_ref()
        .and_then(Property::as_string)
        .map(str::to_string))
}
