//! Spike 2: observe new source messages without polling the whole database.
//!
//! Strategy under test: remember the max message ROWID as a cursor, watch the
//! chat.db WAL file for change signals (mtime/size), and on signal run one
//! bounded query for rows above the cursor, emitting affected chat GUIDs.
//!
//! Prints chat GUIDs and row counts only — no message content.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use imessage_database::util::dirs::default_db_path;

fn wal_stamp(wal: &PathBuf) -> (u64, i64) {
    match std::fs::metadata(wal) {
        Ok(md) => (
            md.len(),
            md.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        ),
        Err(_) => (0, 0),
    }
}

fn main() {
    let run_secs: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(60);
    let path = default_db_path();
    let wal = PathBuf::from(format!("{}-wal", path.display()));
    let conn =
        imessage_database::tables::table::get_connection(&path).expect("open chat.db read-only");

    let mut cursor: i64 = conn
        .query_row("SELECT COALESCE(MAX(ROWID),0) FROM message", [], |r| {
            r.get(0)
        })
        .unwrap();
    println!("start cursor (max message ROWID): {cursor}");
    println!(
        "watching {} for {run_secs}s — send yourself a message now",
        wal.display()
    );

    let mut stamp = wal_stamp(&wal);
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(run_secs) {
        std::thread::sleep(Duration::from_millis(250));
        let now_stamp = wal_stamp(&wal);
        if now_stamp == stamp {
            continue;
        }
        stamp = now_stamp;
        let t = Instant::now();
        let mut stmt = conn
            .prepare(
                "SELECT c.chat_id, ch.guid, COUNT(*), MAX(m.ROWID)
                 FROM message m
                 JOIN chat_message_join c ON m.ROWID = c.message_id
                 JOIN chat ch ON ch.ROWID = c.chat_id
                 WHERE m.ROWID > ?1
                 GROUP BY c.chat_id",
            )
            .unwrap();
        let rows: Vec<(i64, String, i64, i64)> = stmt
            .query_map([cursor], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        if rows.is_empty() {
            println!(
                "wal changed, no new message rows (checked in {:?})",
                t.elapsed()
            );
            continue;
        }
        for (chat_id, guid, count, max_rowid) in &rows {
            println!(
                "+{count} new row(s) in chat_id={chat_id} guid={guid} (query {:?})",
                t.elapsed()
            );
            cursor = cursor.max(*max_rowid);
        }
    }
    println!("done. final cursor: {cursor}");
}
