/**
 * TINI Analytics - Sistema de analíticas para fan page de Martina "TINI" Stoessel
 * Versión 1.0
 *
 * Script autónomo que rastrea interacciones del usuario y muestra un dashboard flotante.
 * Se integra mediante <script src="analytics.js"></script> en cualquier página HTML.
 */

(function () {
  'use strict';

  // ============================================================================
  // CONFIGURACIÓN
  // ============================================================================
  const STORAGE_KEY = 'tini_analytics';
  const VISITOR_KEY = 'tini_visitor_id';
  const DASHBOARD_STATE_KEY = 'tini_dashboard_state';

  // ============================================================================
  // UTILIDADES
  // ============================================================================
  function generateVisitorId() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function getToday() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  function getDateNDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return h + 'h ' + m + 'm ' + s + 's';
    }
    if (m > 0) {
      return m + 'm ' + s + 's';
    }
    return s + 's';
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ============================================================================
  // MODELO DE DATOS
  // ============================================================================
  const defaultData = {
    total_visits: 0,
    unique_visits: 0,
    visitors: [],
    click_stats: {
      total: 0,
      categories: {
        links: 0,
        buttons: 0,
        images: 0,
        audio: 0,
        other: 0,
      },
    },
    time_stats: {
      total_seconds: 0,
      current_session_start: null,
      sessions: [],
    },
    songs_played: {
      total: 0,
      songs: {},
    },
    daily_activity: {},
  };

  let analyticsData = null;
  let visitorId = null;
  let isNewVisitor = false;
  let dashboardEl = null;
  let isExpanded = false;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let liveTimerInterval = null;
  let sessionActive = false;

  // ============================================================================
  // CARGA / GUARDADO
  // ============================================================================
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge con defaults para asegurar estructura completa
        analyticsData = deepMerge(defaultData, parsed);
      } else {
        analyticsData = deepClone(defaultData);
      }
    } catch (e) {
      analyticsData = deepClone(defaultData);
    }

    // Cargar/crear visitor ID
    try {
      visitorId = localStorage.getItem(VISITOR_KEY);
      if (!visitorId) {
        visitorId = generateVisitorId();
        localStorage.setItem(VISITOR_KEY, visitorId);
        isNewVisitor = true;
      }
    } catch (e) {
      visitorId = generateVisitorId();
      isNewVisitor = true;
    }
  }

  function deepMerge(defaults, overrides) {
    const result = deepClone(defaults);
    for (const key in overrides) {
      if (overrides.hasOwnProperty(key)) {
        if (
          typeof result[key] === 'object' &&
          result[key] !== null &&
          !Array.isArray(result[key]) &&
          typeof overrides[key] === 'object' &&
          overrides[key] !== null &&
          !Array.isArray(overrides[key])
        ) {
          result[key] = deepMerge(result[key], overrides[key]);
        } else {
          result[key] = deepClone(overrides[key]);
        }
      }
    }
    return result;
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(analyticsData));
    } catch (e) {
      // Si localStorage está lleno, intentar limpiar sesiones viejas
      try {
        if (analyticsData.time_stats.sessions.length > 30) {
          analyticsData.time_stats.sessions = analyticsData.time_stats.sessions.slice(-30);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(analyticsData));
      } catch (e2) {
        // Ignorar si falla de nuevo
      }
    }
  }

  // ============================================================================
  // REGISTRO DE ACTIVIDAD DIARIA
  // ============================================================================
  function ensureDailyRecord(dateStr) {
    if (!analyticsData.daily_activity[dateStr]) {
      analyticsData.daily_activity[dateStr] = {
        visits: 0,
        clicks: 0,
        time_seconds: 0,
        songs: 0,
      };
    }
    return analyticsData.daily_activity[dateStr];
  }

  function incrementDailyVisits(dateStr) {
    const record = ensureDailyRecord(dateStr);
    record.visits += 1;
  }

  function incrementDailyClicks(dateStr) {
    const record = ensureDailyRecord(dateStr);
    record.clicks += 1;
  }

  function addDailyTime(dateStr, seconds) {
    if (seconds <= 0) return;
    const record = ensureDailyRecord(dateStr);
    record.time_seconds += seconds;
  }

  function incrementDailySongs(dateStr) {
    const record = ensureDailyRecord(dateStr);
    record.songs += 1;
  }

  // ============================================================================
  // 1. RASTREO DE VISITAS
  // ============================================================================
  function trackVisit() {
    analyticsData.total_visits += 1;
    incrementDailyVisits(getToday());

    // Visitante único
    if (!analyticsData.visitors.includes(visitorId)) {
      analyticsData.visitors.push(visitorId);
      analyticsData.unique_visits = analyticsData.visitors.length;
    }

    saveData();
  }

  // ============================================================================
  // 2. RASTREO DE CLICS
  // ============================================================================
  function categorizeClick(target) {
    // Revisar si es un enlace
    let el = target;
    while (el && el !== document.body) {
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'a' || el.getAttribute('role') === 'link') {
        return 'links';
      }
      if (tag === 'button' || el.getAttribute('role') === 'button' || el.type === 'button' || el.type === 'submit') {
        return 'buttons';
      }
      if (tag === 'img' || tag === 'picture' || (tag === 'figure' && el.querySelector('img'))) {
        return 'images';
      }
      if (tag === 'audio' || tag === 'video') {
        return 'audio';
      }
      el = el.parentElement;
    }

    // Fallback: si el target mismo es imagen
    const tagName = target.tagName ? target.tagName.toLowerCase() : '';
    if (tagName === 'img') return 'images';
    if (tagName === 'a') return 'links';
    if (tagName === 'button' || tagName === 'input') return 'buttons';

    return 'other';
  }

  function handleClick(e) {
    const category = categorizeClick(e.target);
    analyticsData.click_stats.total += 1;
    analyticsData.click_stats.categories[category] =
      (analyticsData.click_stats.categories[category] || 0) + 1;
    incrementDailyClicks(getToday());
    saveData();
    updateDashboard();
  }

  // ============================================================================
  // 3. RASTREO DE TIEMPO
  // ============================================================================
  function startSession() {
    if (sessionActive) return;
    sessionActive = true;
    analyticsData.time_stats.current_session_start = Date.now();
    saveData();
    startLiveTimer();
  }

  function endSession() {
    if (!sessionActive) return;
    sessionActive = false;

    const now = Date.now();
    const sessionStart = analyticsData.time_stats.current_session_start;
    if (sessionStart) {
      const elapsedSeconds = Math.floor((now - sessionStart) / 1000);
      if (elapsedSeconds > 0) {
        analyticsData.time_stats.total_seconds += elapsedSeconds;
        analyticsData.time_stats.sessions.push({
          start: sessionStart,
          end: now,
          duration: elapsedSeconds,
        });
        // Limitar historial de sesiones
        if (analyticsData.time_stats.sessions.length > 200) {
          analyticsData.time_stats.sessions =
            analyticsData.time_stats.sessions.slice(-200);
        }
        addDailyTime(getToday(), elapsedSeconds);
      }
    }
    analyticsData.time_stats.current_session_start = null;
    saveData();
    stopLiveTimer();
    updateDashboard();
  }

  function getSessionElapsedSeconds() {
    if (analyticsData.time_stats.current_session_start) {
      return Math.floor(
        (Date.now() - analyticsData.time_stats.current_session_start) / 1000
      );
    }
    return 0;
  }

  function getTotalTimeWithSession() {
    return analyticsData.time_stats.total_seconds + getSessionElapsedSeconds();
  }

  // ============================================================================
  // 4. RASTREO DE AUDIO/VIDEO
  // ============================================================================
  function trackMediaElements() {
    // Elementos <audio> y <video> nativos
    const mediaElements = document.querySelectorAll('audio, video');
    mediaElements.forEach(function (media) {
      media.addEventListener('play', function onPlay() {
        const src = media.currentSrc || media.src || 'desconocido';
        analyticsData.songs_played.total += 1;
        if (!analyticsData.songs_played.songs[src]) {
          analyticsData.songs_played.songs[src] = 0;
        }
        analyticsData.songs_played.songs[src] += 1;
        incrementDailySongs(getToday());
        saveData();
        updateDashboard();
      });
    });

    // YouTube iframes - intentar detectar reproducción
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(function (iframe) {
      const src = (iframe.src || '').toLowerCase();
      if (
        src.indexOf('youtube') !== -1 ||
        src.indexOf('youtu.be') !== -1 ||
        src.indexOf('yt') !== -1
      ) {
        // Escuchar mensajes postMessage de YouTube
        var ytHandler = function (event) {
          try {
            var data =
              typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (
              data &&
              (data.event === 'onStateChange' ||
                data.info ? data.info.playerState : false)
            ) {
              var state = data.info
                ? data.info.playerState
                : data.data
                ? data.data
                : null;
              // 1 = reproduciendo (YouTube API)
              if (state === 1) {
                analyticsData.songs_played.total += 1;
                var ytId = 'youtube:' + (iframe.src || 'desconocido');
                if (!analyticsData.songs_played.songs[ytId]) {
                  analyticsData.songs_played.songs[ytId] = 0;
                }
                analyticsData.songs_played.songs[ytId] += 1;
                incrementDailySongs(getToday());
                saveData();
                updateDashboard();
              }
            }
          } catch (e) {
            // Ignorar errores de parseo de postMessage
          }
        };
        window.addEventListener('message', ytHandler);
      }

      // Spotify embeds
      if (src.indexOf('spotify') !== -1) {
        var spotifyHandler = function (event) {
          try {
            var data =
              typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (
              data &&
              data.type === 'playback' &&
              data.isPaused === false
            ) {
              analyticsData.songs_played.total += 1;
              var spId = 'spotify:' + (iframe.src || 'desconocido');
              if (!analyticsData.songs_played.songs[spId]) {
                analyticsData.songs_played.songs[spId] = 0;
              }
              analyticsData.songs_played.songs[spId] += 1;
              incrementDailySongs(getToday());
              saveData();
              updateDashboard();
            }
          } catch (e) {
            // Ignorar
          }
        };
        window.addEventListener('message', spotifyHandler);
      }
    });

    // También buscar elementos con data-atributos comunes de reproductores
    document.querySelectorAll('[data-audio], [data-song], [data-track]').forEach(function (el) {
      el.addEventListener('click', function () {
        // Los clics en estos elementos se contarán como "audio" clicks,
        // pero también verificamos si realmente inician reproducción
        var src = el.getAttribute('data-audio') ||
                   el.getAttribute('data-song') ||
                   el.getAttribute('data-track') || 'desconocido';
        // Moderar: no contar cada clic como canción, solo una vez cada 3s
        var now = Date.now();
        var lastKey = '_last_song_' + src;
        var lastTime = el[lastKey] || 0;
        if (now - lastTime > 3000) {
          analyticsData.songs_played.total += 1;
          if (!analyticsData.songs_played.songs[src]) {
            analyticsData.songs_played.songs[src] = 0;
          }
          analyticsData.songs_played.songs[src] += 1;
          incrementDailySongs(getToday());
          saveData();
          updateDashboard();
          el[lastKey] = now;
        }
      });
    });
  }

  // ============================================================================
  // 5. DASHBOARD FLOTANTE
  // ============================================================================
  function loadDashboardState() {
    try {
      var state = localStorage.getItem(DASHBOARD_STATE_KEY);
      if (state) {
        var parsed = JSON.parse(state);
        isExpanded = parsed.expanded !== false;
      }
    } catch (e) {
      isExpanded = true;
    }
  }

  function saveDashboardState() {
    try {
      localStorage.setItem(
        DASHBOARD_STATE_KEY,
        JSON.stringify({ expanded: isExpanded })
      );
    } catch (e) {
      // Ignorar
    }
  }

  function injectStyles() {
    var style = document.createElement('style');
    style.textContent =
      '\
      @keyframes tiniFadeIn {\
        from { opacity: 0; transform: translateY(20px) scale(0.95); }\
        to { opacity: 1; transform: translateY(0) scale(1); }\
      }\
      @keyframes tiniPulse {\
        0% { box-shadow: 0 0 0 0 rgba(138, 43, 226, 0.6); }\
        70% { box-shadow: 0 0 0 12px rgba(138, 43, 226, 0); }\
        100% { box-shadow: 0 0 0 0 rgba(138, 43, 226, 0); }\
      }\
      @keyframes tiniSlideUp {\
        from { opacity: 0; max-height: 0; }\
        to { opacity: 1; max-height: 500px; }\
      }\
      @keyframes tiniBarGrow {\
        from { height: 0px; }\
      }\
      #tini-dashboard * {\
        box-sizing: border-box;\
        margin: 0;\
        padding: 0;\
      }\
      #tini-dashboard {\
        all: initial;\
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;\
        position: fixed;\
        z-index: 2147483647;\
        bottom: 20px;\
        right: 20px;\
        user-select: none;\
        animation: tiniFadeIn 0.4s ease-out;\
      }\
      #tini-dashboard * {\
        font-family: inherit;\
      }\
      #tini-dashboard .tini-pill {\
        display: flex;\
        align-items: center;\
        gap: 10px;\
        background: rgba(25, 5, 45, 0.92);\
        backdrop-filter: blur(16px);\
        -webkit-backdrop-filter: blur(16px);\
        border: 1px solid rgba(138, 43, 226, 0.35);\
        border-radius: 50px;\
        padding: 10px 18px;\
        cursor: pointer;\
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(138, 43, 226, 0.15) inset;\
        transition: all 0.3s ease;\
        color: #fff;\
        font-size: 14px;\
        animation: tiniPulse 2s infinite;\
      }\
      #tini-dashboard .tini-pill:hover {\
        background: rgba(35, 10, 60, 0.95);\
        border-color: rgba(138, 43, 226, 0.6);\
        transform: scale(1.05);\
      }\
      #tini-dashboard .tini-pill-icon {\
        font-size: 20px;\
        line-height: 1;\
      }\
      #tini-dashboard .tini-pill-count {\
        font-weight: 700;\
        font-size: 16px;\
        color: #c084fc;\
      }\
      #tini-dashboard .tini-panel {\
        width: 300px;\
        background: rgba(20, 5, 40, 0.93);\
        backdrop-filter: blur(20px);\
        -webkit-backdrop-filter: blur(20px);\
        border: 1px solid rgba(138, 43, 226, 0.3);\
        border-radius: 16px;\
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(138, 43, 226, 0.1) inset;\
        color: #e0d0f0;\
        font-size: 13px;\
        line-height: 1.4;\
        overflow: hidden;\
        animation: tiniFadeIn 0.35s ease-out;\
      }\
      #tini-dashboard .tini-header {\
        display: flex;\
        align-items: center;\
        justify-content: space-between;\
        padding: 14px 16px;\
        background: rgba(138, 43, 226, 0.15);\
        border-bottom: 1px solid rgba(138, 43, 226, 0.2);\
        cursor: grab;\
        transition: background 0.2s;\
      }\
      #tini-dashboard .tini-header:active {\
        cursor: grabbing;\
      }\
      #tini-dashboard .tini-header-title {\
        display: flex;\
        align-items: center;\
        gap: 8px;\
        font-weight: 700;\
        font-size: 14px;\
        color: #c084fc;\
      }\
      #tini-dashboard .tini-header-title span {\
        font-size: 16px;\
      }\
      #tini-dashboard .tini-header-actions {\
        display: flex;\
        gap: 6px;\
      }\
      #tini-dashboard .tini-btn {\
        background: rgba(255, 255, 255, 0.06);\
        border: 1px solid rgba(255, 255, 255, 0.1);\
        color: #c084fc;\
        width: 28px;\
        height: 28px;\
        border-radius: 8px;\
        cursor: pointer;\
        display: flex;\
        align-items: center;\
        justify-content: center;\
        font-size: 14px;\
        transition: all 0.2s;\
        padding: 0;\
      }\
      #tini-dashboard .tini-btn:hover {\
        background: rgba(138, 43, 226, 0.3);\
        border-color: rgba(138, 43, 226, 0.5);\
      }\
      #tini-dashboard .tini-body {\
        padding: 12px 16px 16px;\
        max-height: 460px;\
        overflow-y: auto;\
      }\
      #tini-dashboard .tini-body::-webkit-scrollbar {\
        width: 4px;\
      }\
      #tini-dashboard .tini-body::-webkit-scrollbar-track {\
        background: transparent;\
      }\
      #tini-dashboard .tini-body::-webkit-scrollbar-thumb {\
        background: rgba(138, 43, 226, 0.4);\
        border-radius: 4px;\
      }\
      #tini-dashboard .tini-stat-row {\
        display: flex;\
        align-items: center;\
        justify-content: space-between;\
        padding: 8px 0;\
        border-bottom: 1px solid rgba(138, 43, 226, 0.08);\
      }\
      #tini-dashboard .tini-stat-row:last-child {\
        border-bottom: none;\
      }\
      #tini-dashboard .tini-stat-label {\
        display: flex;\
        align-items: center;\
        gap: 8px;\
        color: #b8a0d0;\
        font-size: 13px;\
      }\
      #tini-dashboard .tini-stat-value {\
        font-weight: 700;\
        color: #fff;\
        font-size: 15px;\
      }\
      #tini-dashboard .tini-stat-value.purple {\
        color: #c084fc;\
      }\
      #tini-dashboard .tini-breakdown {\
        margin-top: 4px;\
      }\
      #tini-dashboard .tini-breakdown-item {\
        display: flex;\
        align-items: center;\
        justify-content: space-between;\
        padding: 4px 0 4px 16px;\
        font-size: 12px;\
        color: #a890c0;\
      }\
      #tini-dashboard .tini-breakdown-bar {\
        width: 60px;\
        height: 4px;\
        background: rgba(255, 255, 255, 0.06);\
        border-radius: 4px;\
        overflow: hidden;\
        margin-left: 8px;\
        flex-shrink: 0;\
      }\
      #tini-dashboard .tini-breakdown-bar-fill {\
        height: 100%;\
        background: linear-gradient(90deg, #7c3aed, #c084fc);\
        border-radius: 4px;\
        transition: width 0.5s ease;\
      }\
      #tini-dashboard .tini-section-title {\
        font-size: 11px;\
        text-transform: uppercase;\
        letter-spacing: 1.2px;\
        color: #7c3aed;\
        margin: 12px 0 6px;\
        font-weight: 600;\
      }\
      #tini-dashboard .tini-chart {\
        display: flex;\
        align-items: flex-end;\
        justify-content: space-between;\
        height: 60px;\
        margin: 8px 0 4px;\
        gap: 4px;\
      }\
      #tini-dashboard .tini-chart-bar-wrap {\
        flex: 1;\
        display: flex;\
        flex-direction: column;\
        align-items: center;\
        height: 100%;\
        justify-content: flex-end;\
      }\
      #tini-dashboard .tini-chart-bar {\
        width: 100%;\
        max-width: 28px;\
        background: linear-gradient(to top, #7c3aed, #c084fc);\
        border-radius: 3px 3px 0 0;\
        min-height: 3px;\
        transition: height 0.8s cubic-bezier(0.22, 1, 0.36, 1);\
        animation: tiniBarGrow 0.6s ease-out;\
        box-shadow: 0 0 8px rgba(138, 43, 226, 0.25);\
      }\
      #tini-dashboard .tini-chart-bar.empty {\
        background: rgba(255, 255, 255, 0.08);\
        min-height: 3px;\
        box-shadow: none;\
      }\
      #tini-dashboard .tini-chart-label {\
        font-size: 9px;\
        color: #7c3aed;\
        margin-top: 3px;\
        text-align: center;\
        white-space: nowrap;\
        overflow: hidden;\
        text-overflow: ellipsis;\
        max-width: 100%;\
      }\
      #tini-dashboard .tini-footer {\
        padding: 8px 16px;\
        border-top: 1px solid rgba(138, 43, 226, 0.1);\
        text-align: center;\
        font-size: 10px;\
        color: rgba(255, 255, 255, 0.2);\
        letter-spacing: 0.5px;\
      }\
      #tini-dashboard .tini-live {\
        display: inline-block;\
        width: 6px;\
        height: 6px;\
        background: #22c55e;\
        border-radius: 50%;\
        margin-right: 5px;\
        animation: tiniPulse 1.5s infinite;\
        vertical-align: middle;\
      }\
    ';
    document.head.appendChild(style);
  }

  function buildChartBars() {
    var days = [];
    for (var i = 6; i >= 0; i--) {
      days.push(getDateNDaysAgo(i));
    }

    var maxVal = 0;
    var bars = days.map(function (d) {
      var record = analyticsData.daily_activity[d];
      var val = record ? record.clicks + record.visits : 0;
      if (val > maxVal) maxVal = val;
      return { date: d, value: val };
    });

    // Nombre del día abreviado
    var dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    var html = '<div class="tini-chart">';
    bars.forEach(function (bar) {
      var pct = maxVal > 0 ? (bar.value / maxVal) * 100 : 0;
      var d = new Date(bar.date);
      var label = dayNames[d.getDay()];
      var isEmpty = bar.value === 0;
      html +=
        '<div class="tini-chart-bar-wrap">' +
        '<div class="tini-chart-bar' +
        (isEmpty ? ' empty' : '') +
        '" style="height:' +
        Math.max(pct, 3) +
        '%;" title="' +
        bar.date +
        ': ' +
        bar.value +
        '"></div>' +
        '<div class="tini-chart-label">' +
        label +
        '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function buildBreakdown() {
    var cats = analyticsData.click_stats.categories;
    var total = analyticsData.click_stats.total || 1;
    var labels = {
      links: 'Enlaces',
      buttons: 'Botones',
      images: 'Imágenes',
      audio: 'Audio',
      other: 'Otros',
    };
    var html = '<div class="tini-breakdown">';
    var catKeys = ['links', 'buttons', 'images', 'audio', 'other'];
    catKeys.forEach(function (key) {
      var count = cats[key] || 0;
      var pct = Math.round((count / total) * 100);
      html +=
        '<div class="tini-breakdown-item">' +
        '<span>' +
        labels[key] +
        ': ' +
        count +
        '</span>' +
        '<div class="tini-breakdown-bar">' +
        '<div class="tini-breakdown-bar-fill" style="width:' +
        pct +
        '%;"></div>' +
        '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function buildDashboardHTML() {
    var totalClicks = analyticsData.click_stats.total;
    var totalSongs = analyticsData.songs_played.total;
    var totalTime = getTotalTimeWithSession();
    var visitCount = analyticsData.total_visits;

    return (
      '<div class="tini-panel">' +
      '<div class="tini-header" id="tini-drag-handle">' +
      '<div class="tini-header-title" id="tini-reset-trigger">' +
      '<span>📊</span> TINI Analytics' +
      '</div>' +
      '<div class="tini-header-actions">' +
      '<button class="tini-btn" id="tini-toggle-btn" title="Minimizar">' +
      '−' +
      '</button>' +
      '</div>' +
      '</div>' +
      '<div class="tini-body">' +
      // Visitas
      '<div class="tini-stat-row">' +
      '<span class="tini-stat-label">👁️ Visitas totales</span>' +
      '<span class="tini-stat-value purple">' +
      visitCount +
      '</span>' +
      '</div>' +
      '<div class="tini-stat-row">' +
      '<span class="tini-stat-label">🆕 Visitantes únicos</span>' +
      '<span class="tini-stat-value">' +
      analyticsData.unique_visits +
      '</span>' +
      '</div>' +
      // Clics
      '<div class="tini-stat-row">' +
      '<span class="tini-stat-label">🖱️ Clics totales</span>' +
      '<span class="tini-stat-value purple">' +
      totalClicks +
      '</span>' +
      '</div>' +
      buildBreakdown() +
      // Tiempo
      '<div class="tini-stat-row">' +
      '<span class="tini-stat-label">⏱️ Tiempo en página</span>' +
      '<span class="tini-stat-value" id="tini-live-time">' +
      formatTime(totalTime) +
      '</span>' +
      '</div>' +
      // Canciones
      '<div class="tini-stat-row">' +
      '<span class="tini-stat-label">🎵 Canciones reproducidas</span>' +
      '<span class="tini-stat-value purple">' +
      totalSongs +
      '</span>' +
      '</div>' +
      // Actividad diaria
      '<div class="tini-section-title">📈 Actividad últimos 7 días</div>' +
      buildChartBars() +
      '</div>' +
      '<div class="tini-footer">♥ Hecho para TINI</div>' +
      '</div>'
    );
  }

  function buildPillHTML() {
    return (
      '<div class="tini-pill" id="tini-pill-btn">' +
      '<span class="tini-pill-icon">📊</span>' +
      '<span class="tini-pill-count">' +
      analyticsData.total_visits +
      '</span>' +
      '<span style="color:#a890c0;font-size:12px;">visitas</span>' +
      '<span class="tini-live"></span>' +
      '</div>'
    );
  }

  function updateDashboard() {
    if (!dashboardEl) return;

    if (!isExpanded) {
      var pillContainer = dashboardEl.querySelector('#tini-pill-container');
      if (pillContainer) {
        pillContainer.innerHTML = buildPillHTML();
        var pillBtn = pillContainer.querySelector('#tini-pill-btn');
        if (pillBtn) {
          pillBtn.onclick = function () {
            isExpanded = true;
            saveDashboardState();
            renderDashboard();
          };
        }
      }
      return;
    }

    var panelContainer = dashboardEl.querySelector('#tini-panel-container');
    if (panelContainer) {
      panelContainer.innerHTML = buildDashboardHTML();
      bindDashboardEvents();
    }

    // Actualizar contador de tiempo en vivo
    updateLiveTime();
  }

  function updateLiveTime() {
    var el = document.getElementById('tini-live-time');
    if (el) {
      el.textContent = formatTime(getTotalTimeWithSession());
    }
  }

  function startLiveTimer() {
    stopLiveTimer();
    liveTimerInterval = setInterval(function () {
      updateLiveTime();
    }, 1000);
  }

  function stopLiveTimer() {
    if (liveTimerInterval) {
      clearInterval(liveTimerInterval);
      liveTimerInterval = null;
    }
  }

  function bindDashboardEvents() {
    // Botón toggle (minimizar)
    var toggleBtn = document.getElementById('tini-toggle-btn');
    if (toggleBtn) {
      toggleBtn.onclick = function () {
        isExpanded = false;
        saveDashboardState();
        renderDashboard();
      };
    }

    // Doble clic en el título para resetear (oculto)
    var resetTrigger = document.getElementById('tini-reset-trigger');
    if (resetTrigger) {
      resetTrigger.ondblclick = function (e) {
        e.stopPropagation();
        if (
          confirm(
            '¿Resetear todas las analíticas? Esta acción no se puede deshacer.'
          )
        ) {
          resetAnalytics();
        }
      };
    }

    // Hacer el panel arrastrable
    makeDraggable();
  }

  function makeDraggable() {
    var handle = document.getElementById('tini-drag-handle');
    if (!handle) return;

    var panel = dashboardEl;

    var onMouseDown = function (e) {
      if (e.target.tagName === 'BUTTON') return;
      if (e.target.closest('.tini-header-actions')) return;
      isDragging = true;
      var rect = panel.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      panel.style.transition = 'none';
      document.body.style.cursor = 'grabbing';
      e.preventDefault();
    };

    var onMouseMove = function (e) {
      if (!isDragging) return;
      var x = e.clientX - dragOffsetX;
      var y = e.clientY - dragOffsetY;

      // Limitar a los bordes de la ventana
      var panelW = panel.offsetWidth;
      var panelH = panel.offsetHeight;
      var maxX = window.innerWidth - panelW;
      var maxY = window.innerHeight - panelH;
      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));

      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    var onMouseUp = function () {
      if (isDragging) {
        isDragging = false;
        panel.style.transition = '';
        document.body.style.cursor = '';
      }
    };

    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Touch support
    var onTouchStart = function (e) {
      if (e.target.tagName === 'BUTTON') return;
      if (e.target.closest('.tini-header-actions')) return;
      var touch = e.touches[0];
      isDragging = true;
      var rect = panel.getBoundingClientRect();
      dragOffsetX = touch.clientX - rect.left;
      dragOffsetY = touch.clientY - rect.top;
      panel.style.transition = 'none';
      e.preventDefault();
    };

    var onTouchMove = function (e) {
      if (!isDragging) return;
      var touch = e.touches[0];
      var x = touch.clientX - dragOffsetX;
      var y = touch.clientY - dragOffsetY;
      var panelW = panel.offsetWidth;
      var panelH = panel.offsetHeight;
      var maxX = window.innerWidth - panelW;
      var maxY = window.innerHeight - panelH;
      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    var onTouchEnd = function () {
      if (isDragging) {
        isDragging = false;
        panel.style.transition = '';
      }
    };

    handle.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }

  function renderDashboard() {
    if (!dashboardEl) return;

    dashboardEl.innerHTML = '';

    if (!isExpanded) {
      var pillWrap = document.createElement('div');
      pillWrap.id = 'tini-pill-container';
      pillWrap.innerHTML = buildPillHTML();
      dashboardEl.appendChild(pillWrap);

      var pillBtn = pillWrap.querySelector('#tini-pill-btn');
      if (pillBtn) {
        pillBtn.onclick = function () {
          isExpanded = true;
          saveDashboardState();
          renderDashboard();
        };
      }
    } else {
      var panelWrap = document.createElement('div');
      panelWrap.id = 'tini-panel-container';
      panelWrap.innerHTML = buildDashboardHTML();
      dashboardEl.appendChild(panelWrap);
      bindDashboardEvents();
    }
  }

  function createDashboard() {
    if (document.getElementById('tini-dashboard')) return;

    dashboardEl = document.createElement('div');
    dashboardEl.id = 'tini-dashboard';
    document.body.appendChild(dashboardEl);

    loadDashboardState();
    renderDashboard();
  }

  // ============================================================================
  // RESET
  // ============================================================================
  function resetAnalytics() {
    analyticsData = deepClone(defaultData);
    analyticsData.visitors.push(visitorId);
    analyticsData.unique_visits = 1;
    analyticsData.total_visits = 1;
    incrementDailyVisits(getToday());
    saveData();
    updateDashboard();
  }

  // ============================================================================
  // CAMBIO DE VISIBILIDAD (pausar/reanudar tiempo)
  // ============================================================================
  function handleVisibilityChange() {
    if (document.hidden) {
      endSession();
    } else {
      startSession();
    }
  }

  // ============================================================================
  // INICIALIZACIÓN
  // ============================================================================
  function init() {
    // Cargar datos
    loadData();

    // Inyectar estilos
    injectStyles();

    // Rastrear visita
    trackVisit();

    // Iniciar sesión de tiempo
    startSession();

    // Rastrear clics
    document.addEventListener('click', handleClick, true);

    // Rastrear medios
    trackMediaElements();

    // Visibility change
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // beforeunload - guardar sesión
    window.addEventListener('beforeunload', function () {
      endSession();
      saveData();
    });

    // Crear dashboard
    createDashboard();

    // Actualizar dashboard periódicamente
    setInterval(function () {
      if (isExpanded) {
        updateLiveTime();
        // Refrescar chart y datos cada 5s
        var panelContainer = dashboardEl
          ? dashboardEl.querySelector('#tini-panel-container')
          : null;
        if (panelContainer) {
          var oldBody = panelContainer.querySelector('.tini-body');
          if (oldBody) {
            // Solo reemplazar si hay cambios significativos (cada 5 segundos)
            var newBody = document.createElement('div');
            newBody.className = 'tini-body';
            newBody.innerHTML =
              // Reconstruir el body
              '<div class="tini-stat-row">' +
              '<span class="tini-stat-label">👁️ Visitas totales</span>' +
              '<span class="tini-stat-value purple">' +
              analyticsData.total_visits +
              '</span>' +
              '</div>' +
              '<div class="tini-stat-row">' +
              '<span class="tini-stat-label">🆕 Visitantes únicos</span>' +
              '<span class="tini-stat-value">' +
              analyticsData.unique_visits +
              '</span>' +
              '</div>' +
              '<div class="tini-stat-row">' +
              '<span class="tini-stat-label">🖱️ Clics totales</span>' +
              '<span class="tini-stat-value purple">' +
              analyticsData.click_stats.total +
              '</span>' +
              '</div>' +
              buildBreakdown() +
              '<div class="tini-stat-row">' +
              '<span class="tini-stat-label">⏱️ Tiempo en página</span>' +
              '<span class="tini-stat-value" id="tini-live-time">' +
              formatTime(getTotalTimeWithSession()) +
              '</span>' +
              '</div>' +
              '<div class="tini-stat-row">' +
              '<span class="tini-stat-label">🎵 Canciones reproducidas</span>' +
              '<span class="tini-stat-value purple">' +
              analyticsData.songs_played.total +
              '</span>' +
              '</div>' +
              '<div class="tini-section-title">📈 Actividad últimos 7 días</div>' +
              buildChartBars();
            oldBody.parentNode.replaceChild(newBody, oldBody);
          }
        }
      }
    }, 5000);
  }

  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
