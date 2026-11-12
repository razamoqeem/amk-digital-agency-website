"""
Storage for the tools service: run counters, leads, result cache, daily budget
and the per-minute rate window.

This is the SQLite back end (local PC, later a VPS). Everything the service
needs from storage goes through the ``Store`` class, so a hosted store can be
added later with the same methods without touching the rest of the code.
"""
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage (
    subject_type TEXT NOT NULL,      -- visitor / email / ip
    subject      TEXT NOT NULL,      -- visitor id, or a keyed hash (email, ip)
    tool         TEXT NOT NULL,
    period       TEXT NOT NULL,      -- "life" or a date (YYYY-MM-DD)
    count        INTEGER NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (subject_type, subject, tool, period)
);
CREATE TABLE IF NOT EXISTS leads (
    email_hash    TEXT PRIMARY KEY,
    email         TEXT NOT NULL,
    status        TEXT NOT NULL,     -- pending / confirmed
    token_hash    TEXT,
    visitor_id    TEXT,              -- the visitor who asked for the link
    source_tool   TEXT,
    created_at    INTEGER NOT NULL,
    confirmed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS leads_token ON leads (token_hash);
CREATE TABLE IF NOT EXISTS visitor_email (
    visitor_id TEXT PRIMARY KEY,
    email_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cache (
    key        TEXT PRIMARY KEY,
    body       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS budget (
    upstream TEXT NOT NULL,
    day      TEXT NOT NULL,
    calls    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (upstream, day)
);
CREATE TABLE IF NOT EXISTS rate (
    subject      TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (subject, window_start)
);
"""


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def _db(self):
        conn = sqlite3.connect(self.path, timeout=10)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ---- run counters ------------------------------------------------------
    def get_usage(self, subject_type, subject, tool, period="life") -> int:
        with self._db() as db:
            row = db.execute(
                "SELECT count FROM usage WHERE subject_type=? AND subject=? AND tool=? AND period=?",
                (subject_type, subject, tool, period)).fetchone()
        return row[0] if row else 0

    def incr_usage(self, subject_type, subject, tool, period="life") -> None:
        with self._db() as db:
            db.execute(
                "INSERT INTO usage VALUES (?,?,?,?,1,?) "
                "ON CONFLICT(subject_type, subject, tool, period) "
                "DO UPDATE SET count = count + 1, updated_at = excluded.updated_at",
                (subject_type, subject, tool, period, int(time.time())))

    def raise_usage_to(self, subject_type, subject, tool, count) -> None:
        """Set the life counter to ``count`` if it is currently lower."""
        with self._db() as db:
            db.execute(
                "INSERT INTO usage VALUES (?,?,?,'life',?,?) "
                "ON CONFLICT(subject_type, subject, tool, period) "
                "DO UPDATE SET count = MAX(count, excluded.count), updated_at = excluded.updated_at",
                (subject_type, subject, tool, count, int(time.time())))

    # ---- leads -------------------------------------------------------------
    def save_pending_lead(self, email_hash, email, token_hash, visitor_id, tool) -> None:
        now = int(time.time())
        with self._db() as db:
            db.execute(
                "INSERT INTO leads (email_hash, email, status, token_hash, visitor_id, source_tool, created_at) "
                "VALUES (?,?, 'pending', ?,?,?,?) "
                "ON CONFLICT(email_hash) DO UPDATE SET token_hash = excluded.token_hash, "
                "visitor_id = excluded.visitor_id",
                (email_hash, email, token_hash, visitor_id, tool, now))

    def confirm_lead(self, token_hash):
        """Mark the lead confirmed and return (email_hash, visitor_id), or None."""
        with self._db() as db:
            row = db.execute("SELECT email_hash, visitor_id FROM leads WHERE token_hash=?",
                             (token_hash,)).fetchone()
            if not row:
                return None
            db.execute(
                "UPDATE leads SET status='confirmed', token_hash=NULL, "
                "confirmed_at=COALESCE(confirmed_at, ?) WHERE email_hash=?",
                (int(time.time()), row[0]))
            if row[1]:
                db.execute("INSERT OR REPLACE INTO visitor_email VALUES (?,?)", (row[1], row[0]))
        return row

    def visitor_email(self, visitor_id):
        with self._db() as db:
            row = db.execute("SELECT email_hash FROM visitor_email WHERE visitor_id=?",
                             (visitor_id,)).fetchone()
        return row[0] if row else None

    # ---- result cache ------------------------------------------------------
    def cache_get(self, key):
        with self._db() as db:
            row = db.execute("SELECT body FROM cache WHERE key=? AND expires_at > ?",
                             (key, int(time.time()))).fetchone()
        return json.loads(row[0]) if row else None

    def cache_set(self, key, value, ttl_seconds) -> None:
        now = int(time.time())
        with self._db() as db:
            db.execute("DELETE FROM cache WHERE expires_at <= ?", (now,))
            db.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?)",
                       (key, json.dumps(value), now + ttl_seconds))

    # ---- daily budget ------------------------------------------------------
    def budget_calls(self, upstream, day) -> int:
        with self._db() as db:
            row = db.execute("SELECT calls FROM budget WHERE upstream=? AND day=?",
                             (upstream, day)).fetchone()
        return row[0] if row else 0

    def budget_add(self, upstream, day) -> None:
        with self._db() as db:
            db.execute(
                "INSERT INTO budget VALUES (?,?,1) "
                "ON CONFLICT(upstream, day) DO UPDATE SET calls = calls + 1", (upstream, day))

    # ---- per-minute rate window -------------------------------------------
    def rate_hit(self, subject, window_seconds=60) -> int:
        """Count this request and return how many were made in the current window."""
        window = int(time.time()) // window_seconds * window_seconds
        with self._db() as db:
            db.execute("DELETE FROM rate WHERE window_start < ?", (window,))
            db.execute(
                "INSERT INTO rate VALUES (?,?,1) "
                "ON CONFLICT(subject, window_start) DO UPDATE SET count = count + 1",
                (subject, window))
            row = db.execute("SELECT count FROM rate WHERE subject=? AND window_start=?",
                             (subject, window)).fetchone()
        return row[0]
