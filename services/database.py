import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "snapvid.db"

_db_lock = threading.Lock()
_admin_sessions: Dict[str, float] = {}  # token -> expiry timestamp

DEFAULT_SETTINGS: Dict[str, Any] = {
    "daily_free_limit": 3,
    "announcement_enabled": True,
    "announcement_style": "emerald",  # emerald | gold | ocean
    "announcement_marquee": False,
    "announcement_text": (
        "🔥 Thông báo hôm nay: Mỗi thiết bị khách được sử dụng miễn phí {limit} lượt tải tốc độ cao! "
        "Bạn muốn tải KHÔNG GIỚI HẠN mọi định dạng 4K, Shorts, Reels & MP3 320kbps? "
        "Liên hệ Admin ngay để nâng cấp gói VIP Tháng / Năm cực ưu đãi!"
    ),
    "announcement_cta": "Nâng cấp VIP ngay",
    "vip_monthly_price": "49.000đ / tháng",
    "vip_yearly_price": "349.000đ / năm",
    "vip_lifetime_price": "799.000đ / vĩnh viễn",
    "contact_zalo": "https://zalo.me/0900000000",
    "contact_telegram": "https://t.me/admin_snapvid",
    "contact_facebook": "https://m.me/admin.snapvid",
    "contact_phone": "0900.000.000",
    "bank_name": "MB Bank (Ngân hàng Quân Đội)",
    "bank_account": "999988886666",
    "bank_owner": "QUAN TRI VIEN SNAPVID",
    "bank_qr_url": "",
}


def _hash_password(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"{salt}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    if "$" not in stored:
        return False
    salt, _ = stored.split("$", 1)
    expected = _hash_password(password, salt)
    return hmac.compare_digest(expected, stored)


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=15.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def compute_fingerprint(ip: str, user_agent: str) -> str:
    raw = f"{ip or 'unknown'}|{(user_agent or '')[:120]}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def init_db() -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS clients (
                    client_id TEXT PRIMARY KEY,
                    fingerprint TEXT,
                    ip_address TEXT,
                    vip_until REAL DEFAULT 0,
                    vip_plan TEXT DEFAULT '',
                    bonus_credits INTEGER DEFAULT 0,
                    is_blocked INTEGER DEFAULT 0,
                    total_downloads INTEGER DEFAULT 0,
                    created_at REAL NOT NULL,
                    last_seen REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS daily_usage (
                    subject_key TEXT NOT NULL,
                    date_str TEXT NOT NULL,
                    used_count INTEGER DEFAULT 0,
                    PRIMARY KEY (subject_key, date_str)
                );

                CREATE TABLE IF NOT EXISTS vip_keys (
                    code TEXT PRIMARY KEY,
                    plan_name TEXT NOT NULL,
                    duration_days INTEGER NOT NULL,
                    max_uses INTEGER DEFAULT 1,
                    used_count INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    note TEXT DEFAULT '',
                    created_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS vip_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id TEXT NOT NULL,
                    plan_type TEXT NOT NULL,
                    contact_info TEXT NOT NULL,
                    note TEXT DEFAULT '',
                    status TEXT DEFAULT 'pending',
                    created_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS download_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    quality TEXT NOT NULL,
                    title TEXT DEFAULT '',
                    created_at REAL NOT NULL
                );
                """
            )
            # Seed defaults
            for k, v in DEFAULT_SETTINGS.items():
                conn.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                    (k, json.dumps(v, ensure_ascii=False)),
                )
            # Seed default admin password ('admin123') if not set
            cur = conn.execute("SELECT value FROM settings WHERE key = 'admin_password_hash'")
            if not cur.fetchone():
                salt = secrets.token_hex(8)
                pw_hash = _hash_password("admin123", salt)
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES ('admin_password_hash', ?)",
                    (json.dumps(pw_hash),),
                )
            conn.commit()
        finally:
            conn.close()


def get_public_settings() -> Dict[str, Any]:
    with _db_lock:
        conn = _get_conn()
        try:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
        finally:
            conn.close()

    data = dict(DEFAULT_SETTINGS)
    for r in rows:
        if r["key"] == "admin_password_hash":
            continue
        try:
            data[r["key"]] = json.loads(r["value"])
        except Exception:
            data[r["key"]] = r["value"]

    # Render {limit} placeholder inside announcement_text dynamically
    limit_val = int(data.get("daily_free_limit") or 3)
    raw_ann = str(data.get("announcement_text") or "")
    data["announcement_rendered"] = raw_ann.replace("{limit}", str(limit_val))
    return data


def update_settings(updates: Dict[str, Any]) -> Dict[str, Any]:
    allowed_keys = set(DEFAULT_SETTINGS.keys())
    with _db_lock:
        conn = _get_conn()
        try:
            for k, v in updates.items():
                if k not in allowed_keys:
                    continue
                if k == "daily_free_limit":
                    v = max(0, min(int(v), 10000))
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (k, json.dumps(v, ensure_ascii=False)),
                )
            conn.commit()
        finally:
            conn.close()
    return get_public_settings()


# --- Admin Auth ---
def admin_login(password: str) -> Optional[str]:
    with _db_lock:
        conn = _get_conn()
        try:
            row = conn.execute(
                "SELECT value FROM settings WHERE key = 'admin_password_hash'"
            ).fetchone()
        finally:
            conn.close()

    if not row:
        return None
    stored = json.loads(row["value"])
    if not _verify_password(password, stored):
        return None

    token = secrets.token_urlsafe(32)
    _admin_sessions[token] = time.time() + 86400 * 7  # 7 days
    return token


def verify_admin_token(token: Optional[str]) -> bool:
    if not token:
        return False
    exp = _admin_sessions.get(token)
    if not exp or time.time() > exp:
        _admin_sessions.pop(token, None)
        return False
    return True


def change_admin_password(old_pw: str, new_pw: str) -> bool:
    with _db_lock:
        conn = _get_conn()
        try:
            row = conn.execute(
                "SELECT value FROM settings WHERE key = 'admin_password_hash'"
            ).fetchone()
            if not row or not _verify_password(old_pw, json.loads(row["value"])):
                return False
            salt = secrets.token_hex(8)
            new_hash = _hash_password(new_pw, salt)
            conn.execute(
                "UPDATE settings SET value = ? WHERE key = 'admin_password_hash'",
                (json.dumps(new_hash),),
            )
            conn.commit()
            return True
        finally:
            conn.close()


# --- Client Quota & VIP Management ---
def normalize_client_id(raw_cid: Optional[str]) -> str:
    if raw_cid and raw_cid.startswith("SV-") and 7 <= len(raw_cid) <= 20:
        clean = "".join(c for c in raw_cid[3:].upper() if c.isalnum())
        if len(clean) >= 6:
            return f"SV-{clean[:10]}"
    return f"SV-{secrets.token_hex(4).upper()}"


def get_or_register_client(client_id: str, ip: str, user_agent: str) -> Dict[str, Any]:
    now = time.time()
    fp = compute_fingerprint(ip, user_agent)
    d_str = today_str()

    with _db_lock:
        conn = _get_conn()
        try:
            row = conn.execute(
                "SELECT * FROM clients WHERE client_id = ?", (client_id,)
            ).fetchone()
            if not row:
                conn.execute(
                    """
                    INSERT INTO clients (client_id, fingerprint, ip_address, created_at, last_seen)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (client_id, fp, ip, now, now),
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM clients WHERE client_id = ?", (client_id,)
                ).fetchone()
            else:
                conn.execute(
                    "UPDATE clients SET last_seen = ?, ip_address = ?, fingerprint = ? WHERE client_id = ?",
                    (now, ip, fp, client_id),
                )
                conn.commit()

            limit_row = conn.execute(
                "SELECT value FROM settings WHERE key = 'daily_free_limit'"
            ).fetchone()
            daily_limit = int(json.loads(limit_row["value"])) if limit_row else 3

            u_cid = conn.execute(
                "SELECT used_count FROM daily_usage WHERE subject_key = ? AND date_str = ?",
                (f"cid:{client_id}", d_str),
            ).fetchone()
            u_fp = conn.execute(
                "SELECT used_count FROM daily_usage WHERE subject_key = ? AND date_str = ?",
                (f"fp:{fp}", d_str),
            ).fetchone()
        finally:
            conn.close()

    used_cid = int(u_cid["used_count"]) if u_cid else 0
    used_fp = int(u_fp["used_count"]) if u_fp else 0
    used_today = max(used_cid, used_fp)

    vip_until = float(row["vip_until"] or 0)
    is_vip = vip_until > now
    vip_days_left = max(0, int((vip_until - now) // 86400) + 1) if is_vip else 0
    bonus_credits = int(row["bonus_credits"] or 0)
    free_remaining = max(0, daily_limit - used_today)
    total_remaining = 999999 if is_vip else (free_remaining + bonus_credits)

    return {
        "client_id": client_id,
        "is_vip": is_vip,
        "vip_plan": row["vip_plan"] if is_vip else "",
        "vip_until": vip_until if is_vip else 0,
        "vip_days_left": vip_days_left,
        "daily_limit": daily_limit,
        "used_today": used_today,
        "free_remaining": free_remaining,
        "bonus_credits": bonus_credits,
        "remaining_turns": total_remaining,
        "is_blocked": bool(row["is_blocked"]),
        "total_downloads": int(row["total_downloads"] or 0),
    }


def consume_client_quota(
    client_id: str,
    ip: str,
    user_agent: str,
    platform: str,
    mode: str,
    quality: str,
    title: str,
) -> tuple[bool, str, Dict[str, Any]]:
    """Atomically verify and deduct 1 turn for free client, or allow unlimited if VIP."""
    status = get_or_register_client(client_id, ip, user_agent)
    if status["is_blocked"]:
        return False, "Thiết bị này hiện đang bị tạm khoá bởi Quản trị viên.", status

    now = time.time()
    fp = compute_fingerprint(ip, user_agent)
    d_str = today_str()

    if not status["is_vip"]:
        if status["free_remaining"] <= 0 and status["bonus_credits"] <= 0:
            limit_n = status["daily_limit"]
            return (
                False,
                f"Thiết bị của bạn đã hết {limit_n}/{limit_n} lượt tải miễn phí hôm nay. "
                "Vui lòng nâng cấp VIP (Tháng / Năm) hoặc liên hệ Admin để mở khoá không giới hạn!",
                status,
            )

    with _db_lock:
        conn = _get_conn()
        try:
            if status["is_vip"]:
                pass  # Unlimited turns
            elif status["free_remaining"] > 0:
                for skey in (f"cid:{client_id}", f"fp:{fp}"):
                    conn.execute(
                        """
                        INSERT INTO daily_usage (subject_key, date_str, used_count)
                        VALUES (?, ?, 1)
                        ON CONFLICT(subject_key, date_str)
                        DO UPDATE SET used_count = used_count + 1
                        """,
                        (skey, d_str),
                    )
            else:
                conn.execute(
                    "UPDATE clients SET bonus_credits = MAX(0, bonus_credits - 1) WHERE client_id = ?",
                    (client_id,),
                )

            conn.execute(
                "UPDATE clients SET total_downloads = total_downloads + 1, last_seen = ? WHERE client_id = ?",
                (now, client_id),
            )
            conn.execute(
                """
                INSERT INTO download_logs (client_id, platform, mode, quality, title, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (client_id, platform, mode, quality, (title or "")[:150], now),
            )
            conn.commit()
        finally:
            conn.close()

    updated = get_or_register_client(client_id, ip, user_agent)
    return True, "OK", updated


# --- VIP Key Activation & Requests ---
def redeem_vip_key(client_id: str, raw_code: str, ip: str, user_agent: str) -> Dict[str, Any]:
    code = (raw_code or "").strip().upper()
    if not code:
        raise ValueError("Vui lòng nhập mã kích hoạt VIP.")

    get_or_register_client(client_id, ip, user_agent)
    now = time.time()

    with _db_lock:
        conn = _get_conn()
        try:
            key_row = conn.execute(
                "SELECT * FROM vip_keys WHERE code = ?", (code,)
            ).fetchone()
            if not key_row or not key_row["is_active"]:
                raise ValueError("Mã kích hoạt VIP không tồn tại hoặc đã bị vô hiệu hoá.")
            if int(key_row["used_count"]) >= int(key_row["max_uses"]):
                raise ValueError("Mã VIP này đã hết lượt kích hoạt.")

            c_row = conn.execute(
                "SELECT vip_until FROM clients WHERE client_id = ?", (client_id,)
            ).fetchone()
            base_time = max(now, float(c_row["vip_until"] or 0)) if c_row else now
            duration_days = int(key_row["duration_days"])
            new_vip_until = base_time + (duration_days * 86400)

            conn.execute(
                "UPDATE vip_keys SET used_count = used_count + 1 WHERE code = ?",
                (code,),
            )
            conn.execute(
                "UPDATE clients SET vip_until = ?, vip_plan = ? WHERE client_id = ?",
                (new_vip_until, key_row["plan_name"], client_id),
            )
            conn.commit()
        finally:
            conn.close()

    return get_or_register_client(client_id, ip, user_agent)


def create_vip_request(client_id: str, plan_type: str, contact_info: str, note: str = "") -> int:
    if not contact_info or len(contact_info.strip()) < 3:
        raise ValueError("Vui lòng nhập SĐT / Zalo / Telegram để Admin liên hệ kích hoạt.")
    now = time.time()
    with _db_lock:
        conn = _get_conn()
        try:
            cur = conn.execute(
                """
                INSERT INTO vip_requests (client_id, plan_type, contact_info, note, status, created_at)
                VALUES (?, ?, ?, ?, 'pending', ?)
                """,
                (client_id, plan_type.strip(), contact_info.strip(), note.strip(), now),
            )
            conn.commit()
            return int(cur.lastrowid)
        finally:
            conn.close()


# --- Admin Management Helpers ---
def generate_vip_keys(
    plan_name: str,
    duration_days: int,
    max_uses: int = 1,
    quantity: int = 1,
    note: str = "",
) -> List[Dict[str, Any]]:
    now = time.time()
    quantity = max(1, min(int(quantity), 50))
    duration_days = max(1, min(int(duration_days), 36500))
    max_uses = max(1, min(int(max_uses), 1000))
    created: List[Dict[str, Any]] = []

    with _db_lock:
        conn = _get_conn()
        try:
            for _ in range(quantity):
                code = f"VIP-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
                conn.execute(
                    """
                    INSERT INTO vip_keys (code, plan_name, duration_days, max_uses, used_count, is_active, note, created_at)
                    VALUES (?, ?, ?, ?, 0, 1, ?, ?)
                    """,
                    (code, plan_name, duration_days, max_uses, note, now),
                )
                created.append(
                    {
                        "code": code,
                        "plan_name": plan_name,
                        "duration_days": duration_days,
                        "max_uses": max_uses,
                        "used_count": 0,
                        "is_active": True,
                        "note": note,
                        "created_at": now,
                    }
                )
            conn.commit()
        finally:
            conn.close()
    return created


def list_vip_keys() -> List[Dict[str, Any]]:
    with _db_lock:
        conn = _get_conn()
        try:
            rows = conn.execute(
                "SELECT * FROM vip_keys ORDER BY created_at DESC LIMIT 200"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


def delete_vip_key(code: str) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute("DELETE FROM vip_keys WHERE code = ?", (code,))
            conn.commit()
        finally:
            conn.close()


def list_clients_admin() -> List[Dict[str, Any]]:
    d_str = today_str()
    now = time.time()
    with _db_lock:
        conn = _get_conn()
        try:
            rows = conn.execute(
                "SELECT * FROM clients ORDER BY last_seen DESC LIMIT 200"
            ).fetchall()
            usage_rows = conn.execute(
                "SELECT subject_key, used_count FROM daily_usage WHERE date_str = ?",
                (d_str,),
            ).fetchall()
        finally:
            conn.close()

    usage_map = {r["subject_key"]: int(r["used_count"]) for r in usage_rows}
    result = []
    for r in rows:
        cid = r["client_id"]
        fp = r["fingerprint"] or ""
        used = max(usage_map.get(f"cid:{cid}", 0), usage_map.get(f"fp:{fp}", 0))
        vip_until = float(r["vip_until"] or 0)
        is_vip = vip_until > now
        result.append(
            {
                "client_id": cid,
                "ip_address": r["ip_address"],
                "used_today": used,
                "bonus_credits": int(r["bonus_credits"] or 0),
                "is_vip": is_vip,
                "vip_plan": r["vip_plan"] if is_vip else "",
                "vip_days_left": max(0, int((vip_until - now) // 86400) + 1) if is_vip else 0,
                "is_blocked": bool(r["is_blocked"]),
                "total_downloads": int(r["total_downloads"] or 0),
                "last_seen": r["last_seen"],
            }
        )
    return result


def admin_modify_client(
    client_id: str,
    action: str,
    value: int = 0,
    plan_name: str = "VIP Admin",
) -> None:
    d_str = today_str()
    now = time.time()
    with _db_lock:
        conn = _get_conn()
        try:
            row = conn.execute(
                "SELECT * FROM clients WHERE client_id = ?", (client_id,)
            ).fetchone()
            if not row:
                conn.execute(
                    "INSERT INTO clients (client_id, fingerprint, ip_address, created_at, last_seen) VALUES (?, '', '', ?, ?)",
                    (client_id, now, now),
                )
                fp = ""
            else:
                fp = row["fingerprint"] or ""

            if action == "reset_today":
                conn.execute(
                    "DELETE FROM daily_usage WHERE subject_key IN (?, ?) AND date_str = ?",
                    (f"cid:{client_id}", f"fp:{fp}", d_str),
                )
            elif action == "add_bonus":
                conn.execute(
                    "UPDATE clients SET bonus_credits = MAX(0, bonus_credits + ?) WHERE client_id = ?",
                    (int(value), client_id),
                )
            elif action == "grant_vip_days":
                base = max(now, float(row["vip_until"] or 0)) if row else now
                new_until = base + max(1, int(value)) * 86400
                conn.execute(
                    "UPDATE clients SET vip_until = ?, vip_plan = ? WHERE client_id = ?",
                    (new_until, plan_name, client_id),
                )
            elif action == "revoke_vip":
                conn.execute(
                    "UPDATE clients SET vip_until = 0, vip_plan = '' WHERE client_id = ?",
                    (client_id,),
                )
            elif action == "toggle_block":
                new_block = 0 if (row and row["is_blocked"]) else 1
                conn.execute(
                    "UPDATE clients SET is_blocked = ? WHERE client_id = ?",
                    (new_block, client_id),
                )
            conn.commit()
        finally:
            conn.close()


def list_vip_requests() -> List[Dict[str, Any]]:
    with _db_lock:
        conn = _get_conn()
        try:
            rows = conn.execute(
                "SELECT * FROM vip_requests ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


def resolve_vip_request(req_id: int, approve: bool, days: int = 30) -> None:
    now = time.time()
    with _db_lock:
        conn = _get_conn()
        try:
            req = conn.execute(
                "SELECT * FROM vip_requests WHERE id = ?", (req_id,)
            ).fetchone()
            if not req:
                return
            new_status = "approved" if approve else "rejected"
            conn.execute(
                "UPDATE vip_requests SET status = ? WHERE id = ?", (new_status, req_id)
            )
            if approve:
                cid = req["client_id"]
                c_row = conn.execute(
                    "SELECT vip_until FROM clients WHERE client_id = ?", (cid,)
                ).fetchone()
                if not c_row:
                    conn.execute(
                        "INSERT INTO clients (client_id, created_at, last_seen, vip_until, vip_plan) VALUES (?, ?, ?, ?, ?)",
                        (cid, now, now, now + days * 86400, req["plan_type"]),
                    )
                else:
                    base = max(now, float(c_row["vip_until"] or 0))
                    conn.execute(
                        "UPDATE clients SET vip_until = ?, vip_plan = ? WHERE client_id = ?",
                        (base + days * 86400, req["plan_type"], cid),
                    )
            conn.commit()
        finally:
            conn.close()


def get_admin_dashboard_stats() -> Dict[str, Any]:
    now = time.time()
    start_of_day = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    with _db_lock:
        conn = _get_conn()
        try:
            total_dl = conn.execute("SELECT COUNT(*) AS c FROM download_logs").fetchone()["c"]
            today_dl = conn.execute(
                "SELECT COUNT(*) AS c FROM download_logs WHERE created_at >= ?", (start_of_day,)
            ).fetchone()["c"]
            total_clients = conn.execute("SELECT COUNT(*) AS c FROM clients").fetchone()["c"]
            active_today = conn.execute(
                "SELECT COUNT(*) AS c FROM clients WHERE last_seen >= ?", (start_of_day,)
            ).fetchone()["c"]
            active_vips = conn.execute(
                "SELECT COUNT(*) AS c FROM clients WHERE vip_until > ?", (now,)
            ).fetchone()["c"]
            pending_reqs = conn.execute(
                "SELECT COUNT(*) AS c FROM vip_requests WHERE status = 'pending'"
            ).fetchone()["c"]
            recent_logs = conn.execute(
                "SELECT * FROM download_logs ORDER BY created_at DESC LIMIT 15"
            ).fetchall()
        finally:
            conn.close()

    return {
        "total_downloads": int(total_dl),
        "today_downloads": int(today_dl),
        "total_clients": int(total_clients),
        "active_clients_today": int(active_today),
        "active_vips": int(active_vips),
        "pending_vip_requests": int(pending_reqs),
        "recent_logs": [dict(r) for r in recent_logs],
    }
