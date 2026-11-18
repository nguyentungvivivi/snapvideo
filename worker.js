/**
 * SnapVid Cloudflare Worker (Edge Full-Stack + D1 Database + Media Proxy)
 * - Runs Frontend (/ and /admin), SEO (/robots.txt, /sitemap.xml),
 *   Admin Control Panel, Live Announcement Banner, Daily Free Quota (X turns/device),
 *   VIP Keys & VIP Requests 100% natively on Cloudflare Edge + D1 at 0đ.
 * - Proxies media extraction & FFmpeg processing (/api/analyze, /api/download, /api/progress, /api/file)
 *   to the configured Python+FFmpeg backend (D1 setting `backend_url` or `env.BACKEND_URL`).
 */

const DEFAULT_SETTINGS = {
  daily_free_limit: 3,
  announcement_enabled: true,
  announcement_style: "emerald",
  announcement_marquee: false,
  announcement_text:
    "🔥 Thông báo hôm nay: Mỗi thiết bị khách được sử dụng miễn phí {limit} lượt tải tốc độ cao! Bạn muốn tải KHÔNG GIỚI HẠN mọi định dạng 4K, Shorts, Reels & MP3 320kbps? Liên hệ Admin ngay để nâng cấp gói VIP Tháng / Năm cực ưu đãi!",
  announcement_cta: "Nâng cấp VIP ngay",
  vip_monthly_price: "49.000đ / tháng",
  vip_yearly_price: "349.000đ / năm",
  vip_lifetime_price: "799.000đ / vĩnh viễn",
  contact_zalo: "https://zalo.me/0900000000",
  contact_telegram: "https://t.me/admin_snapvid",
  contact_facebook: "https://m.me/admin.snapvid",
  contact_phone: "0900.000.000",
  bank_name: "MB Bank (Ngân hàng Quân Đội)",
  bank_account: "999988886666",
  bank_owner: "QUAN TRI VIEN SNAPVID",
  bank_qr_url: "",
  backend_url: "",
};

const ALLOWED_SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

function jsonRes(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

function nowSec() {
  return Date.now() / 1000;
}

function todayStrVN() {
  // UTC+7 Vietnam date string YYYY-MM-DD
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function startOfDayVNTs() {
  const vnOffset = 7 * 3600 * 1000;
  const d = new Date(Date.now() + vnOffset);
  d.setUTCHours(0, 0, 0, 0);
  return (d.getTime() - vnOffset) / 1000;
}

function randomHex(bytesLen) {
  const arr = new Uint8Array(bytesLen);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  const keyMat = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMat,
    256
  );
  const hex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${salt}$${hex}`;
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.includes("$")) return false;
  const [salt] = stored.split("$", 2);
  const candidate = await hashPassword(password, salt);
  if (candidate.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return diff === 0;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

function normalizeClientId(rawCid) {
  if (rawCid && rawCid.startsWith("SV-") && rawCid.length >= 7 && rawCid.length <= 20) {
    const clean = rawCid
      .slice(3)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (clean.length >= 6) return `SV-${clean.slice(0, 10)}`;
  }
  return `SV-${randomHex(4).toUpperCase()}`;
}

async function resolveClientContext(request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  const rawCid = request.headers.get("x-client-id") || cookies.snapvid_cid || "";
  const clientId = normalizeClientId(rawCid);
  const ip =
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "0.0.0.0";
  const ua = (request.headers.get("user-agent") || "").slice(0, 120);
  const fp = (await sha256Hex(`${ip}|${ua}`)).slice(0, 20);
  return { clientId, ip, ua, fp };
}

async function ensureAdminPasswordSeeded(db) {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'")
    .first();
  if (!row) {
    const salt = randomHex(8);
    const pwHash = await hashPassword("admin123", salt);
    await db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password_hash', ?)")
      .bind(JSON.stringify(pwHash))
      .run();
  }
}

async function getPublicSettings(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  const data = { ...DEFAULT_SETTINGS };
  for (const r of results || []) {
    if (r.key === "admin_password_hash") continue;
    try {
      data[r.key] = JSON.parse(r.value);
    } catch {
      data[r.key] = r.value;
    }
  }
  const lim = Number(data.daily_free_limit ?? 3);
  data.announcement_rendered = String(data.announcement_text || "").replace(/\{limit\}/g, String(lim));
  return data;
}

async function updateSettings(db, updates) {
  const stmts = [];
  for (const [k, rawVal] of Object.entries(updates || {})) {
    if (!ALLOWED_SETTING_KEYS.has(k)) continue;
    let v = rawVal;
    if (k === "daily_free_limit") {
      v = Math.max(0, Math.min(10000, parseInt(v, 10) || 0));
    }
    stmts.push(
      db
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        .bind(k, JSON.stringify(v))
    );
  }
  if (stmts.length > 0) await db.batch(stmts);
  return getPublicSettings(db);
}

async function getOrRegisterClient(db, clientId, ip, fp) {
  const now = nowSec();
  const dStr = todayStrVN();

  let row = await db.prepare("SELECT * FROM clients WHERE client_id = ?").bind(clientId).first();
  if (!row) {
    await db
      .prepare(
        "INSERT INTO clients (client_id, fingerprint, ip_address, created_at, last_seen) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(clientId, fp, ip, now, now)
      .run();
    row = await db.prepare("SELECT * FROM clients WHERE client_id = ?").bind(clientId).first();
  } else {
    await db
      .prepare("UPDATE clients SET last_seen = ?, ip_address = ?, fingerprint = ? WHERE client_id = ?")
      .bind(now, ip, fp, clientId)
      .run();
  }

  const limitRow = await db
    .prepare("SELECT value FROM settings WHERE key = 'daily_free_limit'")
    .first();
  const dailyLimit = limitRow ? Number(JSON.parse(limitRow.value)) : 3;

  const uCid = await db
    .prepare("SELECT used_count FROM daily_usage WHERE subject_key = ? AND date_str = ?")
    .bind(`cid:${clientId}`, dStr)
    .first();
  const uFp = await db
    .prepare("SELECT used_count FROM daily_usage WHERE subject_key = ? AND date_str = ?")
    .bind(`fp:${fp}`, dStr)
    .first();

  const usedToday = Math.max(Number(uCid?.used_count || 0), Number(uFp?.used_count || 0));
  const vipUntil = Number(row?.vip_until || 0);
  const isVip = vipUntil > now;
  const vipDaysLeft = isVip ? Math.max(1, Math.floor((vipUntil - now) / 86400) + 1) : 0;
  const bonusCredits = Number(row?.bonus_credits || 0);
  const freeRemaining = Math.max(0, dailyLimit - usedToday);
  const totalRemaining = isVip ? 999999 : freeRemaining + bonusCredits;

  return {
    client_id: clientId,
    is_vip: isVip,
    vip_plan: isVip ? row?.vip_plan || "VIP" : "",
    vip_until: isVip ? vipUntil : 0,
    vip_days_left: vipDaysLeft,
    daily_limit: dailyLimit,
    used_today: usedToday,
    free_remaining: freeRemaining,
    bonus_credits: bonusCredits,
    remaining_turns: totalRemaining,
    is_blocked: Boolean(row?.is_blocked),
    total_downloads: Number(row?.total_downloads || 0),
  };
}

async function consumeQuota(db, clientId, ip, fp, platform, mode, quality, title) {
  const status = await getOrRegisterClient(db, clientId, ip, fp);
  if (status.is_blocked) {
    return { ok: false, detail: "Thiết bị này hiện đang bị tạm khoá bởi Quản trị viên.", client: status };
  }
  if (!status.is_vip && status.free_remaining <= 0 && status.bonus_credits <= 0) {
    return {
      ok: false,
      detail: `Thiết bị của bạn đã hết ${status.daily_limit}/${status.daily_limit} lượt tải miễn phí hôm nay. Vui lòng nâng cấp VIP (Tháng / Năm) hoặc liên hệ Admin để mở khoá không giới hạn!`,
      client: status,
    };
  }

  const now = nowSec();
  const dStr = todayStrVN();
  const stmts = [];

  if (!status.is_vip) {
    if (status.free_remaining > 0) {
      for (const skey of [`cid:${clientId}`, `fp:${fp}`]) {
        stmts.push(
          db
            .prepare(
              "INSERT INTO daily_usage (subject_key, date_str, used_count) VALUES (?, ?, 1) ON CONFLICT(subject_key, date_str) DO UPDATE SET used_count = used_count + 1"
            )
            .bind(skey, dStr)
        );
      }
    } else {
      stmts.push(
        db
          .prepare("UPDATE clients SET bonus_credits = MAX(0, bonus_credits - 1) WHERE client_id = ?")
          .bind(clientId)
      );
    }
  }

  stmts.push(
    db
      .prepare("UPDATE clients SET total_downloads = total_downloads + 1, last_seen = ? WHERE client_id = ?")
      .bind(now, clientId)
  );
  stmts.push(
    db
      .prepare(
        "INSERT INTO download_logs (client_id, platform, mode, quality, title, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(clientId, platform || "Media", mode || "video", quality || "1080", String(title || "").slice(0, 150), now)
  );

  await db.batch(stmts);
  const updated = await getOrRegisterClient(db, clientId, ip, fp);
  return { ok: true, detail: "OK", client: updated };
}

async function requireAdmin(request, db) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;
  const row = await db
    .prepare("SELECT expires_at FROM admin_sessions WHERE token = ?")
    .bind(token)
    .first();
  if (!row || Number(row.expires_at) < nowSec()) {
    if (row) {
      await db.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
    }
    return false;
  }
  return true;
}

function detectPlatformName(urlStr) {
  const s = String(urlStr || "").toLowerCase();
  if (s.includes("youtube.com/shorts")) return "YouTube Shorts";
  if (s.includes("youtube.com") || s.includes("youtu.be")) return "YouTube";
  if (s.includes("instagram.com/reel")) return "Instagram Reels";
  if (s.includes("instagram.com")) return "Instagram";
  if (s.includes("x.com") || s.includes("twitter.com")) return "X (Twitter)";
  if (s.includes("facebook.com/reel") || s.includes("facebook.com/share/r")) return "Facebook Reels";
  if (s.includes("facebook.com") || s.includes("fb.watch")) return "Facebook";
  if (s.includes("tiktok.com")) return "TikTok";
  if (s.includes("threads.net") || s.includes("threads.com")) return "Threads";
  return "Web Media";
}

async function resolveBackendUrl(db, env) {
  const settings = await getPublicSettings(db);
  const fromDb = String(settings.backend_url || "").trim().replace(/\/+$/, "");
  if (fromDb && (fromDb.startsWith("http://") || fromDb.startsWith("https://"))) {
    return fromDb;
  }
  const fromEnv = String(env.BACKEND_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv && (fromEnv.startsWith("http://") || fromEnv.startsWith("https://"))) {
    return fromEnv;
  }
  return "";
}

async function proxyToMediaBackend(request, backendBase, pathname, search, bodyText = null) {
  const targetUrl = `${backendBase}${pathname}${search}`;
  const headers = new Headers(request.headers);
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  headers.delete("host");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (bodyText !== null) {
    init.body = bodyText;
  } else if (!["GET", "HEAD"].includes(request.method)) {
    init.body = request.body;
  }
  return fetch(targetUrl, init);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, search } = url;
    const method = request.method.toUpperCase();

    if (method === "OPTIONS" && pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization, X-Client-ID",
        },
      });
    }

    // --- Technical SEO ---
    if (pathname === "/robots.txt") {
      return new Response(
        `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${url.origin}/sitemap.xml\n`,
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (pathname === "/sitemap.xml") {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${url.origin}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>`,
        { headers: { "content-type": "application/xml; charset=utf-8" } }
      );
    }

    // --- API Endpoints ---
    if (pathname.startsWith("/api/")) {
      const db = env.DB;

      if (pathname === "/api/health" && method === "GET") {
        const backendUrl = db ? await resolveBackendUrl(db, env) : "";
        return jsonRes({
          status: "ok",
          runtime: "cloudflare-workers",
          d1_ready: Boolean(db),
          backend_configured: Boolean(backendUrl),
          ffmpeg_ready: Boolean(backendUrl),
        });
      }

      if (pathname === "/api/thumbnail" && method === "GET") {
        const target = url.searchParams.get("url") || "";
        if (!target.startsWith("http://") && !target.startsWith("https://")) {
          return jsonRes({ detail: "URL ảnh không hợp lệ." }, 400);
        }
        try {
          const imgResp = await fetch(target, {
            headers: {
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
              accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
          });
          if (!imgResp.ok) return jsonRes({ detail: "Không tải được ảnh bìa." }, 400);
          const ctype = (imgResp.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
          const outHeaders = new Headers({
            "content-type": ctype,
            "cache-control": "public, max-age=3600",
          });
          if (url.searchParams.get("download") === "1") {
            const title = (url.searchParams.get("title") || "thumbnail").replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 60);
            const ext = ctype.includes("png") ? "png" : ctype.includes("webp") ? "webp" : "jpg";
            outHeaders.set("content-disposition", `attachment; filename="${title}_Thumbnail.${ext}"`);
          }
          return new Response(imgResp.body, { headers: outHeaders });
        } catch (err) {
          return jsonRes({ detail: `Lỗi tải ảnh bìa: ${err.message}` }, 400);
        }
      }

      if (!db) {
        return jsonRes({ detail: "Cơ sở dữ liệu D1 chưa được liên kết với Worker." }, 500);
      }

      await ensureAdminPasswordSeeded(db);

      // Public State (Settings + Client Quota)
      if (pathname === "/api/state" && method === "GET") {
        const { clientId, ip, fp } = await resolveClientContext(request);
        const [settings, client] = await Promise.all([
          getPublicSettings(db),
          getOrRegisterClient(db, clientId, ip, fp),
        ]);
        const safeSettings = { ...settings };
        delete safeSettings.backend_url;
        return jsonRes(
          { settings: safeSettings, client },
          200,
          {
            "set-cookie": `snapvid_cid=${encodeURIComponent(clientId)}; Max-Age=31536000; Path=/; SameSite=Lax`,
          }
        );
      }

      // VIP Key Redeem
      if (pathname === "/api/vip/redeem" && method === "POST") {
        const { clientId, ip, fp } = await resolveClientContext(request);
        const body = await request.json().catch(() => ({}));
        const code = String(body.code || "").trim().toUpperCase();
        if (!code) return jsonRes({ detail: "Vui lòng nhập mã kích hoạt VIP." }, 400);

        await getOrRegisterClient(db, clientId, ip, fp);
        const keyRow = await db.prepare("SELECT * FROM vip_keys WHERE code = ?").bind(code).first();
        if (!keyRow || !keyRow.is_active) {
          return jsonRes({ detail: "Mã kích hoạt VIP không tồn tại hoặc đã bị vô hiệu hoá." }, 400);
        }
        if (Number(keyRow.used_count) >= Number(keyRow.max_uses)) {
          return jsonRes({ detail: "Mã VIP này đã hết lượt kích hoạt." }, 400);
        }

        const cRow = await db.prepare("SELECT vip_until FROM clients WHERE client_id = ?").bind(clientId).first();
        const now = nowSec();
        const base = Math.max(now, Number(cRow?.vip_until || 0));
        const newUntil = base + Number(keyRow.duration_days) * 86400;

        await db.batch([
          db.prepare("UPDATE vip_keys SET used_count = used_count + 1 WHERE code = ?").bind(code),
          db
            .prepare("UPDATE clients SET vip_until = ?, vip_plan = ? WHERE client_id = ?")
            .bind(newUntil, keyRow.plan_name, clientId),
        ]);

        const updated = await getOrRegisterClient(db, clientId, ip, fp);
        return jsonRes({
          message: `Kích hoạt thành công ${updated.vip_plan}! Thiết bị của bạn đã được mở khoá không giới hạn.`,
          client: updated,
        });
      }

      // VIP Upgrade Order Request
      if (pathname === "/api/vip/request" && method === "POST") {
        const { clientId, ip, fp } = await resolveClientContext(request);
        await getOrRegisterClient(db, clientId, ip, fp);
        const body = await request.json().catch(() => ({}));
        const planType = String(body.plan_type || "VIP Tháng").trim().slice(0, 64);
        const contactInfo = String(body.contact_info || "").trim().slice(0, 160);
        const note = String(body.note || "").trim().slice(0, 300);
        if (contactInfo.length < 3) {
          return jsonRes({ detail: "Vui lòng nhập SĐT / Zalo / Telegram để Admin liên hệ kích hoạt." }, 400);
        }
        const res = await db
          .prepare(
            "INSERT INTO vip_requests (client_id, plan_type, contact_info, note, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)"
          )
          .bind(clientId, planType, contactInfo, note, nowSec())
          .run();
        return jsonRes({
          request_id: res.meta?.last_row_id || 1,
          message:
            "Đã gửi yêu cầu nâng cấp VIP tới Admin! Admin sẽ kích hoạt trực tiếp cho mã thiết bị của bạn hoặc gửi mã VIP sớm nhất.",
        });
      }

      // --- Admin Auth & Management APIs ---
      if (pathname === "/api/admin/login" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const pw = String(body.password || "");
        const row = await db
          .prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'")
          .first();
        const stored = row ? JSON.parse(row.value) : "";
        if (!(await verifyPassword(pw, stored))) {
          return jsonRes({ detail: "Mật khẩu quản trị không chính xác." }, 401);
        }
        const token = randomHex(24);
        await db
          .prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)")
          .bind(token, nowSec() + 7 * 86400)
          .run();
        return jsonRes({ token });
      }

      if (pathname.startsWith("/api/admin/")) {
        const isAuthed = await requireAdmin(request, db);
        if (!isAuthed) {
          return jsonRes({ detail: "Phiên quản trị không hợp lệ hoặc đã hết hạn." }, 401);
        }

        if (pathname === "/api/admin/overview" && method === "GET") {
          const now = nowSec();
          const startDay = startOfDayVNTs();
          const dStr = todayStrVN();

          const [
            totalDl,
            todayDl,
            totalClients,
            activeToday,
            activeVips,
            pendingReqs,
            recentLogs,
            settings,
            vipKeys,
            clientsRows,
            usageRows,
            vipRequests,
          ] = await Promise.all([
            db.prepare("SELECT COUNT(*) AS c FROM download_logs").first(),
            db.prepare("SELECT COUNT(*) AS c FROM download_logs WHERE created_at >= ?").bind(startDay).first(),
            db.prepare("SELECT COUNT(*) AS c FROM clients").first(),
            db.prepare("SELECT COUNT(*) AS c FROM clients WHERE last_seen >= ?").bind(startDay).first(),
            db.prepare("SELECT COUNT(*) AS c FROM clients WHERE vip_until > ?").bind(now).first(),
            db.prepare("SELECT COUNT(*) AS c FROM vip_requests WHERE status = 'pending'").first(),
            db.prepare("SELECT * FROM download_logs ORDER BY created_at DESC LIMIT 15").all(),
            getPublicSettings(db),
            db.prepare("SELECT * FROM vip_keys ORDER BY created_at DESC LIMIT 200").all(),
            db.prepare("SELECT * FROM clients ORDER BY last_seen DESC LIMIT 200").all(),
            db.prepare("SELECT subject_key, used_count FROM daily_usage WHERE date_str = ?").bind(dStr).all(),
            db.prepare("SELECT * FROM vip_requests ORDER BY created_at DESC LIMIT 100").all(),
          ]);

          const usageMap = {};
          for (const u of usageRows.results || []) {
            usageMap[u.subject_key] = Number(u.used_count || 0);
          }

          const clients = (clientsRows.results || []).map((r) => {
            const used = Math.max(usageMap[`cid:${r.client_id}`] || 0, usageMap[`fp:${r.fingerprint || ""}`] || 0);
            const vipUntil = Number(r.vip_until || 0);
            const isVip = vipUntil > now;
            return {
              client_id: r.client_id,
              ip_address: r.ip_address,
              used_today: used,
              bonus_credits: Number(r.bonus_credits || 0),
              is_vip: isVip,
              vip_plan: isVip ? r.vip_plan : "",
              vip_days_left: isVip ? Math.max(1, Math.floor((vipUntil - now) / 86400) + 1) : 0,
              is_blocked: Boolean(r.is_blocked),
              total_downloads: Number(r.total_downloads || 0),
              last_seen: r.last_seen,
            };
          });

          return jsonRes({
            stats: {
              total_downloads: Number(totalDl?.c || 0),
              today_downloads: Number(todayDl?.c || 0),
              total_clients: Number(totalClients?.c || 0),
              active_clients_today: Number(activeToday?.c || 0),
              active_vips: Number(activeVips?.c || 0),
              pending_vip_requests: Number(pendingReqs?.c || 0),
              recent_logs: recentLogs.results || [],
            },
            settings,
            vip_keys: vipKeys.results || [],
            clients,
            vip_requests: vipRequests.results || [],
          });
        }

        if (pathname === "/api/admin/settings" && method === "POST") {
          const updates = await request.json().catch(() => ({}));
          const updated = await updateSettings(db, updates);
          return jsonRes({ message: "Đã lưu cấu hình hệ thống & thông báo!", settings: updated });
        }

        if (pathname === "/api/admin/keys" && method === "POST") {
          const body = await request.json().catch(() => ({}));
          const planName = String(body.plan_name || "VIP Tháng").slice(0, 64);
          const durationDays = Math.max(1, Math.min(36500, parseInt(body.duration_days, 10) || 30));
          const maxUses = Math.max(1, Math.min(1000, parseInt(body.max_uses, 10) || 1));
          const quantity = Math.max(1, Math.min(50, parseInt(body.quantity, 10) || 1));
          const note = String(body.note || "").slice(0, 140);
          const now = nowSec();
          const created = [];
          const stmts = [];
          for (let i = 0; i < quantity; i++) {
            const code = `VIP-${randomHex(2).toUpperCase()}-${randomHex(2).toUpperCase()}-${randomHex(2).toUpperCase()}`;
            stmts.push(
              db
                .prepare(
                  "INSERT INTO vip_keys (code, plan_name, duration_days, max_uses, used_count, is_active, note, created_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)"
                )
                .bind(code, planName, durationDays, maxUses, note, now)
            );
            created.push({
              code,
              plan_name: planName,
              duration_days: durationDays,
              max_uses: maxUses,
              used_count: 0,
              is_active: true,
              note,
              created_at: now,
            });
          }
          await db.batch(stmts);
          return jsonRes({ created });
        }

        if (pathname.startsWith("/api/admin/keys/") && method === "DELETE") {
          const code = decodeURIComponent(pathname.slice("/api/admin/keys/".length));
          await db.prepare("DELETE FROM vip_keys WHERE code = ?").bind(code).run();
          return jsonRes({ status: "deleted" });
        }

        if (pathname.startsWith("/api/admin/clients/") && method === "POST") {
          const cid = decodeURIComponent(pathname.slice("/api/admin/clients/".length));
          const body = await request.json().catch(() => ({}));
          const action = String(body.action || "");
          const value = parseInt(body.value, 10) || 0;
          const planName = String(body.plan_name || "VIP Admin").slice(0, 64);
          const now = nowSec();
          const dStr = todayStrVN();

          let row = await db.prepare("SELECT * FROM clients WHERE client_id = ?").bind(cid).first();
          if (!row) {
            await db
              .prepare("INSERT INTO clients (client_id, fingerprint, ip_address, created_at, last_seen) VALUES (?, '', '', ?, ?)")
              .bind(cid, now, now)
              .run();
            row = { fingerprint: "", vip_until: 0, is_blocked: 0 };
          }

          if (action === "reset_today") {
            await db
              .prepare("DELETE FROM daily_usage WHERE subject_key IN (?, ?) AND date_str = ?")
              .bind(`cid:${cid}`, `fp:${row.fingerprint || ""}`, dStr)
              .run();
          } else if (action === "add_bonus") {
            await db
              .prepare("UPDATE clients SET bonus_credits = MAX(0, bonus_credits + ?) WHERE client_id = ?")
              .bind(value, cid)
              .run();
          } else if (action === "grant_vip_days") {
            const base = Math.max(now, Number(row.vip_until || 0));
            const newUntil = base + Math.max(1, value) * 86400;
            await db
              .prepare("UPDATE clients SET vip_until = ?, vip_plan = ? WHERE client_id = ?")
              .bind(newUntil, planName, cid)
              .run();
          } else if (action === "revoke_vip") {
            await db
              .prepare("UPDATE clients SET vip_until = 0, vip_plan = '' WHERE client_id = ?")
              .bind(cid)
              .run();
          } else if (action === "toggle_block") {
            const nextBlock = row.is_blocked ? 0 : 1;
            await db.prepare("UPDATE clients SET is_blocked = ? WHERE client_id = ?").bind(nextBlock, cid).run();
          }
          return jsonRes({ status: "ok" });
        }

        if (pathname.startsWith("/api/admin/vip-requests/") && method === "POST") {
          const reqId = parseInt(pathname.slice("/api/admin/vip-requests/".length), 10);
          const body = await request.json().catch(() => ({}));
          const approve = Boolean(body.approve);
          const days = Math.max(1, Math.min(36500, parseInt(body.days, 10) || 30));

          const reqRow = await db.prepare("SELECT * FROM vip_requests WHERE id = ?").bind(reqId).first();
          if (reqRow) {
            const newStatus = approve ? "approved" : "rejected";
            await db.prepare("UPDATE vip_requests SET status = ? WHERE id = ?").bind(newStatus, reqId).run();
            if (approve) {
              const now = nowSec();
              const cid = reqRow.client_id;
              const cRow = await db.prepare("SELECT vip_until FROM clients WHERE client_id = ?").bind(cid).first();
              if (!cRow) {
                await db
                  .prepare(
                    "INSERT INTO clients (client_id, created_at, last_seen, vip_until, vip_plan) VALUES (?, ?, ?, ?, ?)"
                  )
                  .bind(cid, now, now, now + days * 86400, reqRow.plan_type)
                  .run();
              } else {
                const base = Math.max(now, Number(cRow.vip_until || 0));
                await db
                  .prepare("UPDATE clients SET vip_until = ?, vip_plan = ? WHERE client_id = ?")
                  .bind(base + days * 86400, reqRow.plan_type, cid)
                  .run();
              }
            }
          }
          return jsonRes({ status: "ok" });
        }

        if (pathname === "/api/admin/password" && method === "POST") {
          const body = await request.json().catch(() => ({}));
          const oldPw = String(body.old_password || "");
          const newPw = String(body.new_password || "");
          if (newPw.length < 4) {
            return jsonRes({ detail: "Mật khẩu mới phải từ 4 ký tự trở lên." }, 400);
          }
          const row = await db
            .prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'")
            .first();
          const stored = row ? JSON.parse(row.value) : "";
          if (!(await verifyPassword(oldPw, stored))) {
            return jsonRes({ detail: "Mật khẩu hiện tại không đúng." }, 400);
          }
          const newHash = await hashPassword(newPw, randomHex(8));
          await db
            .prepare("UPDATE settings SET value = ? WHERE key = 'admin_password_hash'")
            .bind(JSON.stringify(newHash))
            .run();
          return jsonRes({ message: "Đã cập nhật mật khẩu Admin thành công!" });
        }

        return jsonRes({ detail: "Endpoint không tồn tại." }, 404);
      }

      // --- Media Extraction & Download Proxy (to Python + yt-dlp + FFmpeg Backend) ---
      const backendBase = await resolveBackendUrl(db, env);

      if (pathname === "/api/analyze" && method === "POST") {
        const { clientId, ip, fp } = await resolveClientContext(request);
        const clientInfo = await getOrRegisterClient(db, clientId, ip, fp);
        if (clientInfo.is_blocked) {
          return jsonRes({ detail: "Thiết bị của bạn đã bị khoá quyền truy cập." }, 403);
        }
        const bodyText = await request.text();
        let parsed = {};
        try {
          parsed = JSON.parse(bodyText);
        } catch {}
        const rawUrl = String(parsed.url || "").toLowerCase();
        if (rawUrl.includes("drive.google.com") || rawUrl.includes("docs.google.com")) {
          return jsonRes(
            { detail: "Hệ thống chỉ hỗ trợ tải video & âm thanh mạng xã hội, không hỗ trợ Google Drive." },
            400
          );
        }
        if (!backendBase) {
          return jsonRes(
            {
              detail:
                "Chưa kết nối Máy chủ xử lý Video (Python + FFmpeg). Admin vui lòng vào trang /admin → Mở mục Cài đặt giá & kết nối → Dán link Backend (Hugging Face Spaces / VPS) và bấm Lưu.",
            },
            503
          );
        }
        const upstream = await proxyToMediaBackend(request, backendBase, pathname, search, bodyText);
        if (upstream.ok) {
          const data = await upstream.json();
          data.client = clientInfo;
          return jsonRes(data, upstream.status);
        }
        return upstream;
      }

      if (pathname === "/api/download" && method === "POST") {
        const { clientId, ip, fp } = await resolveClientContext(request);
        const bodyText = await request.text();
        let parsed = {};
        try {
          parsed = JSON.parse(bodyText);
        } catch {}

        if (!backendBase) {
          return jsonRes(
            {
              detail:
                "Chưa kết nối Máy chủ xử lý Video (Python + FFmpeg). Admin vui lòng cài đặt Link Máy chủ xử lý trong trang /admin.",
            },
            503
          );
        }

        const quotaCheck = await consumeQuota(
          db,
          clientId,
          ip,
          fp,
          detectPlatformName(parsed.url),
          parsed.mode || "video",
          parsed.quality || "1080",
          parsed.title || ""
        );
        if (!quotaCheck.ok) {
          return jsonRes(
            { detail: quotaCheck.detail, quota_exceeded: true, client: quotaCheck.client },
            402
          );
        }

        const upstream = await proxyToMediaBackend(request, backendBase, pathname, search, bodyText);
        if (upstream.ok) {
          const data = await upstream.json();
          data.client = quotaCheck.client;
          return jsonRes(data, upstream.status);
        }
        return upstream;
      }

      if (pathname.startsWith("/api/progress/") || pathname.startsWith("/api/file/")) {
        if (!backendBase) {
          return jsonRes({ detail: "Máy chủ xử lý media chưa được kết nối." }, 503);
        }
        return proxyToMediaBackend(request, backendBase, pathname, search);
      }

      return jsonRes({ detail: "API không tồn tại." }, 404);
    }

    // --- Static Assets Routing ---
    if (pathname.startsWith("/static/")) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = pathname.slice("/static".length);
      return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    }

    if (pathname === "/admin") {
      const adminUrl = new URL(request.url);
      adminUrl.pathname = "/admin.html";
      return env.ASSETS.fetch(new Request(adminUrl.toString(), request));
    }

    return env.ASSETS.fetch(request);
  },
};
