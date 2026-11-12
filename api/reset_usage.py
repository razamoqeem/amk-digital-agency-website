"""
Reset the usage counters of the Website tools (owner use, local).

    .venv/Scripts/python.exe -m api.reset_usage            every counter for today and this month
    .venv/Scripts/python.exe -m api.reset_usage --all      every counter, including the email step
"""
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import os

db = Path(os.getenv("TOOLS_DATA_DIR", "") or Path(__file__).resolve().parent / "data") / "tools.db"
now = datetime.now(timezone.utc)
with sqlite3.connect(db) as conn:
    if "--all" in sys.argv:
        done = conn.execute("DELETE FROM usage").rowcount
    else:
        done = conn.execute("DELETE FROM usage WHERE period IN (?, ?, 'session')",
                            (now.strftime("%Y-%m-%d"), now.strftime("%Y-%m"))).rowcount
print(f"Removed {done} counter rows.")
