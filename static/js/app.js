(() => {
  const STORAGE_KEYS = {
    THEME: "snapvid_theme",
    CLIENT_ID: "snapvid_client_id",
    HISTORY: "snapvid_history_v1",
    COOKIES_TXT: "snapvid_cookies_txt",
    BROWSER_COOKIES: "snapvid_browser_cookies",
  };

  const state = {
    clientId: localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || "",
    clientInfo: null,
    publicSettings: null,
    media: null,
    mode: "video",          // "video" | "audio" | "file"
    videoExt: "mp4",
    selectedQuality: "1080",
    selectedFileExt: "bin",
    selectedAudioId: "mp3_320",
    entryIndex: 0,
    isAnalyzing: false,
    isDownloading: false,
    pollTimer: null,
  };

  const el = {
    html: document.documentElement,
    announcementBar: document.getElementById("announcementBar"),
    announcementWrap: document.getElementById("announcementWrap"),
    announcementText: document.getElementById("announcementText"),
    announcementCtaBtn: document.getElementById("announcementCtaBtn"),

    brandReset: document.getElementById("brandReset"),
    quotaPillBtn: document.getElementById("quotaPillBtn"),
    quotaText: document.getElementById("quotaText"),
    openVipBtn: document.getElementById("openVipBtn"),
    openVipBtnText: document.getElementById("openVipBtnText"),

    themeToggleBtn: document.getElementById("themeToggleBtn"),
    iconSun: document.getElementById("iconSun"),
    iconMoon: document.getElementById("iconMoon"),
    historyBtn: document.getElementById("historyBtn"),
    historyCount: document.getElementById("historyCount"),
    historyModal: document.getElementById("historyModal"),
    historyList: document.getElementById("historyList"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsModal: document.getElementById("settingsModal"),
    cookieActiveDot: document.getElementById("cookieActiveDot"),
    browserCookiesSelect: document.getElementById("browserCookiesSelect"),
    cookiesTextArea: document.getElementById("cookiesTextArea"),
    saveSettingsBtn: document.getElementById("saveSettingsBtn"),
    resetSettingsBtn: document.getElementById("resetSettingsBtn"),

    analyzeForm: document.getElementById("analyzeForm"),
    urlInput: document.getElementById("urlInput"),
    detectedBadge: document.getElementById("detectedBadge"),
    defaultLinkIcon: document.getElementById("defaultLinkIcon"),
    pasteBtn: document.getElementById("pasteBtn"),
    clearBtn: document.getElementById("clearBtn"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    analyzeBtnText: document.getElementById("analyzeBtnText"),
    analyzeBtnArrow: document.getElementById("analyzeBtnArrow"),
    analyzeSpinner: document.getElementById("analyzeSpinner"),
    errorBanner: document.getElementById("errorBanner"),
    errorText: document.getElementById("errorText"),
    errorUpgradeBtn: document.getElementById("errorUpgradeBtn"),

    analyzingState: document.getElementById("analyzingState"),
    resultSection: document.getElementById("resultSection"),

    thumbWrapper: document.getElementById("thumbWrapper"),
    thumbBlurBg: document.getElementById("thumbBlurBg"),
    thumbImg: document.getElementById("thumbImg"),
    resultPlatformBadge: document.getElementById("resultPlatformBadge"),
    verticalBadge: document.getElementById("verticalBadge"),
    resultDuration: document.getElementById("resultDuration"),
    carouselBar: document.getElementById("carouselBar"),
    resultTitle: document.getElementById("resultTitle"),
    resultAuthor: document.getElementById("resultAuthor"),
    viewsSep: document.getElementById("viewsSep"),
    resultViews: document.getElementById("resultViews"),
    downloadThumbLink: document.getElementById("downloadThumbLink"),
    openSourceLink: document.getElementById("openSourceLink"),

    modeTabsBar: document.getElementById("modeTabsBar"),
    tabVideo: document.getElementById("tabVideo"),
    tabVideoLabel: document.getElementById("tabVideoLabel"),
    tabAudio: document.getElementById("tabAudio"),
    videoContainerBar: document.getElementById("videoContainerBar"),
    qualitySectionLabel: document.getElementById("qualitySectionLabel"),
    qualityGrid: document.getElementById("qualityGrid"),
    downloadBtn: document.getElementById("downloadBtn"),
    downloadBtnLabel: document.getElementById("downloadBtnLabel"),

    progressCard: document.getElementById("progressCard"),
    progressStage: document.getElementById("progressStage"),
    progressPct: document.getElementById("progressPct"),
    progressFill: document.getElementById("progressFill"),
    progressSpeed: document.getElementById("progressSpeed"),
    progressEta: document.getElementById("progressEta"),
    manualSaveRow: document.getElementById("manualSaveRow"),
    manualSaveLink: document.getElementById("manualSaveLink"),

    freeLimitInline: document.getElementById("freeLimitInline"),
    faqLimitNum: document.getElementById("faqLimitNum"),
    landingMonthlyPrice: document.getElementById("landingMonthlyPrice"),
    landingYearlyPrice: document.getElementById("landingYearlyPrice"),

    vipModal: document.getElementById("vipModal"),
    vipClientIdDisplay: document.getElementById("vipClientIdDisplay"),
    vipModalStatusBadge: document.getElementById("vipModalStatusBadge"),
    copyClientIdBtn: document.getElementById("copyClientIdBtn"),
    vipKeyInput: document.getElementById("vipKeyInput"),
    redeemKeyBtn: document.getElementById("redeemKeyBtn"),
    vipKeyFeedback: document.getElementById("vipKeyFeedback"),
    modalMonthlyPrice: document.getElementById("modalMonthlyPrice"),
    modalYearlyPrice: document.getElementById("modalYearlyPrice"),
    contactZaloLink: document.getElementById("contactZaloLink"),
    contactTeleLink: document.getElementById("contactTeleLink"),
    contactFbLink: document.getElementById("contactFbLink"),
    bankNameDisplay: document.getElementById("bankNameDisplay"),
    bankAccDisplay: document.getElementById("bankAccDisplay"),
    bankOwnerDisplay: document.getElementById("bankOwnerDisplay"),
    bankMemoDisplay: document.getElementById("bankMemoDisplay"),
    bankQrImg: document.getElementById("bankQrImg"),
    vipOrderForm: document.getElementById("vipOrderForm"),
    orderPlanSelect: document.getElementById("orderPlanSelect"),
    orderContactInput: document.getElementById("orderContactInput"),
    vipOrderFeedback: document.getElementById("vipOrderFeedback"),
    footerVipLink: document.getElementById("footerVipLink"),
  };

  function apiHeaders(extra = {}) {
    const h = { ...extra };
    if (state.clientId) h["X-Client-ID"] = state.clientId;
    return h;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "Tự động";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `~${(mb / 1024).toFixed(2)} GB`;
    if (mb >= 1) return `~${mb.toFixed(1)} MB`;
    return `~${Math.round(bytes / 1024)} KB`;
  }

  function formatDuration(sec) {
    if (!sec || sec <= 0) return "";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function formatViews(n) {
    if (!n || n <= 0) return "";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} Tr lượt xem`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)} N lượt xem`;
    return `${n} lượt xem`;
  }

  function detectClientPlatform(val) {
    const s = (val || "").toLowerCase();
    if (!s.includes(".")) return null;
    if (s.includes("youtube.com/shorts")) return { label: "Shorts", color: "#ff0033" };
    if (s.includes("youtube.com") || s.includes("youtu.be")) return { label: "YouTube", color: "#ff0033" };
    if (s.includes("instagram.com/reel")) return { label: "IG Reels", color: "#e1306c" };
    if (s.includes("instagram.com") || s.includes("ddinstagram.com")) return { label: "Instagram", color: "#e1306c" };
    if (s.includes("x.com") || s.includes("twitter.com") || s.includes("fxtwitter.com")) return { label: "X", color: "#1d9bf0" };
    if (s.includes("facebook.com/reel") || s.includes("facebook.com/share/r")) return { label: "FB Reels", color: "#1877f2" };
    if (s.includes("facebook.com") || s.includes("fb.watch")) return { label: "Facebook", color: "#1877f2" };
    if (s.includes("tiktok.com")) return { label: "TikTok", color: "#00b8b0" };
    if (s.includes("threads.net") || s.includes("threads.com")) return { label: "Threads", color: "#64748b" };
    if (s.startsWith("http://") || s.startsWith("https://")) return { label: "Link", color: "#10b981" };
    return null;
  }

  function showError(msg, showVipCta = false) {
    if (!msg) {
      el.errorBanner.classList.add("hidden");
      return;
    }
    el.errorText.textContent = msg;
    el.errorUpgradeBtn.classList.toggle("hidden", !showVipCta);
    el.errorBanner.classList.remove("hidden");
  }

  // Sync Client Quota & Settings UI
  function syncClientStatus(clientInfo) {
    if (!clientInfo) return;
    state.clientInfo = clientInfo;
    if (clientInfo.client_id) {
      state.clientId = clientInfo.client_id;
      localStorage.setItem(STORAGE_KEYS.CLIENT_ID, clientInfo.client_id);
    }

    el.vipClientIdDisplay.textContent = state.clientId;
    el.bankMemoDisplay.textContent = `VIP ${state.clientId}`;

    el.quotaPillBtn.classList.remove("is-vip", "is-empty");
    if (clientInfo.is_vip) {
      el.quotaPillBtn.classList.add("is-vip");
      el.quotaText.textContent = `VIP (${clientInfo.vip_days_left}ng)`;
      el.openVipBtnText.textContent = "Gia hạn VIP";
      el.vipModalStatusBadge.textContent = `👑 ${clientInfo.vip_plan || "VIP"} • Còn ${clientInfo.vip_days_left} ngày`;
      el.vipModalStatusBadge.classList.add("active");
    } else {
      const rem = clientInfo.remaining_turns ?? 0;
      const lim = clientInfo.daily_limit ?? 3;
      const isNarrow = window.innerWidth <= 680;
      if (rem <= 0) {
        el.quotaPillBtn.classList.add("is-empty");
        el.quotaText.textContent = isNarrow ? `0/${lim}` : `Hết lượt (0/${lim})`;
      } else {
        el.quotaText.textContent = isNarrow ? `${rem}/${lim}` : `Còn ${rem}/${lim} lượt`;
      }
      el.openVipBtnText.textContent = "Nâng cấp VIP";
      el.vipModalStatusBadge.textContent = `Miễn phí (${rem}/${lim} lượt hôm nay)`;
      el.vipModalStatusBadge.classList.remove("active");
    }
  }

  function syncPublicSettings(settings) {
    if (!settings) return;
    state.publicSettings = settings;

    const lim = settings.daily_free_limit ?? 3;
    if (el.freeLimitInline) el.freeLimitInline.textContent = String(lim);
    if (el.faqLimitNum) el.faqLimitNum.textContent = String(lim);

    // Announcement Banner
    if (settings.announcement_enabled && settings.announcement_rendered) {
      el.announcementBar.classList.remove("hidden");
      el.announcementBar.setAttribute("data-style", settings.announcement_style || "emerald");
      el.announcementText.textContent = settings.announcement_rendered;
      el.announcementWrap.classList.toggle("marquee", Boolean(settings.announcement_marquee));
      el.announcementCtaBtn.textContent = settings.announcement_cta || "Nâng cấp VIP";
    } else {
      el.announcementBar.classList.add("hidden");
    }

    // VIP Pricing & Contacts
    if (settings.vip_monthly_price) {
      el.landingMonthlyPrice.textContent = settings.vip_monthly_price;
      el.modalMonthlyPrice.textContent = settings.vip_monthly_price;
    }
    if (settings.vip_yearly_price) {
      el.landingYearlyPrice.textContent = settings.vip_yearly_price;
      el.modalYearlyPrice.textContent = settings.vip_yearly_price;
    }

    el.contactZaloLink.href = settings.contact_zalo || "#";
    el.contactTeleLink.href = settings.contact_telegram || "#";
    el.contactFbLink.href = settings.contact_facebook || "#";

    el.bankNameDisplay.textContent = settings.bank_name || "";
    el.bankAccDisplay.textContent = settings.bank_account || "";
    el.bankOwnerDisplay.textContent = settings.bank_owner || "";

    if (settings.bank_qr_url && settings.bank_qr_url.startsWith("http")) {
      el.bankQrImg.src = settings.bank_qr_url;
      el.bankQrImg.classList.remove("hidden");
    } else {
      el.bankQrImg.classList.add("hidden");
    }
  }

  async function loadPublicState() {
    try {
      const resp = await fetch("/api/state", { headers: apiHeaders() });
      const data = await resp.json();
      if (resp.ok) {
        syncPublicSettings(data.settings);
        syncClientStatus(data.client);
      }
    } catch {
      // Ignore transient network errors on initial load
    }
  }

  function openVipModal(preferredPlan) {
    if (preferredPlan && el.orderPlanSelect) {
      el.orderPlanSelect.value = preferredPlan;
    }
    el.vipKeyFeedback.classList.add("hidden");
    el.vipOrderFeedback.classList.add("hidden");
    el.vipModal.classList.remove("hidden");
  }

  function applyTheme(theme) {
    el.html.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
    el.iconSun.classList.toggle("hidden", theme !== "dark");
    el.iconMoon.classList.toggle("hidden", theme === "dark");
  }

  function getCookieConfig() {
    const cookies_text = localStorage.getItem(STORAGE_KEYS.COOKIES_TXT) || "";
    const browser_cookies = localStorage.getItem(STORAGE_KEYS.BROWSER_COOKIES) || "";
    return {
      cookies_text: cookies_text.trim() || null,
      browser_cookies: browser_cookies.trim() || null,
    };
  }

  function syncSettingsUI() {
    const cfg = getCookieConfig();
    el.browserCookiesSelect.value = cfg.browser_cookies || "";
    el.cookiesTextArea.value = cfg.cookies_text || "";
    el.cookieActiveDot.classList.toggle("hidden", !(cfg.cookies_text || cfg.browser_cookies));
  }

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]");
    } catch {
      return [];
    }
  }

  function pushHistory(entry) {
    const list = getHistory().filter((item) => !(item.url === entry.url && item.formatTag === entry.formatTag));
    list.unshift({ ...entry, ts: Date.now() });
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(list.slice(0, 25)));
    updateHistoryBadge();
  }

  function updateHistoryBadge() {
    const count = getHistory().length;
    el.historyCount.textContent = String(count);
    el.historyCount.classList.toggle("hidden", count === 0);
  }

  function renderHistoryModal() {
    const list = getHistory();
    el.historyList.innerHTML = "";
    if (!list.length) {
      el.historyList.innerHTML = `<div class="history-empty">Chưa có tệp nào được tải xuống trong phiên này.</div>`;
      return;
    }
    list.forEach((item) => {
      const row = document.createElement("div");
      row.className = "history-item";
      const info = document.createElement("div");
      info.className = "h-info";

      const title = document.createElement("div");
      title.className = "h-title";
      title.textContent = item.title || item.url;

      const meta = document.createElement("div");
      meta.className = "h-meta";
      meta.textContent = `${item.platform} • ${item.formatTag}`;

      info.appendChild(title);
      info.appendChild(meta);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "h-reload-btn";
      btn.textContent = "Mở lại";
      btn.addEventListener("click", () => {
        el.historyModal.classList.add("hidden");
        el.urlInput.value = item.url;
        syncOmniboxBadge();
        analyzeUrl(0);
      });

      row.appendChild(info);
      row.appendChild(btn);
      el.historyList.appendChild(row);
    });
  }

  function syncOmniboxBadge() {
    const val = el.urlInput.value.trim();
    el.clearBtn.classList.toggle("hidden", val.length === 0);
    el.pasteBtn.classList.toggle("hidden", val.length > 0);

    const detected = detectClientPlatform(val);
    if (detected) {
      el.detectedBadge.textContent = detected.label;
      el.detectedBadge.style.backgroundColor = detected.color;
      el.detectedBadge.classList.remove("hidden");
      el.defaultLinkIcon.classList.add("hidden");
    } else {
      el.detectedBadge.classList.add("hidden");
      el.defaultLinkIcon.classList.remove("hidden");
    }
  }

  function renderQualityOptions() {
    if (!state.media) return;
    el.qualityGrid.innerHTML = "";
    el.modeTabsBar.classList.remove("hidden");

    if (state.mode === "video") {
      el.videoContainerBar.classList.remove("hidden");
      el.qualitySectionLabel.textContent = "Chọn độ phân giải hình ảnh";

      const opts = state.media.video_options || [];
      if (!opts.some((o) => o.quality === state.selectedQuality) && opts.length > 0) {
        const rec = opts.find((o) => o.recommended) || opts[0];
        state.selectedQuality = rec.quality;
      }

      opts.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const isSelected = opt.quality === state.selectedQuality;
        btn.className = `quality-item${isSelected ? " selected" : ""}`;

        const left = document.createElement("div");
        left.className = "q-left";

        const titleRow = document.createElement("div");
        titleRow.className = "q-title-row";
        const titleSpan = document.createElement("span");
        titleSpan.textContent = opt.label;
        titleRow.appendChild(titleSpan);

        if (opt.fps) {
          const fpsTag = document.createElement("span");
          fpsTag.className = "q-tag";
          fpsTag.textContent = `${opt.fps}fps`;
          titleRow.appendChild(fpsTag);
        }
        if (opt.hdr) {
          const hdrTag = document.createElement("span");
          hdrTag.className = "q-tag";
          hdrTag.textContent = "HDR";
          titleRow.appendChild(hdrTag);
        }
        if (opt.recommended) {
          const recTag = document.createElement("span");
          recTag.className = "q-tag rec";
          recTag.textContent = "Đề xuất";
          titleRow.appendChild(recTag);
        }

        const sub = document.createElement("div");
        sub.className = "q-sub";
        sub.textContent = opt.quality === "original"
          ? "Tệp gốc nguyên bản từ máy chủ"
          : `${state.videoExt.toUpperCase()} • Hình ảnh + Âm thanh`;

        left.appendChild(titleRow);
        left.appendChild(sub);

        const sizeSpan = document.createElement("span");
        sizeSpan.className = "q-size";
        sizeSpan.textContent = formatBytes(opt.filesize_approx);

        btn.appendChild(left);
        btn.appendChild(sizeSpan);

        btn.addEventListener("click", () => {
          state.selectedQuality = opt.quality;
          renderQualityOptions();
          updateDownloadCtaLabel();
        });

        el.qualityGrid.appendChild(btn);
      });
    } else {
      el.videoContainerBar.classList.add("hidden");
      el.qualitySectionLabel.textContent = "Chọn định dạng & chất lượng âm thanh";

      const opts = state.media.audio_options || [];
      if (!opts.some((o) => o.id === state.selectedAudioId) && opts.length > 0) {
        state.selectedAudioId = opts[0].id;
      }

      opts.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const isSelected = opt.id === state.selectedAudioId;
        btn.className = `quality-item${isSelected ? " selected" : ""}`;

        const left = document.createElement("div");
        left.className = "q-left";

        const titleRow = document.createElement("div");
        titleRow.className = "q-title-row";
        const titleSpan = document.createElement("span");
        titleSpan.textContent = opt.label;
        titleRow.appendChild(titleSpan);

        if (opt.recommended) {
          const recTag = document.createElement("span");
          recTag.className = "q-tag rec";
          recTag.textContent = "Đề xuất";
          titleRow.appendChild(recTag);
        }

        const sub = document.createElement("div");
        sub.className = "q-sub";
        sub.textContent = opt.sublabel;

        left.appendChild(titleRow);
        left.appendChild(sub);

        const sizeSpan = document.createElement("span");
        sizeSpan.className = "q-size";
        sizeSpan.textContent = formatBytes(opt.filesize_approx);

        btn.appendChild(left);
        btn.appendChild(sizeSpan);

        btn.addEventListener("click", () => {
          state.selectedAudioId = opt.id;
          renderQualityOptions();
          updateDownloadCtaLabel();
        });

        el.qualityGrid.appendChild(btn);
      });
    }

    updateDownloadCtaLabel();
  }

  function updateDownloadCtaLabel() {
    if (!state.media) return;
    if (state.mode === "video") {
      const qLabel = state.selectedQuality === "best" ? "HD Gốc" : `${state.selectedQuality}p`;
      el.downloadBtnLabel.textContent = `Tải xuống ${state.videoExt.toUpperCase()} · ${qLabel}`;
    } else {
      const opt = (state.media.audio_options || []).find((a) => a.id === state.selectedAudioId);
      el.downloadBtnLabel.textContent = opt ? `Tải xuống ${opt.label}` : "Tải âm thanh";
    }
  }

  function renderMediaResult(data) {
    state.media = data;
    if (data.client) syncClientStatus(data.client);

    el.resultSection.classList.remove("hidden");
    el.progressCard.classList.add("hidden");
    el.manualSaveRow.classList.add("hidden");

    if (data.thumbnail) {
      const proxied = `/api/thumbnail?url=${encodeURIComponent(data.thumbnail)}`;
      el.thumbImg.src = proxied;
      el.thumbBlurBg.src = proxied;
      el.downloadThumbLink.href = `/api/thumbnail?url=${encodeURIComponent(data.thumbnail)}&download=1&title=${encodeURIComponent(data.title || "thumbnail")}`;
      el.downloadThumbLink.classList.remove("hidden");
    } else {
      el.thumbImg.removeAttribute("src");
      el.thumbBlurBg.removeAttribute("src");
      el.downloadThumbLink.classList.add("hidden");
    }

    el.thumbWrapper.classList.toggle("is-vertical", Boolean(data.is_vertical));
    el.verticalBadge.classList.toggle("hidden", !data.is_vertical);

    el.resultPlatformBadge.textContent = data.platform?.badge || data.platform?.name || "Media";
    if (data.platform?.color) {
      el.resultPlatformBadge.style.borderColor = data.platform.color;
    }

    const durText = formatDuration(data.duration);
    el.resultDuration.textContent = durText;
    el.resultDuration.classList.toggle("hidden", !durText);

    el.carouselBar.innerHTML = "";
    if (data.carousel_count > 1 && Array.isArray(data.carousel_items)) {
      el.carouselBar.classList.remove("hidden");
      data.carousel_items.forEach((item) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = `carousel-pill${item.index === data.selected_entry ? " active" : ""}`;
        pill.textContent = `Video ${item.index + 1}`;
        pill.addEventListener("click", () => {
          if (item.index !== state.entryIndex) analyzeUrl(item.index);
        });
        el.carouselBar.appendChild(pill);
      });
    } else {
      el.carouselBar.classList.add("hidden");
    }

    el.resultTitle.textContent = data.title || "Nội dung tải về";
    el.resultAuthor.textContent = data.author || "";

    const viewsStr = formatViews(data.view_count);
    el.viewsSep.classList.toggle("hidden", !viewsStr);
    el.resultViews.textContent = viewsStr || "";
    el.openSourceLink.href = data.webpage_url || data.url;

    state.mode = "video";
    el.tabVideo.classList.add("active");
    el.tabAudio.classList.remove("active");
    const recVideo = (data.video_options || []).find((o) => o.recommended) || (data.video_options || [])[0];
    if (recVideo) state.selectedQuality = recVideo.quality;

    renderQualityOptions();
  }

  async function analyzeUrl(entryIndex = 0) {
    const raw = el.urlInput.value.trim();
    if (!raw) {
      showError("Vui lòng dán đường dẫn video cần tải.");
      el.urlInput.focus();
      return;
    }
    if (state.isAnalyzing) return;

    showError(null);
    state.isAnalyzing = true;
    state.entryIndex = entryIndex;

    el.analyzeBtn.disabled = true;
    el.analyzeBtnText.textContent = "Đang xử lý";
    el.analyzeBtnArrow.classList.add("hidden");
    el.analyzeSpinner.classList.remove("hidden");
    el.resultSection.classList.add("hidden");
    el.analyzingState.classList.remove("hidden");

    const cookiesCfg = getCookieConfig();

    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          url: raw,
          entry_index: entryIndex,
          ...cookiesCfg,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.detail || "Không thể phân tích liên kết này.");
      }
      renderMediaResult(data);
    } catch (err) {
      showError(err.message || "Không thể kết nối tới máy chủ xử lý.");
    } finally {
      state.isAnalyzing = false;
      el.analyzingState.classList.add("hidden");
      el.analyzeBtn.disabled = false;
      el.analyzeBtnText.textContent = "Tải ngay";
      el.analyzeBtnArrow.classList.remove("hidden");
      el.analyzeSpinner.classList.add("hidden");
    }
  }

  async function triggerDownload() {
    if (!state.media || state.isDownloading) return;

    showError(null);
    state.isDownloading = true;
    el.downloadBtn.disabled = true;
    el.progressCard.classList.remove("hidden");
    el.manualSaveRow.classList.add("hidden");
    el.progressFill.style.width = "4%";
    el.progressPct.textContent = "4%";
    el.progressStage.textContent = "Đang kiểm tra lượt tải & khởi tạo luồng...";
    el.progressSpeed.textContent = "";
    el.progressEta.textContent = "";

    const cookiesCfg = getCookieConfig();
    let payload;
    let formatSummary = "";

    if (state.mode === "video") {
      payload = {
        url: state.media.url,
        mode: "video",
        quality: state.selectedQuality,
        ext: state.videoExt,
        bitrate: "320",
        title: state.media.title,
        entry_index: state.entryIndex,
        is_carousel: state.media.carousel_count > 1,
        ...cookiesCfg,
      };
      formatSummary = `${state.videoExt.toUpperCase()} ${state.selectedQuality === "best" ? "HD" : state.selectedQuality + "p"}`;
    } else {
      const audioOpt = (state.media.audio_options || []).find((a) => a.id === state.selectedAudioId) || {
        ext: "mp3",
        bitrate: "320",
        label: "MP3 320kbps",
      };
      payload = {
        url: state.media.url,
        mode: "audio",
        quality: "best",
        ext: audioOpt.ext,
        bitrate: audioOpt.bitrate,
        title: state.media.title,
        entry_index: state.entryIndex,
        is_carousel: state.media.carousel_count > 1,
        ...cookiesCfg,
      };
      formatSummary = audioOpt.label;
    }

    try {
      const resp = await fetch("/api/download", {
        method: "POST",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (data.client) syncClientStatus(data.client);

      if (resp.status === 402 || data.quota_exceeded) {
        state.isDownloading = false;
        el.downloadBtn.disabled = false;
        el.progressCard.classList.add("hidden");
        showError(data.detail, true);
        openVipModal("VIP Tháng");
        return;
      }

      if (!resp.ok) {
        throw new Error(data.detail || "Không thể bắt đầu tiến trình tải.");
      }

      pollJobProgress(data.job_id, formatSummary);
    } catch (err) {
      state.isDownloading = false;
      el.downloadBtn.disabled = false;
      el.progressCard.classList.add("hidden");
      showError(err.message);
    }
  }

  function pollJobProgress(jobId, formatSummary) {
    if (state.pollTimer) clearInterval(state.pollTimer);

    state.pollTimer = setInterval(async () => {
      try {
        const resp = await fetch(`/api/progress/${jobId}`);
        const job = await resp.json();
        if (!resp.ok) throw new Error(job.detail || "Tiến trình tải bị gián đoạn.");

        const pct = Math.round(job.progress || 0);
        el.progressFill.style.width = `${pct}%`;
        el.progressPct.textContent = `${pct}%`;
        el.progressStage.textContent = job.stage_text || "Đang xử lý...";
        el.progressSpeed.textContent = job.speed ? `Tốc độ: ${job.speed}` : "";
        el.progressEta.textContent = job.eta != null ? `Còn khoảng ${job.eta}s` : "";

        if (job.status === "completed") {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          state.isDownloading = false;
          el.downloadBtn.disabled = false;

          const fileUrl = `/api/file/${jobId}`;
          el.manualSaveLink.href = fileUrl;
          el.manualSaveRow.classList.remove("hidden");

          pushHistory({
            url: state.media.url,
            title: state.media.title,
            platform: state.media.platform?.name || "Media",
            formatTag: formatSummary,
          });

          const a = document.createElement("a");
          a.href = fileUrl;
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => a.remove(), 1500);
        } else if (job.status === "error") {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          state.isDownloading = false;
          el.downloadBtn.disabled = false;
          el.progressCard.classList.add("hidden");
          showError(job.error || "Quá trình xử lý gặp sự cố.");
        }
      } catch (err) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        state.isDownloading = false;
        el.downloadBtn.disabled = false;
        showError(err.message);
      }
    }, 650);
  }

  // VIP Redeem & Order Actions
  el.redeemKeyBtn.addEventListener("click", async () => {
    const code = el.vipKeyInput.value.trim();
    if (!code) return;
    el.redeemKeyBtn.disabled = true;
    el.vipKeyFeedback.classList.add("hidden");

    try {
      const resp = await fetch("/api/vip/redeem", {
        method: "POST",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ code }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Mã không hợp lệ.");

      syncClientStatus(data.client);
      el.vipKeyInput.value = "";
      el.vipKeyFeedback.textContent = data.message;
      el.vipKeyFeedback.className = "vip-feedback ok";
      showError(null);
    } catch (err) {
      el.vipKeyFeedback.textContent = err.message;
      el.vipKeyFeedback.className = "vip-feedback err";
    } finally {
      el.redeemKeyBtn.disabled = false;
    }
  });

  el.vipOrderForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const contact = el.orderContactInput.value.trim();
    const plan = el.orderPlanSelect.value;
    if (!contact) return;

    el.vipOrderFeedback.classList.add("hidden");
    try {
      const resp = await fetch("/api/vip/request", {
        method: "POST",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          plan_type: plan,
          contact_info: contact,
          note: `Thiết bị ${state.clientId}`,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Không thể gửi yêu cầu.");

      el.orderContactInput.value = "";
      el.vipOrderFeedback.textContent = data.message;
      el.vipOrderFeedback.className = "vip-feedback ok";
    } catch (err) {
      el.vipOrderFeedback.textContent = err.message;
      el.vipOrderFeedback.className = "vip-feedback err";
    }
  });

  el.copyClientIdBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.clientId);
      el.copyClientIdBtn.textContent = "Đã sao chép!";
      setTimeout(() => { el.copyClientIdBtn.textContent = "Sao chép mã"; }, 1600);
    } catch {
      // Fallback ignored
    }
  });

  // Event Listeners
  el.analyzeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    analyzeUrl(0);
  });

  el.urlInput.addEventListener("input", () => {
    showError(null);
    syncOmniboxBadge();
  });

  el.urlInput.addEventListener("paste", () => {
    setTimeout(() => {
      syncOmniboxBadge();
      const v = el.urlInput.value.trim();
      if (v.startsWith("http://") || v.startsWith("https://")) analyzeUrl(0);
    }, 60);
  });

  el.pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        el.urlInput.value = text.trim();
        syncOmniboxBadge();
        analyzeUrl(0);
      }
    } catch {
      el.urlInput.focus();
    }
  });

  el.clearBtn.addEventListener("click", () => {
    el.urlInput.value = "";
    showError(null);
    syncOmniboxBadge();
    el.urlInput.focus();
  });

  el.brandReset.addEventListener("click", (e) => {
    e.preventDefault();
    state.media = null;
    el.urlInput.value = "";
    showError(null);
    syncOmniboxBadge();
    el.resultSection.classList.add("hidden");
    el.analyzingState.classList.add("hidden");
  });

  [el.tabVideo, el.tabAudio].forEach((tab) => {
    tab.addEventListener("click", () => {
      state.mode = tab.dataset.mode;
      el.tabVideo.classList.toggle("active", state.mode === "video");
      el.tabAudio.classList.toggle("active", state.mode === "audio");
      renderQualityOptions();
    });
  });

  document.querySelectorAll(".format-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      state.videoExt = pill.dataset.ext;
      document.querySelectorAll(".format-pill").forEach((p) => p.classList.toggle("active", p === pill));
      renderQualityOptions();
    });
  });

  el.downloadBtn.addEventListener("click", triggerDownload);
  el.openVipBtn.addEventListener("click", () => openVipModal());
  el.quotaPillBtn.addEventListener("click", () => openVipModal());
  el.announcementCtaBtn.addEventListener("click", () => openVipModal());
  el.errorUpgradeBtn.addEventListener("click", () => openVipModal());
  el.footerVipLink.addEventListener("click", (e) => {
    e.preventDefault();
    openVipModal();
  });

  document.querySelectorAll("[data-open-vip]").forEach((btn) => {
    btn.addEventListener("click", () => openVipModal(btn.dataset.openVip));
  });

  el.themeToggleBtn.addEventListener("click", () => {
    const current = el.html.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  el.historyBtn.addEventListener("click", () => {
    renderHistoryModal();
    el.historyModal.classList.remove("hidden");
  });

  el.clearHistoryBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.HISTORY);
    updateHistoryBadge();
    renderHistoryModal();
  });

  el.settingsBtn.addEventListener("click", () => {
    syncSettingsUI();
    el.settingsModal.classList.remove("hidden");
  });

  el.saveSettingsBtn.addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEYS.BROWSER_COOKIES, el.browserCookiesSelect.value);
    localStorage.setItem(STORAGE_KEYS.COOKIES_TXT, el.cookiesTextArea.value.trim());
    syncSettingsUI();
    el.settingsModal.classList.add("hidden");
  });

  el.resetSettingsBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.BROWSER_COOKIES);
    localStorage.removeItem(STORAGE_KEYS.COOKIES_TXT);
    syncSettingsUI();
  });

  document.querySelectorAll(".close-modal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.close;
      if (targetId) document.getElementById(targetId)?.classList.add("hidden");
    });
  });

  [el.vipModal, el.historyModal, el.settingsModal].forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      [el.vipModal, el.historyModal, el.settingsModal].forEach((m) => m.classList.add("hidden"));
    }
  });

  window.addEventListener("resize", () => {
    if (state.clientInfo) syncClientStatus(state.clientInfo);
  });

  // Init
  applyTheme(localStorage.getItem(STORAGE_KEYS.THEME) || "dark");
  syncSettingsUI();
  updateHistoryBadge();
  syncOmniboxBadge();
  loadPublicState();
})();
