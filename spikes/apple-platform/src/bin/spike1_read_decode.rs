//! Spike 1: open chat.db read-only and decode text for the latest message of
//! the 100 most recently active conversations.
//!
//! Prints statistics only — no message content, participant names, or handles.

use std::time::Instant;

use imessage_database::tables::{messages::Message, table::Table};
use imessage_database::util::dirs::default_db_path;

const SELECT_HEAD: &str = "SELECT
    m.rowid, m.guid, m.text, m.service, m.handle_id, m.destination_caller_id,
    m.subject, m.date, m.date_read, m.date_delivered, m.is_from_me, m.is_read,
    m.item_type, m.other_handle, m.share_status, m.share_direction, m.group_title,
    m.group_action_type, m.associated_message_guid, m.associated_message_type,
    m.balloon_bundle_id, m.expressive_send_style_id, m.thread_originator_guid,
    m.thread_originator_part, m.date_edited, m.associated_message_emoji,
    c.chat_id,
    (SELECT COUNT(*) FROM message_attachment_join a WHERE m.ROWID = a.message_id) as num_attachments,
    NULL as deleted_from,
    0 as num_replies
FROM message as m
JOIN chat_message_join as c ON m.ROWID = c.message_id";

fn main() {
    let t0 = Instant::now();
    let path = default_db_path();
    let conn =
        imessage_database::tables::table::get_connection(&path).expect("open chat.db read-only");
    let t_open = t0.elapsed();

    // Prove the handle is read-only: any write must fail.
    let write_err = conn
        .execute("CREATE TABLE rx_spike_should_fail (x INTEGER)", [])
        .expect_err("write unexpectedly succeeded on chat.db — ABORT");
    println!(
        "write rejected as expected: {}",
        format!("{write_err}").chars().take(60).collect::<String>()
    );

    // 100 most recently active chats, each with its latest message rowid.
    let t1 = Instant::now();
    let mut chat_stmt = conn
        .prepare(
            "SELECT c.chat_id, MAX(m.date) AS latest, MAX(m.ROWID) AS latest_rowid
             FROM message m
             JOIN chat_message_join c ON m.ROWID = c.message_id
             GROUP BY c.chat_id
             ORDER BY latest DESC
             LIMIT 100",
        )
        .unwrap();
    let latest_rowids: Vec<i64> = chat_stmt
        .query_map([], |r| r.get::<_, i64>(2))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    let t_chats = t1.elapsed();

    let t2 = Instant::now();
    let mut plain = 0usize;
    let mut decoded = 0usize;
    let mut empty = 0usize;
    let mut decode_failed = 0usize;
    let mut total_chars = 0usize;

    let in_list = latest_rowids
        .iter()
        .map(|r| r.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("{SELECT_HEAD} WHERE m.ROWID IN ({in_list})");
    let mut stmt = conn.prepare(&sql).unwrap();
    let rows = Message::rows(&mut stmt, []).unwrap();
    let mut n = 0usize;
    for row in rows {
        let mut m: Message = match row {
            Ok(m) => m,
            Err(_) => continue,
        };
        n += 1;
        if m.text.is_some() {
            plain += 1;
        } else {
            match m.parse_body(&conn) {
                Ok(body) => {
                    m.apply_body(body);
                    if m.text.is_some() {
                        decoded += 1;
                    } else {
                        empty += 1; // attachment-only, tapback, etc.
                    }
                }
                Err(_) => decode_failed += 1,
            }
        }
        total_chars += m.text.as_deref().map(str::len).unwrap_or(0);
    }
    let t_decode = t2.elapsed();

    println!("open: {t_open:?}");
    println!("latest-100-chats query: {t_chats:?}");
    println!("fetch+decode {n} latest messages: {t_decode:?}");
    println!(
        "plain-text column: {plain}, decoded from attributedBody: {decoded}, \
         empty (non-text item): {empty}, decode failures: {decode_failed}"
    );
    println!("total decoded chars (content not shown): {total_chars}");
    println!("total wall: {:?}", t0.elapsed());
}
