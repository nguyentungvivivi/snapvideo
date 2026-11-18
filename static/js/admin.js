(() => {
  const TOKEN_KEY = "snapvid_admin_token";
  let adminToken = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
  let cachedClients = [];
  let currentDailyLimit = 3;

  const el = {
    loginScreen: document.getElementById("loginScreen"),
    loginForm: document.getElementById("loginForm"),
    adminPasswordInput: document.getElementById("adminPasswordInput"),
    loginError: document.getElementById("loginError"),

    adminShell: document.getElementById("adminShell"),
    refreshAllBtn: document.getElementById("refreshAllBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    adminToast: document.getElementById("adminToast"),

    statTodayDl: document.getElementById("statTodayDl"),
    statTotalDl: document.getElementById("statTotalDl"),
    statActiveClients: document.getElementById("statActiveClients"),
    statTotalClients: document.getElementById("statTotalClients"),
    statActiveVips: document.getElementById("statActiveVips"),
    statPendingReqs: document.getElementById("statPendingReqs"),

    cfgDailyLimit: document.getElementById("cfgDailyLimit"),
    cfgAnnEnabled: document.getElementById("cfgAnnEnabled"),
    cfgAnnText: document.getElementById("cfgAnnText"),
    cfgAnnStyle: document.getElementById("cfgAnnStyle"),
    cfgAnnCta: document.getElementById("cfgAnnCta"),
    cfgAnnMarquee: document.getElementById("cfgAnnMarquee"),
    annLivePreview: document.getElementById("annLivePreview"),

    cfgPriceMonth: document.getElementById("cfgPriceMonth"),
    cfgPriceYear: document.getElementById("cfgPriceYear"),
    cfgPhone: document.getElementById("cfgPhone"),
    cfgZalo: document.getElementById("cfgZalo"),
    cfgTelegram: document.getElementById("cfgTelegram"),
    cfgFacebook: document.getElementById("cfgFacebook"),
    cfgBankName: document.getElementById("cfgBankName"),
    cfgBankAcc: document.getElementById("cfgBankAcc"),
    cfgBankOwner: document.getElementById("cfgBankOwner"),
    cfgBankQr: document.getElementById("cfgBankQr"),
    cfgBackendUrl: document.getElementById("cfgBackendUrl"),
    saveConfigBtn: document.getElementById("saveConfigBtn"),

    createKeysForm: document.getElementById("createKeysForm"),
    keyPlanPreset: document.getElementById("keyPlanPreset"),
    keyMaxUses: document.getElementById("keyMaxUses"),
    keyQuantity: document.getElementById("keyQuantity"),
    keyNote: document.getElementById("keyNote"),
    vipKeysTableBody: document.getElementById("vipKeysTableBody"),
    vipRequestsTableBody: document.getElementById("vipRequestsTableBody"),

    clientSearchInput: document.getElementById("clientSearchInput"),
    clientsTableBody: document.getElementById("clientsTableBody"),

    changePwForm: document.getElementById("changePwForm"),
    oldPwInput: document.getElementById("oldPwInput"),
    newPwInput: document.getElementById("newPwInput"),
  };

  function toast(msg) {
    el.adminToast.textContent = msg;
    el.adminToast.classList.remove("hidden");
    setTimeout(() => el.adminToast.classList.add("hidden"), 2600);
  }

  async function adminFetch(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
      ...(options.headers || {}),
    };
    const resp = await fetch(url, { ...options, headers });
    if (resp.status === 401) {
      adminToken = "";
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      showLogin();
      throw new Error("Phiên đăng nhập đã hết hạn.");
    }
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || "Thao tác thất bại.");
    return data;
  }

  function showLogin() {
    el.adminShell.classList.add("hidden");
    el.loginScreen.classList.remove("hidden");
  }

  function showDashboard() {
    el.loginScreen.classList.add("hidden");
    el.adminShell.classList.remove("hidden");
  }

  function updateAnnPreview() {
    const lim = el.cfgDailyLimit.value || "3";
    const txt = (el.cfgAnnText.value || "").replace(/\{limit\}/g, String(lim));
    el.annLivePreview.textContent = txt || "(Chưa có nội dung thông báo)";
  }

  function populateSettings(s) {
    currentDailyLimit = s.daily_free_limit ?? 3;
    el.cfgDailyLimit.value = currentDailyLimit;
    el.cfgAnnEnabled.checked = Boolean(s.announcement_enabled);
    el.cfgAnnText.value = s.announcement_text || "";
    el.cfgAnnStyle.value = s.announcement_style || "emerald";
    el.cfgAnnCta.value = s.announcement_cta || "Nâng cấp VIP ngay";
    el.cfgAnnMarquee.checked = Boolean(s.announcement_marquee);

    el.cfgPriceMonth.value = s.vip_monthly_price || "";
    el.cfgPriceYear.value = s.vip_yearly_price || "";
    el.cfgPhone.value = s.contact_phone || "";
    el.cfgZalo.value = s.contact_zalo || "";
    el.cfgTelegram.value = s.contact_telegram || "";
    el.cfgFacebook.value = s.contact_facebook || "";
    el.cfgBankName.value = s.bank_name || "";
    el.cfgBankAcc.value = s.bank_account || "";
    el.cfgBankOwner.value = s.bank_owner || "";
    el.cfgBankQr.value = s.bank_qr_url || "";
    if (el.cfgBackendUrl) el.cfgBackendUrl.value = s.backend_url || "";
    updateAnnPreview();
  }

  function renderVipKeys(keys) {
    el.vipKeysTableBody.innerHTML = "";
    if (!keys.length) {
      el.vipKeysTableBody.innerHTML = `<tr><td colspan="4" style="color:#8b98b1;text-align:center;">Chưa có mã VIP nào.</td></tr>`;
      return;
    }
    keys.forEach((k) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="code-chip">${k.code}</span></td>
        <td>${k.plan_name} (${k.duration_days} ngày)${k.note ? `<br><small style="color:#8b98b1">${k.note}</small>` : ""}</td>
        <td>${k.used_count}/${k.max_uses}</td>
        <td>
          <div class="action-btns">
            <button type="button" class="mini-btn" data-copy="${k.code}">Copy</button>
            <button type="button" class="mini-btn danger" data-del-key="${k.code}">Xoá</button>
          </div>
        </td>
      `;
      el.vipKeysTableBody.appendChild(tr);
    });

    el.vipKeysTableBody.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast(`Đã sao chép mã: ${btn.dataset.copy}`);
      });
    });

    el.vipKeysTableBody.querySelectorAll("[data-del-key]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await adminFetch(`/api/admin/keys/${encodeURIComponent(btn.dataset.delKey)}`, { method: "DELETE" });
        toast("Đã xoá mã VIP.");
        loadOverview();
      });
    });
  }

  function renderVipRequests(reqs) {
    el.vipRequestsTableBody.innerHTML = "";
    if (!reqs.length) {
      el.vipRequestsTableBody.innerHTML = `<tr><td colspan="4" style="color:#8b98b1;text-align:center;">Chưa có yêu cầu nâng cấp nào.</td></tr>`;
      return;
    }
    reqs.forEach((r) => {
      const tr = document.createElement("tr");
      const isPending = r.status === "pending";
      tr.innerHTML = `
        <td><span class="code-chip">${r.client_id}</span></td>
        <td><b>${r.plan_type}</b><br><small style="color:#8b98b1">${r.contact_info}</small></td>
        <td>${r.status === "approved" ? '<span class="vip-pill">Đã duyệt</span>' : r.status === "rejected" ? "Từ chối" : "⏳ Chờ duyệt"}</td>
        <td>
          ${isPending ? `
            <div class="action-btns">
              <button type="button" class="mini-btn gold" data-req="${r.id}" data-days="30">Duyệt 30ng</button>
              <button type="button" class="mini-btn gold" data-req="${r.id}" data-days="365">Duyệt 1năm</button>
              <button type="button" class="mini-btn danger" data-reject="${r.id}">Huỷ</button>
            </div>
          ` : "—"}
        </td>
      `;
      el.vipRequestsTableBody.appendChild(tr);
    });

    el.vipRequestsTableBody.querySelectorAll("[data-req]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await adminFetch(`/api/admin/vip-requests/${btn.dataset.req}`, {
          method: "POST",
          body: JSON.stringify({ approve: true, days: Number(btn.dataset.days) }),
        });
        toast("Đã duyệt và kích hoạt VIP cho thiết bị khách!");
        loadOverview();
      });
    });

    el.vipRequestsTableBody.querySelectorAll("[data-reject]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await adminFetch(`/api/admin/vip-requests/${btn.dataset.reject}`, {
          method: "POST",
          body: JSON.stringify({ approve: false, days: 1 }),
        });
        toast("Đã từ chối yêu cầu.");
        loadOverview();
      });
    });
  }

  function renderClientsTable() {
    const q = (el.clientSearchInput.value || "").trim().toLowerCase();
    const list = cachedClients.filter(
      (c) => !q || c.client_id.toLowerCase().includes(q) || (c.ip_address || "").toLowerCase().includes(q)
    );

    el.clientsTableBody.innerHTML = "";
    if (!list.length) {
      el.clientsTableBody.innerHTML = `<tr><td colspan="7" style="color:#8b98b1;text-align:center;">Không tìm thấy thiết bị khách nào.</td></tr>`;
      return;
    }

    list.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="code-chip">${c.client_id}</span></td>
        <td>${c.ip_address || "—"}</td>
        <td><b>${c.used_today}</b> / ${currentDailyLimit}</td>
        <td>+${c.bonus_credits}</td>
        <td>${c.is_vip ? `<span class="vip-pill">👑 ${c.vip_plan || "VIP"} (${c.vip_days_left}ng)</span>` : c.is_blocked ? '<span style="color:#ef4444">Đã khoá</span>' : "Free"}</td>
        <td>${c.total_downloads}</td>
        <td>
          <div class="action-btns">
            <button type="button" class="mini-btn" data-cid="${c.client_id}" data-act="reset_today">Reset hôm nay</button>
            <button type="button" class="mini-btn" data-cid="${c.client_id}" data-act="add_bonus" data-val="5">+5 lượt</button>
            <button type="button" class="mini-btn gold" data-cid="${c.client_id}" data-act="grant_vip_days" data-val="30" data-plan="VIP Tháng">+VIP 30ng</button>
            <button type="button" class="mini-btn gold" data-cid="${c.client_id}" data-act="grant_vip_days" data-val="365" data-plan="VIP Năm">+VIP 1năm</button>
            ${c.is_vip ? `<button type="button" class="mini-btn danger" data-cid="${c.client_id}" data-act="revoke_vip">Huỷ VIP</button>` : ""}
            <button type="button" class="mini-btn danger" data-cid="${c.client_id}" data-act="toggle_block">${c.is_blocked ? "Mở khoá" : "Khoá"}</button>
          </div>
        </td>
      `;
      el.clientsTableBody.appendChild(tr);
    });

    el.clientsTableBody.querySelectorAll("[data-cid]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await adminFetch(`/api/admin/clients/${encodeURIComponent(btn.dataset.cid)}`, {
          method: "POST",
          body: JSON.stringify({
            action: btn.dataset.act,
            value: Number(btn.dataset.val || 0),
            plan_name: btn.dataset.plan || "VIP Admin",
          }),
        });
        toast(`Đã cập nhật thiết bị ${btn.dataset.cid}!`);
        loadOverview();
      });
    });
  }

  async function loadOverview() {
    try {
      const data = await adminFetch("/api/admin/overview", { method: "GET" });
      showDashboard();

      el.statTodayDl.textContent = data.stats.today_downloads;
      el.statTotalDl.textContent = data.stats.total_downloads;
      el.statActiveClients.textContent = data.stats.active_clients_today;
      el.statTotalClients.textContent = data.stats.total_clients;
      el.statActiveVips.textContent = data.stats.active_vips;
      el.statPendingReqs.textContent = data.stats.pending_vip_requests;

      populateSettings(data.settings);
      renderVipKeys(data.vip_keys || []);
      renderVipRequests(data.vip_requests || []);
      cachedClients = data.clients || [];
      renderClientsTable();
    } catch {
      showLogin();
    }
  }

  // Events
  el.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.loginError.classList.add("hidden");
    try {
      const resp = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: el.adminPasswordInput.value }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Sai mật khẩu.");

      adminToken = data.token;
      localStorage.setItem(TOKEN_KEY, adminToken);
      el.adminPasswordInput.value = "";
      loadOverview();
    } catch (err) {
      el.loginError.textContent = err.message;
      el.loginError.classList.remove("hidden");
    }
  });

  el.logoutBtn.addEventListener("click", () => {
    adminToken = "";
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
  });

  el.refreshAllBtn.addEventListener("click", () => {
    loadOverview();
    toast("Đã làm mới dữ liệu.");
  });

  document.querySelectorAll("[data-set-limit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.cfgDailyLimit.value = btn.dataset.setLimit;
      updateAnnPreview();
    });
  });

  el.cfgDailyLimit.addEventListener("input", updateAnnPreview);
  el.cfgAnnText.addEventListener("input", updateAnnPreview);

  el.saveConfigBtn.addEventListener("click", async () => {
    const payload = {
      daily_free_limit: Number(el.cfgDailyLimit.value || 0),
      announcement_enabled: el.cfgAnnEnabled.checked,
      announcement_text: el.cfgAnnText.value,
      announcement_style: el.cfgAnnStyle.value,
      announcement_cta: el.cfgAnnCta.value,
      announcement_marquee: el.cfgAnnMarquee.checked,
      vip_monthly_price: el.cfgPriceMonth.value,
      vip_yearly_price: el.cfgPriceYear.value,
      contact_phone: el.cfgPhone.value,
      contact_zalo: el.cfgZalo.value,
      contact_telegram: el.cfgTelegram.value,
      contact_facebook: el.cfgFacebook.value,
      bank_name: el.cfgBankName.value,
      bank_account: el.cfgBankAcc.value,
      bank_owner: el.cfgBankOwner.value,
      bank_qr_url: el.cfgBankQr.value,
      backend_url: el.cfgBackendUrl ? el.cfgBackendUrl.value.trim() : "",
    };
    const res = await adminFetch("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    currentDailyLimit = res.settings.daily_free_limit;
    renderClientsTable();
    toast("Đã lưu cấu hình giới hạn lượt & đăng thông báo lên trang chủ!");
  });

  el.createKeysForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const [plan_name, daysStr] = el.keyPlanPreset.value.split("|");
    await adminFetch("/api/admin/keys", {
      method: "POST",
      body: JSON.stringify({
        plan_name,
        duration_days: Number(daysStr),
        max_uses: Number(el.keyMaxUses.value || 1),
        quantity: Number(el.keyQuantity.value || 1),
        note: el.keyNote.value.trim(),
      }),
    });
    el.keyNote.value = "";
    toast("Đã xuất mã kích hoạt VIP mới!");
    loadOverview();
  });

  el.clientSearchInput.addEventListener("input", renderClientsTable);

  el.changePwForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const res = await adminFetch("/api/admin/password", {
        method: "POST",
        body: JSON.stringify({
          old_password: el.oldPwInput.value,
          new_password: el.newPwInput.value,
        }),
      });
      el.oldPwInput.value = "";
      el.newPwInput.value = "";
      toast(res.message);
    } catch (err) {
      alert(err.message);
    }
  });

  if (adminToken) {
    loadOverview();
  } else {
    showLogin();
  }
})();
