//! Decoder boundary as WASM: attributedBody bytes in, structured JSON out.
//!
//! Exported ABI (wasm32-unknown-unknown, no WASI, no privileged imports):
//! - `alloc(len) -> ptr` / `dealloc(ptr, len)`: caller-managed input buffers.
//! - `decode(ptr, len) -> ptr` to a result buffer: 4-byte LE length prefix
//!   followed by UTF-8 JSON. Free with `free_result(ptr)`.
//!
//! Result JSON: `{ ok: DecodedBody } | { err: string }` where
//! `DecodedBody = { text, spans: [{ start, end, kind, value? }] }`.
//! Span offsets are UTF-16 code units, matching JavaScript string indexing.

use std::collections::HashMap;

use crabstep::{deserializer::iter::Property, TypedStreamDeserializer};
use serde::Serialize;

#[derive(Serialize)]
struct Span {
    start: u64,
    end: u64,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
}

#[derive(Serialize)]
struct DecodedBody {
    text: String,
    spans: Vec<Span>,
}

#[derive(Serialize)]
enum Outcome {
    #[serde(rename = "ok")]
    Ok(DecodedBody),
    #[serde(rename = "err")]
    Err(String),
}

/// One attribute dictionary's decoded meaning, cacheable by type index.
#[derive(Clone)]
struct RangeAttrs {
    kind: Option<(&'static str, Option<String>)>,
    is_attachment: bool,
}

fn read_attrs(property: &Property<'_, '_>) -> Option<RangeAttrs> {
    let dict = property.as_dictionary()?;
    let mut kind: Option<(&'static str, Option<String>)> = None;
    let mut is_attachment = false;
    for (key, value) in dict {
        let Some(key_name) = key.as_string() else {
            continue;
        };
        match key_name {
            "__kIMLinkAttributeName" => {
                kind = Some(("link", value.as_url().map(str::to_string)));
            }
            "__kIMMentionConfirmedMention" => {
                kind = Some(("mention", value.as_string().map(str::to_string)));
            }
            "__kIMTextBoldAttributeName" => kind = Some(("bold", None)),
            "__kIMTextItalicAttributeName" => kind = Some(("italic", None)),
            "__kIMTextUnderlineAttributeName" | "__kIMTextStrikethroughAttributeName" => {
                kind = Some(("other", Some(key_name.to_string())));
            }
            "__kIMFileTransferGUIDAttributeName" => is_attachment = true,
            _ => {}
        }
    }
    Some(RangeAttrs {
        kind,
        is_attachment,
    })
}

/// Extract `(type_index, utf16_length)` from a two-integer group.
fn type_length_pair(property: &Property<'_, '_>) -> Option<(i64, u64)> {
    use crabstep::OutputData;
    if let Property::Group(group) = property {
        let mut iter = group.iter();
        if let (
            Some(Property::Primitive(OutputData::SignedInteger(idx))),
            Some(Property::Primitive(OutputData::UnsignedInteger(len))),
        ) = (iter.next(), iter.next())
        {
            return Some((*idx, *len));
        }
    }
    None
}

fn decode_impl(bytes: &[u8]) -> Outcome {
    let mut ts = TypedStreamDeserializer::new(bytes);
    let mut iter = match ts.iter_root() {
        Ok(iter) => iter,
        Err(e) => return Outcome::Err(format!("typedstream: {e:?}")),
    };

    let Some(text) = iter.next().as_ref().and_then(Property::as_string) else {
        return Outcome::Err("no attributed string text".into());
    };
    let text = text.to_string();

    let mut spans = Vec::new();
    let mut cache: HashMap<i64, RangeAttrs> = HashMap::new();
    let mut cursor: u64 = 0;
    while let Some(property) = iter.next() {
        let Some((type_index, len)) = type_length_pair(&property) else {
            continue;
        };
        let start = cursor;
        cursor += len;
        // Cached text attributes are reusable by index; attachment ranges
        // carry occurrence-specific metadata, so re-read those.
        let attrs = match cache.get(&type_index) {
            Some(cached) if !cached.is_attachment => cached.clone(),
            _ => match iter.next().as_ref().and_then(read_attrs) {
                Some(read) => {
                    cache.insert(type_index, read.clone());
                    read
                }
                None => continue,
            },
        };
        if let Some((kind, value)) = attrs.kind {
            spans.push(Span {
                start,
                end: cursor,
                kind,
                value,
            });
        }
    }
    Outcome::Ok(DecodedBody { text, spans })
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` must come from `alloc(len)` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

/// # Safety
/// `ptr..ptr+len` must be a valid initialized input buffer from `alloc`.
#[no_mangle]
pub unsafe extern "C" fn decode(ptr: *const u8, len: usize) -> *mut u8 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let json = serde_json::to_vec(&decode_impl(bytes)).unwrap_or_else(|e| {
        format!("{{\"err\":\"serialize: {e}\"}}").into_bytes()
    });
    let mut out = Vec::with_capacity(4 + json.len());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    let ptr = out.as_mut_ptr();
    std::mem::forget(out);
    ptr
}

/// # Safety
/// `ptr` must come from `decode` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn free_result(ptr: *mut u8) {
    let len = u32::from_le_bytes(*(ptr as *const [u8; 4])) as usize;
    drop(Vec::from_raw_parts(ptr, 4 + len, 4 + len));
}
