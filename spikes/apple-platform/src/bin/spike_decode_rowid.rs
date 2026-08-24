//! Debug helper: decode one message row by ROWID and print statistics only.
//! Message content is never emitted.

use imessage_database::tables::{messages::Message, table::Table};
use imessage_database::util::dirs::default_db_path;

fn main() {
    let rowid: i64 = std::env::args().nth(1).unwrap().parse().unwrap();
    let conn = imessage_database::tables::table::get_connection(&default_db_path()).unwrap();
    let sql = format!(
        "SELECT
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
        LEFT JOIN chat_message_join as c ON m.ROWID = c.message_id
        WHERE m.ROWID = {rowid}"
    );
    let mut stmt = conn.prepare(&sql).unwrap();
    for row in Message::rows(&mut stmt, []).unwrap() {
        let mut m = row.unwrap();
        if m.text.is_none() {
            if let Ok(b) = m.parse_body(&conn) {
                m.apply_body(b);
            }
        }
        println!(
            "rowid={} num_attachments={} has_text={} text_chars={}",
            rowid,
            m.num_attachments,
            m.text.is_some(),
            m.text.as_deref().map(str::len).unwrap_or(0)
        );
    }
}
