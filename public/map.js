/* ====================================================== */
/* Wayfarer — map UI script                                 */
/* ====================================================== */

(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const IATA_RE = /^[A-Z]{3}$/;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /* Silent-mode flag: chat drives UI, not conversation. ?debug=1 restores verbose thread. */
  const chatDebug = new URLSearchParams(location.search).get("debug") === "1";
  if (chatDebug) document.body.classList.add("debug");

  const todayIso = () => new Date().toISOString().slice(0, 10);
  const nextStartIso = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const nextMonthIso = () => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  };
  const monthAfterNextIso = () => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + 2);
    return d.toISOString().slice(0, 10);
  };

  const toast = (() => {
    const stack = $("toast-stack");
    const make = (kind, title, body) => {
      const n = document.createElement("div");
      n.className = "toast " + kind;
      n.innerHTML = `<div style="font-weight:600">${escapeHtml(title)}</div>${body ? `<div style="opacity:.75;font-size:12px;margin-top:2px">${escapeHtml(body)}</div>` : ""}`;
      stack.appendChild(n);
      setTimeout(() => { n.style.opacity = "0"; setTimeout(() => n.remove(), 200); }, 4500);
    };
    return {
      success: (t, b) => make("success", t, b),
      error: (t, b) => make("error", t, b),
      warn: (t, b) => make("warn", t, b),
      info: (t, b) => make("", t, b),
    };
  })();

  /* ====================================================== */
  /* State                                                  */
  /* ====================================================== */
  const state = {
    homeIata: localStorage.getItem("wayfarer.home") || "MLA",
    airline: localStorage.getItem("wayfarer.airline") || "Ryanair",
    airports: [],
    airportsByIata: new Map(),
    markers: new Map(),
    destinations: [],
    faresAirport: null,
    itineraries: [],
    activeItineraryId: null,
    selectedTripItineraryId: null,
    itineraryLayer: null,
    favorites: [],
    sidebarMode: "builder",
    userId: ensureUserId(),
    llmProvider: "",
    llmModel: "",
    llmStatus: null,
    operatorMode: localStorage.getItem("wayfarer.operator") === "1",
    displayName: localStorage.getItem("wayfarer.name") || "",
    fares: [],
    faresSort: "recommendation",
    faresFilters: { ryanair: true, easyjet: false, origin: "", dest: "", date: "" },
    mapFilterOrigin: null,
    mapFilterDestinations: new Set(),
    reachableToHome: new Set(),
    destinationArrowsLayer: null,
    builder: {
      mode: localStorage.getItem("wayfarer.builder.mode") || "multi",
      planner: localStorage.getItem("wayfarer.builder.planner") || "sql",
      maxItineraries: Number(localStorage.getItem("wayfarer.builder.maxItineraries")) || 4,
      dateFrom: localStorage.getItem("wayfarer.builder.dateFrom") || nextStartIso(),
      dateTo: localStorage.getItem("wayfarer.builder.dateTo") || monthAfterNextIso(),
      daysPerStop: Number(localStorage.getItem("wayfarer.builder.daysPerStop")) || 3,
      flexDays: Number(localStorage.getItem("wayfarer.builder.flexDays")) || 1,
      minDays: Number(localStorage.getItem("wayfarer.builder.minDays")) || 3,
      maxDays: Number(localStorage.getItem("wayfarer.builder.maxDays")) || 14,
      multiCity: {
        stops: JSON.parse(localStorage.getItem("wayfarer.builder.multiCity.stops") || "[]"),
        defaultStayDays: Number(localStorage.getItem("wayfarer.builder.multiCity.defaultStayDays")) || 3,
        defaultFlexDays: Number(localStorage.getItem("wayfarer.builder.multiCity.defaultFlexDays")) || 1,
        legFlexDays: Number(localStorage.getItem("wayfarer.builder.multiCity.legFlexDays")) || 2,
        maxTotalPrice: Number(localStorage.getItem("wayfarer.builder.multiCity.maxTotalPrice")) || 350,
        maxLegPrice: Number(localStorage.getItem("wayfarer.builder.multiCity.maxLegPrice")) || 150,
        anchor: JSON.parse(localStorage.getItem("wayfarer.builder.multiCity.anchor") || "null"),
        limit: Number(localStorage.getItem("wayfarer.builder.multiCity.limit")) || 20,
      },
    },
  };

  let chatSessionId = null;
  let chatSessionParameters = {};
  let sessionChannel = null;

  function initSessionChannel() {
    try {
      sessionChannel = new BroadcastChannel("wayfarer-sessions");
      sessionChannel.addEventListener("message", (e) => {
        const { type, sessionId, parameters, sessionData } = e.data;
        if (type === "session_switch") {
          chatSessionId = sessionId;
          chatSessionParameters = parameters || {};
          applySessionParams(chatSessionParameters);
          if (sessionData) {
            const sessions = getStoredSessions();
            const idx = sessions.findIndex((s) => s.id === sessionId);
            if (idx !== -1) {
              sessions[idx] = { ...sessions[idx], ...sessionData };
            } else {
              sessions.push(sessionData);
            }
            saveStoredSessions(sessions);
          }
          const sessions2 = getStoredSessions();
          const session = sessions2.find((s) => s.id === sessionId);
          const label = session?.name || "New chat";
          const currentLabel = $("session-current")?.querySelector(".session-label");
          if (currentLabel) currentLabel.textContent = label;
          renderSessionList();
        } else if (type === "sessions_updated") {
          renderSessionList();
        }
      });
    } catch { /* BroadcastChannel not supported */ }
  }
  function broadcastSessionSwitch(sessionId, parameters) {
    try {
      const sessions = getStoredSessions();
      const sessionData = sessionId ? sessions.find((s) => s.id === sessionId) : null;
      sessionChannel?.postMessage({ type: "session_switch", sessionId, parameters, sessionData });
    } catch { /* ignore */ }
  }
  function broadcastSessionsUpdate() {
    try {
      sessionChannel?.postMessage({ type: "sessions_updated" });
    } catch { /* ignore */ }
  }

  function getChatSessionParams() {
    return {
      origin: state.mapFilterOrigin || state.homeIata || undefined,
      homeIata: state.homeIata || undefined,
      destination: Array.from(state.mapFilterDestinations)[0] || undefined,
      dateFrom: state.builder.dateFrom || undefined,
      dateTo: state.builder.dateTo || undefined,
      mode: state.builder.mode || "multi",
      planner: state.builder.planner || "sql",
      maxItineraries: state.builder.maxItineraries || 4,
      daysPerStop: state.builder.daysPerStop || 3,
      flexDays: state.builder.flexDays || 1,
      minDays: state.builder.minDays || 3,
      maxDays: state.builder.maxDays || 14,
      ...chatSessionParameters,
    };
  }

  function applySessionParams(params) {
    if (!params || typeof params !== "object") return;
    const setLs = (key, value) => { if (value !== undefined && value !== null) localStorage.setItem(key, String(value)); };
    const homeChanged = params.homeIata && typeof params.homeIata === "string" && params.homeIata.toUpperCase() !== state.homeIata;
    if (homeChanged) {
      state.homeIata = params.homeIata.toUpperCase();
      setLs("wayfarer.home", state.homeIata);
    }
    if (params.origin && typeof params.origin === "string") {
      const o = params.origin.toUpperCase();
      if (o !== state.mapFilterOrigin) {
        state.mapFilterOrigin = o;
        if (Array.isArray(state.mapFilterDestinations)) state.mapFilterDestinations = new Set();
      }
    }
    const builderKeys = [
      ["dateFrom", "wayfarer.builder.dateFrom"],
      ["dateTo", "wayfarer.builder.dateTo"],
      ["mode", "wayfarer.builder.mode"],
      ["planner", "wayfarer.builder.planner"],
      ["maxItineraries", "wayfarer.builder.maxItineraries"],
      ["daysPerStop", "wayfarer.builder.daysPerStop"],
      ["flexDays", "wayfarer.builder.flexDays"],
      ["minDays", "wayfarer.builder.minDays"],
      ["maxDays", "wayfarer.builder.maxDays"],
    ];
    for (const [key, lsKey] of builderKeys) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== "") {
        state.builder[key] = params[key];
        setLs(lsKey, params[key]);
      }
    }
    if (typeof renderBuilder === "function" && state.sidebarMode === "builder") renderBuilder();
    if (homeChanged && typeof refreshReachableToHome === "function") {
      refreshReachableToHome().then(() => { if (typeof drawPins === "function") drawPins(); }).catch(() => {});
    }
  }

  function getStoredSessions() {
    try {
      return JSON.parse(localStorage.getItem("wayfarer.sessions") || "[]");
    } catch { return []; }
  }
  function saveStoredSessions(sessions) {
    localStorage.setItem("wayfarer.sessions", JSON.stringify(sessions));
    broadcastSessionsUpdate();
  }
  function updateStoredSession(id, updates) {
    const sessions = getStoredSessions();
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx !== -1) {
      sessions[idx] = { ...sessions[idx], ...updates };
      saveStoredSessions(sessions);
    }
  }
  function removeStoredSession(id) {
    const sessions = getStoredSessions().filter((s) => s.id !== id);
    saveStoredSessions(sessions);
  }

  function formatSessionTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return d.toLocaleDateString();
  }

  function renderSessionList() {
    const list = $("session-list");
    if (!list) return;
    const sessions = getStoredSessions();
    if (sessions.length === 0) {
      list.innerHTML = '<div class="session-empty">No recent sessions</div>';
      return;
    }
    list.innerHTML = sessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => {
        const isActive = s.id === chatSessionId;
        const label = s.name || "New chat";
        return `<div class="session-item${isActive ? " active" : ""}" data-id="${s.id}">
          <div class="session-item-info">
            <div class="session-item-name">${label}</div>
            <div class="session-item-meta">${formatSessionTime(s.updatedAt)}</div>
          </div>
          <button class="session-item-delete" data-delete="${s.id}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`;
      })
      .join("");
    list.querySelectorAll(".session-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".session-item-delete")) return;
        switchToSession(el.dataset.id);
      });
    });
    list.querySelectorAll(".session-item-delete").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteSession(el.dataset.delete);
      });
    });
  }

  function switchToSession(id) {
    const sessions = getStoredSessions();
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    chatSessionId = session.id;
    chatSessionParameters = session.parameters || {};
    applySessionParams(chatSessionParameters);
    updateStoredSession(id, { updatedAt: Date.now() });
    broadcastSessionSwitch(session.id, chatSessionParameters);
    const label = session.name || "New chat";
    const currentLabel = $("session-current")?.querySelector(".session-label");
    if (currentLabel) currentLabel.textContent = label;
    closeSessionDropdown();
    renderSessionList();
  }

  function createNewSession() {
    chatSessionId = null;
    chatSessionParameters = {};
    broadcastSessionSwitch(null, {});
    const currentLabel = $("session-current")?.querySelector(".session-label");
    if (currentLabel) currentLabel.textContent = "New chat";
    closeSessionDropdown();
    renderSessionList();
  }

  function deleteSession(id) {
    removeStoredSession(id);
    const sessions = getStoredSessions();
    if (id === chatSessionId) {
      if (sessions.length > 0) {
        const latest = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        switchToSession(latest.id);
      } else {
        createNewSession();
      }
    } else {
      renderSessionList();
    }
  }

  function openSessionDropdown() {
    renderSessionList();
    $("session-dropdown")?.classList.remove("hidden");
    $("session-current")?.setAttribute("aria-expanded", "true");
  }
  function closeSessionDropdown() {
    $("session-dropdown")?.classList.add("hidden");
    $("session-current")?.setAttribute("aria-expanded", "false");
  }

  function registerSession(id, name, parameters) {
    const sessions = getStoredSessions();
    const existing = sessions.find((s) => s.id === id);
    if (existing) {
      updateStoredSession(id, { name, parameters, updatedAt: Date.now() });
    } else {
      sessions.push({ id, name, parameters, createdAt: Date.now(), updatedAt: Date.now() });
      saveStoredSessions(sessions);
    }
    chatSessionId = id;
    chatSessionParameters = parameters || {};
    broadcastSessionSwitch(id, chatSessionParameters);
    const label = name || "New chat";
    const currentLabel = $("session-current")?.querySelector(".session-label");
    if (currentLabel) currentLabel.textContent = label;
    renderSessionList();
  }

  function ensureUserId() {
    let id = localStorage.getItem("wayfarer.userId");
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
      localStorage.setItem("wayfarer.userId", id);
    }
    return id;
  }

  function loadDestinations() {
    try {
      const raw = localStorage.getItem("wayfarer.destinations");
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((s) => /^[A-Z]{3}$/.test(String(s))) : [];
    } catch { return []; }
  }
  function saveDestinations() {
    localStorage.setItem("wayfarer.destinations", JSON.stringify(state.destinations));
  }

  async function getJson(url) {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    return JSON.parse(text);
  }
  async function postJson(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    return JSON.parse(text);
  }
  async function delJson(url) {
    const r = await fetch(url, { method: "DELETE", headers: { accept: "application/json" } });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    return JSON.parse(text);
  }

  /* ====================================================== */
  /* Map                                                    */
  /* ====================================================== */
  const map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
    worldCopyJump: true,
  }).setView([46.5, 8], 4);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap contributors, © CARTO",
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  /* ====================================================== */
  /* Airport pins                                           */
  /* ====================================================== */
  async function loadAirports() {
    try {
      const r = await getJson(`/api/map/airports`);
      state.airports = r.airports || [];
      state.airportsByIata = new Map(state.airports.map((a) => [a.iata, a]));
      await refreshReachableToHome();
      drawPins();
      flyToHome();
      syncAirlineToggle();
    } catch (e) {
      console.error("loadAirports:", e);
      toast.error("Could not load airports", String(e));
    }
  }

  async function refreshReachableToHome() {
    state.reachableToHome = new Set();
    const home = state.airportsByIata.get(state.homeIata);
    if (!home) return;
    try {
      const r = await getJson(`/api/map/airports/${encodeURIComponent(state.homeIata)}/inbound`);
      const origins = (r.origins || []).filter((s) => /^[A-Z]{3}$/.test(String(s).toUpperCase()));
      for (const o of origins) state.reachableToHome.add(o);
    } catch (e) {
      console.warn("refreshReachableToHome: failed:", e);
    }
  }

  function pinHtml(airport, opts = {}) {
    const klass = ["airport-pin"];
    if (opts.home) klass.push("home");
    if (opts.inTrip) klass.push("in-trip");
    if (opts.faresView) klass.push("fares-view");
    if (opts.filterOrigin) klass.push("filter-origin");
    if (opts.dimmed) klass.push("dimmed");
    if (opts.disabled) klass.push("disabled");
    return `<div class="${klass.join(" ")}" data-iata="${airport.iata}">${airport.iata}</div>`;
  }

  function makeIcon(airport, opts) {
    return L.divIcon({
      className: "airport-pin-wrapper",
      html: pinHtml(airport, opts),
      iconSize: null,
      iconAnchor: [0, 0],
    });
  }

  function pinOpts(iata) {
    const isHome = iata === state.homeIata;
    const isInDest = state.destinations.includes(iata);
    const isFilterOrigin = iata === state.mapFilterOrigin;
    const isConnected = state.mapFilterDestinations.has(iata);
    const canReturnHome = isHome || state.reachableToHome.has(iata);
    const isDisabled = !canReturnHome && !isInDest;

    let dimmed = false;
    if (state.mapFilterOrigin != null && !isHome && !isInDest && !isFilterOrigin && !isConnected) {
      dimmed = true;
    }
    if (state.selectedTripItineraryId != null) {
      const it = state.itineraries.find((x) => x.id === state.selectedTripItineraryId);
      if (it) {
        const tripIatas = new Set([state.homeIata, ...it.legs.map((l) => l.origin), ...it.legs.map((l) => l.destination)]);
        if (!tripIatas.has(iata)) dimmed = true;
      }
    }

    return {
      home: isHome,
      inTrip: isInDest,
      faresView: state.faresAirport === iata,
      filterOrigin: isFilterOrigin,
      dimmed,
      disabled: isDisabled,
    };
  }

  function drawPins() {
    for (const m of state.markers.values()) m.remove();
    state.markers.clear();
    for (const a of state.airports) {
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
      const opts = pinOpts(a.iata);
      if (opts.dimmed) continue;
      const m = L.marker([a.lat, a.lon], {
        icon: makeIcon(a, opts),
        title: `${a.iata} — ${a.city || a.name}`,
        riseOnHover: true,
      });
      m.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        handlePinClick(a.iata);
      });
      m.on("contextmenu", (ev) => {
        L.DomEvent.stop(ev);
        L.DomEvent.preventDefault(ev);
        setHomeAirportFromMap(a.iata);
      });
      const tip = `${a.iata} · ${a.city || a.name || ""}${a.country ? " (" + a.country + ")" : ""}<br/><span style="font-size:11px;opacity:.75">${opts.disabled ? `No return flight to ${state.homeIata} · Right-click to set as home` : "Click to add · Right-click to set as home"}</span>`;
      m.bindTooltip(tip, { direction: "top", offset: [0, -8], opacity: 0.95 });
      m.addTo(map);
      state.markers.set(a.iata, m);
    }
  }

  function refreshPin(iata) {
    const m = state.markers.get(iata);
    const a = state.airportsByIata.get(iata);
    if (m && a) m.setIcon(makeIcon(a, pinOpts(iata)));
  }

  function flyToHome() {
    const home = state.airportsByIata.get(state.homeIata);
    if (home) map.flyTo([home.lat, home.lon], 5, { duration: 1 });
  }

  async function setHomeAirportFromMap(iata) {
    state.homeIata = iata;
    localStorage.setItem("wayfarer.home", state.homeIata);
    state.destinations = state.destinations.filter((destination) => destination !== state.homeIata);
    saveDestinations();
    clearDestinationArrows();
    clearItineraryLayer();
    state.selectedTripItineraryId = null;
    await refreshReachableToHome();
    drawPins();
    flyToHome();
    if (state.sidebarMode === "builder") renderBuilder();
    toast.success(`Home airport set to ${state.homeIata}`);
  }

  function flyToAllAirports() {
    const visibleAirports = state.airports.filter((a) => {
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return false;
      const opts = pinOpts(a.iata);
      return !opts.dimmed;
    });
    if (visibleAirports.length === 0) return;
    const lats = visibleAirports.map((a) => a.lat);
    const lons = visibleAirports.map((a) => a.lon);
    const centroidLat = lats.reduce((s, v) => s + v, 0) / lats.length;
    const centroidLon = lons.reduce((s, v) => s + v, 0) / lons.length;
    if (visibleAirports.length === 1) {
      map.flyTo([centroidLat, centroidLon], 19, { duration: 1 });
      return;
    }
    const bounds = L.latLngBounds(visibleAirports.map((a) => [a.lat, a.lon]));
    const fittingZoom = map.getBoundsZoom(bounds, false, [80, 80]);
    const zoom = Math.min(fittingZoom, 19);
    map.flyTo([centroidLat, centroidLon], zoom, { duration: 1 });
  }

  function fitToDestinations(originIata) {
    const origin = state.airportsByIata.get(originIata);
    const destIatas = Array.from(state.mapFilterDestinations);
    const destAirports = destIatas
      .map((i) => state.airportsByIata.get(i))
      .filter((a) => a && Number.isFinite(a.lat) && Number.isFinite(a.lon));
    const allPoints = [];
    if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lon)) {
      allPoints.push([origin.lat, origin.lon]);
    }
    for (const ap of destAirports) {
      allPoints.push([ap.lat, ap.lon]);
    }
    if (allPoints.length === 0) return;
    if (allPoints.length === 1) {
      map.flyTo(allPoints[0], 6, { duration: 1 });
      return;
    }
    const lats = allPoints.map((p) => p[0]);
    const lons = allPoints.map((p) => p[1]);
    const centroidLat = lats.reduce((s, v) => s + v, 0) / lats.length;
    const centroidLon = lons.reduce((s, v) => s + v, 0) / lons.length;
    const bounds = L.latLngBounds(allPoints);
    const fittingZoom = map.getBoundsZoom(bounds, false, [80, 80]);
    const zoom = Math.min(fittingZoom, 14);
    map.flyTo([centroidLat, centroidLon], zoom, { duration: 1 });
  }

  function toggleDestination(iata) {
    if (iata === state.homeIata) {
      toast.warn("That's your home airport", "Change it in settings.");
      return;
    }
    const idx = state.destinations.indexOf(iata);
    if (idx === -1) {
      if (state.destinations.length === 0) state.builder.multiCity.stops = [];
      state.destinations.push(iata);
      state.builder.multiCity.stops.push({
        iata,
        minStayDays: state.builder.multiCity.defaultStayDays - state.builder.multiCity.defaultFlexDays,
        maxStayDays: state.builder.multiCity.defaultStayDays + state.builder.multiCity.defaultFlexDays,
      });
      toast.info("Added to trip", iata);
    } else {
      state.destinations.splice(idx, 1);
      state.builder.multiCity.stops = state.builder.multiCity.stops.filter((s) => s.iata !== iata);
      toast.info("Removed from trip", iata);
    }
    saveDestinations();
    refreshPin(iata);
    if (state.sidebarMode === "builder") renderBuilder();
  }

  async function handlePinClick(iata) {
    if (state.mapFilterOrigin === iata) {
      state.mapFilterOrigin = null;
      state.mapFilterDestinations.clear();
      drawPins();
      if (iata !== state.homeIata) toggleDestination(iata);
      return;
    }
    if (iata === state.homeIata && state.mapFilterOrigin == null) {
      state.mapFilterOrigin = iata;
      state.mapFilterDestinations.clear();
      try {
        const r = await getJson(`/api/map/airports/${encodeURIComponent(iata)}/routes`);
        const routes = r.routes || [];
        for (const rt of routes) state.mapFilterDestinations.add(rt.destinationIata);
        drawPins();
      } catch (e) {
        console.warn("handlePinClick: failed to load routes for filter:", e);
      }
      return;
    }
    if (iata === state.homeIata) {
      state.mapFilterOrigin = null;
      state.mapFilterDestinations.clear();
      drawPins();
      toggleDestination(iata);
      return;
    }
    state.mapFilterOrigin = iata;
    state.mapFilterDestinations.clear();
    try {
      const r = await getJson(`/api/map/airports/${encodeURIComponent(iata)}/routes`);
      const routes = r.routes || [];
      for (const rt of routes) state.mapFilterDestinations.add(rt.destinationIata);
      drawPins();
      fitToDestinations(iata);
    } catch (e) {
      console.warn("handlePinClick: failed to load routes for filter:", e);
    }
    toggleDestination(iata);
  }

  async function selectOriginOnMap(iata) {
    const code = String(iata || "").toUpperCase();
    if (!IATA_RE.test(code)) return false;
    if (!state.airportsByIata.has(code)) return false;
    state.mapFilterOrigin = code;
    state.mapFilterDestinations.clear();
    clearDestinationArrows();
    try {
      const r = await getJson(`/api/map/airports/${encodeURIComponent(code)}/routes`);
      const routes = r.routes || [];
      for (const rt of routes) state.mapFilterDestinations.add(rt.destinationIata);
    } catch (e) {
      console.warn("selectOriginOnMap: failed to load routes:", e);
    }
    drawPins();
    const ap = state.airportsByIata.get(code);
    if (ap && Number.isFinite(ap.lat) && Number.isFinite(ap.lon)) {
      map.flyTo([ap.lat, ap.lon], Math.max(map.getZoom(), 5), { duration: 0.6 });
    }
    return true;
  }

  function clearDestinationArrows() {
    if (state.destinationArrowsLayer) {
      map.removeLayer(state.destinationArrowsLayer);
      state.destinationArrowsLayer = null;
    }
  }

  function drawDestinationArrows(origin, deals) {
    clearDestinationArrows();
    const oa = state.airportsByIata.get(origin);
    if (!oa || !Number.isFinite(oa.lat) || !Number.isFinite(oa.lon)) return;
    const coords = [];
    for (const d of deals) {
      const iata = String(d.iata || "").toUpperCase();
      const da = state.airportsByIata.get(iata);
      if (da && Number.isFinite(da.lat) && Number.isFinite(da.lon)) coords.push([oa, da, d]);
    }
    if (coords.length === 0) return;
    const lines = [];
    const labels = [];
    const bounds = L.latLngBounds([[oa.lat, oa.lon]]);
    for (const [o, d, deal] of coords) {
      lines.push(L.polyline([[o.lat, o.lon], [d.lat, d.lon]], {
        color: "#4f46e5",
        weight: 2,
        opacity: 0.65,
      }));
      const mid = [(o.lat + d.lat) / 2, (o.lon + d.lon) / 2];
      const price = Number(deal.bestPrice || 0).toFixed(0);
      const currency = deal.currency || "EUR";
      const mins = Number(deal.bestDurationMinutes || 0);
      const dur = mins > 0 ? `${Math.floor(mins / 60)}h${mins % 60 ? mins % 60 + "m" : ""}` : "";
      const date = deal.bestDate ? fmtMonthDay(deal.bestDate) : "";
      const labelParts = [`${currency} ${price}`];
      if (dur) labelParts.push(dur);
      if (date) labelParts.push(date);
      const labelHtml = `<div style="background:rgba(255,255,255,0.95);border:1px solid #4f46e5;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:600;color:#4f46e5;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.18);">${escapeHtml(d.iata)}<br/><span style="color:#64748b;font-weight:500">${escapeHtml(labelParts.join(" · "))}</span></div>`;
      labels.push(L.marker(mid, {
        icon: L.divIcon({ className: "leg-label", html: labelHtml, iconSize: null, iconAnchor: [0, 0] }),
        interactive: false,
      }));
      bounds.extend([d.lat, d.lon]);
    }
    state.destinationArrowsLayer = L.layerGroup([...lines, ...labels]).addTo(map);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [80, 80], maxZoom: 6, animate: true });
  }

  async function viewFaresForAirport(iata) {
    const ap = state.airportsByIata.get(iata);
    if (ap) map.flyTo([ap.lat, ap.lon], Math.max(map.getZoom(), 6), { duration: 0.6 });
    state.faresAirport = iata;
    refreshPin(iata);
    renderFaresView(iata);
    await loadFaresForAirport(iata);
  }

  function clearFaresView() {
    if (state.faresAirport) {
      const prev = state.faresAirport;
      state.faresAirport = null;
      refreshPin(prev);
    }
  }

  function exitFaresToBuilder() {
    clearFaresView();
    setSidebarMode("builder");
    renderBuilder();
  }

  /* ====================================================== */
  /* Sidebar mode switch                                    */
  /* ====================================================== */
  function setSidebarMode(mode) {
    state.sidebarMode = mode;
    const toolbar = $("sidebar-toolbar");
    if (toolbar) toolbar.hidden = mode !== "fares";
  }

  /* ====================================================== */
  /* Trip Builder sidebar                                  */
  /* ====================================================== */
  function applyMultiCityParamsToBuilder(args) {
    const get = (k) => (Object.prototype.hasOwnProperty.call(args, k) ? args[k] : undefined);
    const homeRaw = String(get("homeIata") || "").trim().toUpperCase();
    const dateFrom = String(get("dateFrom") || "").trim();
    const dateTo = String(get("dateTo") || "").trim();
    const stopsRaw = Array.isArray(get("stops")) ? get("stops") : [];
    const defaultStayDays = Number(get("defaultStayDays"));
    const defaultFlexDays = Number(get("defaultFlexDays"));
    const maxTotalPrice = Number(get("maxTotalPrice"));
    const maxLegPrice = Number(get("maxLegPrice"));
    const limit = Number(get("limit"));

    const newHome = /^[A-Z]{3}$/.test(homeRaw) ? homeRaw : state.homeIata;
    const homeChanged = newHome !== state.homeIata;

    if (homeChanged) {
      state.homeIata = newHome;
      localStorage.setItem("wayfarer.home", state.homeIata);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) state.builder.dateFrom = dateFrom;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) state.builder.dateTo = dateTo;
    localStorage.setItem("wayfarer.builder.dateFrom", state.builder.dateFrom);
    localStorage.setItem("wayfarer.builder.dateTo", state.builder.dateTo);

    if (Number.isFinite(defaultStayDays) && defaultStayDays > 0) state.builder.multiCity.defaultStayDays = Math.max(1, Math.min(30, Math.floor(defaultStayDays)));
    if (Number.isFinite(defaultFlexDays) && defaultFlexDays >= 0) state.builder.multiCity.defaultFlexDays = Math.max(0, Math.min(7, Math.floor(defaultFlexDays)));
    if (Number.isFinite(maxTotalPrice) && maxTotalPrice >= 0) state.builder.multiCity.maxTotalPrice = Math.max(0, Math.floor(maxTotalPrice));
    if (Number.isFinite(maxLegPrice) && maxLegPrice >= 0) state.builder.multiCity.maxLegPrice = Math.max(0, Math.floor(maxLegPrice));
    if (Number.isFinite(limit) && limit > 0) state.builder.multiCity.limit = Math.max(1, Math.min(100, Math.floor(limit)));
    localStorage.setItem("wayfarer.builder.multiCity.defaultStayDays", String(state.builder.multiCity.defaultStayDays));
    localStorage.setItem("wayfarer.builder.multiCity.defaultFlexDays", String(state.builder.multiCity.defaultFlexDays));
    localStorage.setItem("wayfarer.builder.multiCity.maxTotalPrice", String(state.builder.multiCity.maxTotalPrice));
    localStorage.setItem("wayfarer.builder.multiCity.maxLegPrice", String(state.builder.multiCity.maxLegPrice));
    localStorage.setItem("wayfarer.builder.multiCity.limit", String(state.builder.multiCity.limit));

    const newDests = stopsRaw
      .map((s) => String((s && s.iata) || "").trim().toUpperCase())
      .filter((s) => /^[A-Z]{3}$/.test(s) && s !== newHome);
    const newStops = stopsRaw
      .filter((s) => s && typeof s === "object" && /^[A-Z]{3}$/.test(String(s.iata || "").trim().toUpperCase()))
      .map((s) => ({
        iata: String(s.iata).trim().toUpperCase(),
        minStayDays: Math.max(1, Math.floor(Number(s.minStayDays) || state.builder.multiCity.defaultStayDays - state.builder.multiCity.defaultFlexDays)),
        maxStayDays: Math.max(1, Math.floor(Number(s.maxStayDays) || state.builder.multiCity.defaultStayDays + state.builder.multiCity.defaultFlexDays)),
      }));

    state.destinations = newDests;
    state.builder.multiCity.stops = newStops;
    saveDestinations();
    localStorage.setItem("wayfarer.builder.multiCity.stops", JSON.stringify(state.builder.multiCity.stops));

    if (state.builder.mode !== "multicity") {
      state.builder.mode = "multicity";
      localStorage.setItem("wayfarer.builder.mode", "multicity");
    }

    if (homeChanged) {
      clearDestinationArrows();
      clearItineraryLayer();
      state.selectedTripItineraryId = null;
      refreshReachableToHome().finally(() => {
        drawPins();
        renderBuilder();
      });
    } else {
      drawPins();
      renderBuilder();
    }
    toast.info(
      "Trip updated",
      `${state.homeIata} → ${state.destinations.join(" → ") || "(no stops)"} → ${state.homeIata}`,
    );
  }

  function renderBuilder() {
    $("itineraries-header")?.remove();
    $("fares-back")?.remove();
    setSidebarMode("builder");
    // Always the multi-city best fare planner now. Keep `state.builder.mode` for
    // back-compat with persisted localStorage but treat anything other than
    // 'multicity' as 'multicity'.
    if (state.builder.mode !== "multicity") {
      state.builder.mode = "multicity";
      localStorage.setItem("wayfarer.builder.mode", "multicity");
    }
    const n = state.destinations.length;
    const subTitle = n === 0
      ? "Click pins on the map to add stops between home and back."
      : `From ${state.homeIata} · ${n} stop${n === 1 ? "" : "s"} (anchor + best fare)`;
    $("sidebar-title").textContent = "Plan a trip";
    $("sidebar-subtitle").textContent = subTitle;
    const body = $("sidebar-body");
    const home = state.airportsByIata.get(state.homeIata);
    const homeLabel = home ? `${state.homeIata} · ${home.city || home.name || ""}` : state.homeIata;

    // Reconcile persisted stays with current destination order. Stops without
    // a saved entry fall back to the global default; existing entries keep
    // their values if the iata still matches.
    const savedStops = state.builder.multiCity.stops ?? [];
    const reconciledStops = state.destinations.map((iata, idx) => {
      const existing = savedStops.find((s) => s.iata === iata);
      return {
        iata,
        minStayDays: existing?.minStayDays ?? state.builder.multiCity.defaultStayDays - state.builder.multiCity.defaultFlexDays,
        maxStayDays: existing?.maxStayDays ?? state.builder.multiCity.defaultStayDays + state.builder.multiCity.defaultFlexDays,
      };
    });
    state.builder.multiCity.stops = reconciledStops;
    saveDestinations();

    const destRows = reconciledStops.map((s, idx) => {
      const a = state.airportsByIata.get(s.iata);
      const label = a ? `${s.iata} · ${a.city || a.country || ""}` : s.iata;
      const minStay = Math.max(1, s.minStayDays);
      const maxStay = Math.max(minStay, s.maxStayDays);
      return `<div class="stop-row" data-idx="${idx}">
        <div class="stop-row-head">
          <span class="dest-chip"><strong>${idx + 1}.</strong> ${escapeHtml(label)}<button class="dest-chip-remove" data-remove="${s.iata}" title="Remove">×</button></span>
        </div>
        <div class="stop-row-body">
          <div class="stop-stay-pair">
            <label>Stay</label>
            <input type="number" min="1" max="30" data-stop-min="${s.iata}" value="${minStay}" />
            <span class="stop-stay-sep">–</span>
            <input type="number" min="1" max="30" data-stop-max="${s.iata}" value="${maxStay}" />
            <span class="stop-stay-unit">days</span>
          </div>
        </div>
      </div>`;
    }).join("");

    const lastStop = state.destinations[state.destinations.length - 1] ?? null;
    const lastStopBlocked = lastStop != null && !state.reachableToHome.has(lastStop);
    const planDisabled = n === 0 || lastStopBlocked;
    const dateInputs = `
      <div class="builder-row">
        <div><label>Depart from</label><input type="date" id="b-from" value="${state.builder.dateFrom}" /></div>
        <div><label>Return by</label><input type="date" id="b-to" value="${state.builder.dateTo}" /></div>
      </div>
      <div class="builder-row" style="margin-top:8px">
        <div><label>Default stay</label><input type="number" id="b-mc-stay" min="1" max="30" value="${state.builder.multiCity.defaultStayDays}" /></div>
        <div><label>± flex</label><input type="number" id="b-mc-flex" min="0" max="7" value="${state.builder.multiCity.defaultFlexDays}" /></div>
        <div><label>± leg flex</label><input type="number" id="b-mc-legflex" min="0" max="7" value="${state.builder.multiCity.legFlexDays}" /></div>
      </div>
      <div class="builder-row" style="margin-top:8px">
        <div><label>Max / leg</label><input type="number" id="b-mc-maxleg" min="0" max="2000" value="${state.builder.multiCity.maxLegPrice}" /></div>
        <div><label>Max total</label><input type="number" id="b-mc-maxtotal" min="0" max="10000" value="${state.builder.multiCity.maxTotalPrice}" /></div>
        <div><label>Top-K</label><input type="number" id="b-mc-limit" min="1" max="50" value="${state.builder.multiCity.limit}" /></div>
      </div>
      <div class="builder-row" style="margin-top:8px">
        <div><label>Anchor city</label><input id="b-mc-anchor-city" placeholder="(optional)" maxlength="3" style="text-transform:uppercase" value="${escapeHtml(state.builder.multiCity.anchor?.city ?? "")}" /></div>
        <div><label>Anchor day</label><input type="date" id="b-mc-anchor-day" value="${escapeHtml(state.builder.multiCity.anchor?.day ?? "")}" /></div>
      </div>
    `;

    body.innerHTML = `
      <div class="builder-section">
        <h4>Home</h4>
        <div style="font-weight:700">${escapeHtml(homeLabel)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Change in settings (top-right).</div>
      </div>
      <div class="builder-section">
        <h4>Stops (click pins to add in order)</h4>
        <div class="builder-destinations">${destRows || '<div style="font-size:11px;color:var(--muted)">No stops yet.</div>'}</div>
        ${n > 0 ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">Route: <strong>${escapeHtml(state.homeIata)} → ${escapeHtml(state.destinations.join(" → "))} → ${escapeHtml(state.homeIata)}</strong> (${n + 1} legs, return home implicit). Set per-stop stay with the line item under each chip.</div>` : ""}
        ${lastStopBlocked ? `<div style="font-size:11px;color:#b91c1c;margin-top:6px">⚠ <strong>${escapeHtml(lastStop)}</strong> doesn't fly back to <strong>${escapeHtml(state.homeIata)}</strong> — it can stay as an intermediate stop, but the search needs a final stop with a return flight.</div>` : ""}
      </div>
      <div class="builder-section">${dateInputs}</div>
      <div class="builder-summary">${summaryLine()}</div>
      <div class="builder-actions">
        <button class="secondary" id="b-clear" ${n === 0 ? "disabled" : ""}>Clear</button>
        <button class="primary" id="b-plan" ${planDisabled ? "disabled" : ""}>Find best fare →</button>
      </div>
      <div class="builder-section">
        <h4>Or ask the assistant</h4>
        <p style="font-size:12px;color:var(--muted);margin:0 0 8px">Free-form prompts also work and will auto-detect countries.</p>
      </div>
    `;

    body.querySelectorAll("[data-remove]").forEach((b) =>
      b.addEventListener("click", () => toggleDestination(b.dataset.remove)),
    );

    $("b-from").addEventListener("change", (e) => { state.builder.dateFrom = e.target.value; renderBuilder(); });
    $("b-to").addEventListener("change", (e) => { state.builder.dateTo = e.target.value; renderBuilder(); });

    const persistStops = () => {
      localStorage.setItem("wayfarer.builder.multiCity.stops", JSON.stringify(state.builder.multiCity.stops));
    };
    body.querySelectorAll("[data-stop-min]").forEach((inp) => {
      inp.addEventListener("change", (e) => {
        const iata = e.target.dataset.stopMin;
        const stop = state.builder.multiCity.stops.find((s) => s.iata === iata);
        if (!stop) return;
        const v = Math.max(1, Math.min(30, Number(e.target.value) || 1));
        stop.minStayDays = v;
        if (stop.maxStayDays < v) stop.maxStayDays = v;
        persistStops();
        e.target.value = String(v);
      });
    });
    body.querySelectorAll("[data-stop-max]").forEach((inp) => {
      inp.addEventListener("change", (e) => {
        const iata = e.target.dataset.stopMax;
        const stop = state.builder.multiCity.stops.find((s) => s.iata === iata);
        if (!stop) return;
        const v = Math.max(stop.minStayDays ?? 1, Math.min(30, Number(e.target.value) || (stop.minStayDays ?? 1)));
        stop.maxStayDays = v;
        persistStops();
        e.target.value = String(v);
      });
    });

    const persistMc = () => {
      localStorage.setItem("wayfarer.builder.multiCity.stops", JSON.stringify(state.builder.multiCity.stops));
      localStorage.setItem("wayfarer.builder.multiCity.defaultStayDays", String(state.builder.multiCity.defaultStayDays));
      localStorage.setItem("wayfarer.builder.multiCity.defaultFlexDays", String(state.builder.multiCity.defaultFlexDays));
      localStorage.setItem("wayfarer.builder.multiCity.legFlexDays", String(state.builder.multiCity.legFlexDays));
      localStorage.setItem("wayfarer.builder.multiCity.maxLegPrice", String(state.builder.multiCity.maxLegPrice));
      localStorage.setItem("wayfarer.builder.multiCity.maxTotalPrice", String(state.builder.multiCity.maxTotalPrice));
      localStorage.setItem("wayfarer.builder.multiCity.anchor", JSON.stringify(state.builder.multiCity.anchor));
      localStorage.setItem("wayfarer.builder.multiCity.limit", String(state.builder.multiCity.limit));
    };
    $("b-mc-stay")?.addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(30, Number(e.target.value) || 3));
      state.builder.multiCity.defaultStayDays = v; e.target.value = String(v); persistMc();
    });
    $("b-mc-flex")?.addEventListener("change", (e) => {
      const v = Math.max(0, Math.min(7, Number(e.target.value) || 0));
      state.builder.multiCity.defaultFlexDays = v; e.target.value = String(v); persistMc();
    });
    $("b-mc-legflex")?.addEventListener("change", (e) => {
      const v = Math.max(0, Math.min(7, Number(e.target.value) || 2));
      state.builder.multiCity.legFlexDays = v; e.target.value = String(v); persistMc();
    });
    $("b-mc-maxleg")?.addEventListener("change", (e) => {
      const v = Math.max(0, Math.min(2000, Number(e.target.value) || 0));
      state.builder.multiCity.maxLegPrice = v; e.target.value = String(v); persistMc();
    });
    $("b-mc-maxtotal")?.addEventListener("change", (e) => {
      const v = Math.max(0, Math.min(10000, Number(e.target.value) || 0));
      state.builder.multiCity.maxTotalPrice = v; e.target.value = String(v); persistMc();
    });
    $("b-mc-limit")?.addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(50, Number(e.target.value) || 20));
      state.builder.multiCity.limit = v; e.target.value = String(v); persistMc();
    });
    $("b-mc-anchor-city")?.addEventListener("change", (e) => {
      const v = e.target.value.trim().toUpperCase();
      state.builder.multiCity.anchor = state.builder.multiCity.anchor ? { ...state.builder.multiCity.anchor, city: v } : null;
      if (!/^[A-Z]{3}$/.test(v)) state.builder.multiCity.anchor = null;
      e.target.value = state.builder.multiCity.anchor?.city ?? "";
      persistMc();
    });
    $("b-mc-anchor-day")?.addEventListener("change", (e) => {
      const v = e.target.value.trim();
      state.builder.multiCity.anchor = state.builder.multiCity.anchor && /^\d{4}-\d{2}-\d{2}$/.test(v)
        ? { ...state.builder.multiCity.anchor, day: v }
        : null;
      e.target.value = state.builder.multiCity.anchor?.day ?? "";
      persistMc();
    });
    $("b-clear")?.addEventListener("click", () => {
      state.destinations = [];
      state.mapFilterOrigin = null;
      state.mapFilterDestinations.clear();
      clearItineraryLayer();
      saveDestinations();
      drawPins();
      renderBuilder();
      flyToAllAirports();
      toast.info("Trip cleared");
    });
    $("b-plan")?.addEventListener("click", () => {
      findMultiCityBestFare();
    });
  }

  function summaryLine() {
    if (state.destinations.length === 0) return "";
    const home = state.homeIata;
    const stops = state.destinations.join(" → ");
    const mc = state.builder.multiCity;
    const legCount = state.destinations.length + 1;
    const stayBits = state.builder.multiCity.stops
      .map((s, idx) => `${escapeHtml(s.iata)} ${s.minStayDays}–${s.maxStayDays}d`)
      .join(", ");
    const anchor = mc.anchor;
    const anchorBit = anchor ? `, anchor ${anchor.city} on ${anchor.day}` : "";
    return `Route: <strong>${escapeHtml(home)} → ${escapeHtml(stops)} → ${escapeHtml(home)}</strong><br/>${legCount} legs · stays: ${stayBits} · cap ${mc.maxTotalPrice || "∞"}${anchorBit}.`;
  }

  function daysBetween(a, b) {
    const d1 = new Date(a + "T00:00:00Z").getTime();
    const d2 = new Date(b + "T00:00:00Z").getTime();
    return Math.max(1, Math.round((d2 - d1) / 86_400_000));
  }

  /* ====================================================== */
  /* Fares                                                  */
  /* ====================================================== */
  function renderFaresView(iata) {
    setSidebarMode("fares");
    const ap = state.airportsByIata.get(iata);
    $("sidebar-title").textContent = ap ? `${ap.iata} — ${ap.city || ap.name}` : iata;
    $("sidebar-subtitle").textContent = ap && ap.country
      ? `${ap.name || ""} · ${ap.country} · right-click menu`
      : "Fares originating or arriving at this airport.";
    const body = $("sidebar-body");
    body.innerHTML = `<div class="empty">Loading fares…</div>`;
    const head = $("sidebar-body");
    const back = document.createElement("div");
    back.id = "fares-back";
    back.style.cssText = "padding:8px 20px 0;font-size:12px";
    back.innerHTML = `<button class="ghost small" id="b-back-builder">← back to trip builder</button>`;
    body.parentNode?.insertBefore(back, body);
    back.querySelector("#b-back-builder").addEventListener("click", exitFaresToBuilder);
  }

  async function loadFaresForAirport(iata) {
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (state.faresFilters.date) params.set("dateFrom", state.faresFilters.date);
      const r = await getJson(`/api/map/airports/${encodeURIComponent(iata)}/fares?${params.toString()}`);
      let fares = r.fares || [];
      fares = fares.filter((f) => {
        const code = (f.airlineCode || "").toUpperCase();
        const name = (f.airline || "").toLowerCase();
        const isRyanair = code === "FR" || code === "RYR" || name.includes("ryanair");
        const isEasyjet = code === "EZY" || code === "U2" || name.includes("easyjet");
        const anyChecked = state.faresFilters.ryanair || state.faresFilters.easyjet;
        if (!anyChecked) return true;
        if (state.faresFilters.ryanair && isRyanair) return true;
        if (state.faresFilters.easyjet && isEasyjet) return true;
        return false;
      });
      if (state.faresFilters.origin) fares = fares.filter((f) => f.origin === state.faresFilters.origin);
      if (state.faresFilters.dest) fares = fares.filter((f) => f.destination === state.faresFilters.dest);
      state.fares = sortFares(fares, state.faresSort);
      renderFares(state.fares);
    } catch (e) {
      $("sidebar-body").innerHTML = `<div class="empty"><h4>Failed to load</h4><p>${escapeHtml(String(e))}</p></div>`;
      toast.error("Fares load failed", String(e));
    }
  }

  function sortFares(fares, mode) {
    const arr = fares.slice();
    if (mode === "price-asc") arr.sort((a, b) => a.price - b.price);
    else if (mode === "price-desc") arr.sort((a, b) => b.price - a.price);
    else if (mode === "date-asc") arr.sort((a, b) => a.departureDate.localeCompare(b.departureDate) || a.price - b.price);
    else if (mode === "date-desc") arr.sort((a, b) => b.departureDate.localeCompare(a.departureDate) || a.price - b.price);
    else if (mode === "duration-asc") arr.sort((a, b) => (a.durationMinutes ?? 1e9) - (b.durationMinutes ?? 1e9));
    else arr.sort((a, b) => a.price - b.price || a.durationMinutes - b.durationMinutes);
    return arr;
  }

  function renderFares(fares) {
    const body = $("sidebar-body");
    if (!fares.length) {
      body.innerHTML = `<div class="empty"><h4>No fares found</h4><p>Try adjusting filters or trigger a crawl for this airport.</p></div>`;
      return;
    }
    const centre = state.faresAirport;
    body.innerHTML = fares.slice(0, 200).map((f, i) => {
      const direct = f.origin === centre ? "→" : "←";
      const other = f.origin === centre ? f.destination : f.origin;
      const airlineLabel = f.airlineCode ? `${f.airlineCode}` : (f.airline || "—");
      const inTrip = state.destinations.includes(other) ? " · in trip" : "";
      return `<div class="fare-card${i === 0 ? " active" : ""}" data-fare='${escapeHtml(JSON.stringify(f))}' data-other="${other}">
        <div class="fare-route">${escapeHtml(centre)} <span class="arrow">${direct}</span> ${escapeHtml(other)}</div>
        <div class="fare-meta">
          <span>${escapeHtml(f.departureDate)}${f.departureDatetime ? ` · ${escapeHtml(String(f.departureDatetime).slice(11, 16))}` : ""}${f.durationMinutes ? ` · ${Math.round(f.durationMinutes / 60)}h${f.durationMinutes % 60}m` : ""}</span>
          <span class="fare-price">${escapeHtml(f.currency)} ${Number(f.price).toFixed(2)}</span>
        </div>
        <div class="fare-stops">${escapeHtml(airlineLabel)}${f.fareType ? ` · ${escapeHtml(f.fareType)}` : ""}${f.seatsLeft != null ? ` · ${f.seatsLeft} seats left` : ""}${escapeHtml(inTrip)}</div>
      </div>`;
    }).join("");

    body.querySelectorAll(".fare-card").forEach((card) => {
      card.addEventListener("click", () => {
        body.querySelectorAll(".fare-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        const other = card.dataset.other;
        if (other && state.airportsByIata.has(other)) {
          const ap = state.airportsByIata.get(other);
          map.flyTo([ap.lat, ap.lon], Math.max(map.getZoom(), 6), { duration: 0.6 });
        }
      });
    });
  }

  /* ====================================================== */
  /* Chat → itinerary                                       */
  /* ====================================================== */
  const chatInput = $("chat-input");
  const chatSend = $("chat-send");

  function autoResize() {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(140, chatInput.scrollHeight) + "px";
  }
  chatInput.addEventListener("input", autoResize);

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  });
  chatSend.addEventListener("click", submitChat);

  $("session-current")?.addEventListener("click", () => {
    const dropdown = $("session-dropdown");
    if (dropdown?.classList.contains("hidden")) {
      openSessionDropdown();
    } else {
      closeSessionDropdown();
    }
  });
  $("session-new")?.addEventListener("click", createNewSession);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".session-selector")) {
      closeSessionDropdown();
    }
  });

  document.querySelectorAll(".chat-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (chip.dataset.action === "clear") {
        state.destinations = [];
        state.builder.multiCity.stops = [];
        state.mapFilterOrigin = null;
        state.mapFilterDestinations.clear();
        clearItineraryLayer();
        saveDestinations();
        drawPins();
        if (state.sidebarMode === "builder") renderBuilder();
        else exitFaresToBuilder();
        toast.info("Trip cleared");
        return;
      }
      if (chip.dataset.action === "round-trip") {
        // Trim to a single destination and run the round-trip finder.
        if (state.destinations.length > 1) {
          state.destinations = state.destinations.slice(0, 1);
          state.builder.multiCity.stops = state.builder.multiCity.stops.slice(0, 1);
          saveDestinations();
          for (const iata of state.airportsByIata.keys()) refreshPin(iata);
        }
        if (state.sidebarMode !== "builder") exitFaresToBuilder();
        findRoundTrip();
        return;
      }
      if (chip.dataset.iata) {
        const iatas = chip.dataset.iata.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s));
        state.destinations = iatas.filter((i) => i !== state.homeIata);
        // Reset per-stop stays to the current defaults; the builder will
        // reconcile them on render.
        state.builder.multiCity.stops = state.destinations.map((iata) => ({
          iata,
          minStayDays: state.builder.multiCity.defaultStayDays - state.builder.multiCity.defaultFlexDays,
          maxStayDays: state.builder.multiCity.defaultStayDays + state.builder.multiCity.defaultFlexDays,
        }));
        saveDestinations();
        for (const iata of state.airportsByIata.keys()) refreshPin(iata);
        if (state.sidebarMode !== "builder") exitFaresToBuilder();
        else renderBuilder();
        toast.success("Stops loaded", state.destinations.join(" → "));
        return;
      }
      chatInput.value = chip.dataset.prompt || chip.textContent.trim();
      autoResize();
      chatInput.focus();
      submitChat();
    });
  });

  async function planTrip() {
    if (state.destinations.length === 0) {
      toast.warn("Pick destinations first", "Click pins to add airports to your trip.");
      return;
    }
    const lastStop = state.destinations[state.destinations.length - 1];
    if (lastStop && !state.reachableToHome.has(lastStop)) {
      toast.warn(
        `Last stop has no return flight to ${state.homeIata}`,
        `${lastStop} doesn't fly back home. Add a stop after it, or remove it.`,
      );
      return;
    }
    chatSend.disabled = true;
    setSidebarMode("itineraries");
    const home = state.homeIata;
    const stops = state.destinations.join(" → ");
    $("sidebar-title").textContent = "Planning your trip…";
    $("sidebar-subtitle").textContent = `${home} → ${stops} → ${home}`;
    $("sidebar-toolbar").hidden = true;
    const body = $("sidebar-body");
    body.innerHTML = `<div class="empty"><h4>Generating itineraries…</h4><p>Computing ${state.destinations.length} stop${state.destinations.length === 1 ? "" : "s"} across ${permutationsCount(state.destinations.length)} permutations.</p><p style="font-size:11px;color:var(--muted);margin-top:6px">SQL planner — single ClickHouse pass</p></div>`;

    try {
      const r = await postJson("/api/map/itinerary/generate", {
        homeIata: state.homeIata,
        destinations: state.destinations,
        dateFrom: state.builder.dateFrom,
        dateTo: state.builder.dateTo,
        daysPerCountry: state.builder.daysPerStop,
        flexDays: state.builder.flexDays,
        maxItineraries: state.builder.maxItineraries,
        planner: "sql",
      });
      state.itineraries = r.itineraries || [];
      if (state.itineraries.length === 0) {
        body.innerHTML = `<div class="empty"><h4>No itineraries</h4><p>The planner couldn't build a route from these destinations.</p></div>
          <div style="padding:0 20px 20px"><button class="secondary" id="b-back-from-empty">← edit destinations</button></div>`;
        $("b-back-from-empty")?.addEventListener("click", () => {
          clearItineraryLayer();
          renderBuilder();
        });
      } else {
        state.activeItineraryId = state.itineraries[0].id;
        renderItineraries();
        renderItineraryOnMap(state.activeItineraryId);
      }
    } catch (e) {
      console.error("planTrip:", e);
      body.innerHTML = `<div class="empty"><h4>Failed to plan</h4><p>${escapeHtml(String(e))}</p></div>`;
      toast.error("Itinerary failed", String(e));
    } finally {
      chatSend.disabled = false;
    }
  }

  async function findRoundTrip() {
    if (state.destinations.length !== 1) {
      toast.warn("Pick one destination", "Round-trip needs exactly one destination.");
      return;
    }
    const destination = state.destinations[0];
    if (!destination) return;
    chatSend.disabled = true;
    setSidebarMode("itineraries");
    $("sidebar-title").textContent = "Finding round trips…";
    $("sidebar-subtitle").textContent = `${state.homeIata} ⇄ ${destination}`;
    $("sidebar-toolbar").hidden = true;
    const body = $("sidebar-body");
    body.innerHTML = `<div class="empty"><h4>Searching the cheapest round trips…</h4><p>${state.builder.minDays}–${state.builder.maxDays} day trips between ${escapeHtml(state.homeIata)} and ${escapeHtml(destination)}.</p></div>`;
    try {
      const r = await postJson("/api/map/round-trip", {
        origin: state.homeIata,
        destination,
        dateFrom: state.builder.dateFrom,
        dateTo: state.builder.dateTo,
        minDays: state.builder.minDays,
        maxDays: state.builder.maxDays,
        limit: 5,
      });
      const options = (r.options || []).filter((o) => o.outbound.price > 0 && o.return.price > 0);
      if (options.length === 0) {
        body.innerHTML = `<div class="empty"><h4>No round trips</h4><p>No priced round trips in that window. Try expanding the dates or refreshing the crawl.</p></div>`;
        return;
      }
      state.itineraries = options.map((o) => ({
        id: o.outbound.date + "-" + o.return.date + "-" + o.origin + "-" + o.destination,
        title: `${o.origin} ⇄ ${o.destination} · ${o.tripDays} day${o.tripDays === 1 ? "" : "s"}`,
        totalPrice: o.totalPrice,
        currency: o.currency,
        totalDurationMinutes: (o.outbound.durationMinutes ?? 0) + (o.return.durationMinutes ?? 0) || null,
        legs: [o.outbound, o.return],
        summary: `${o.outbound.date} → ${o.return.date}, ${o.tripDays} days in ${o.destination}.`,
        recommendationScore: Math.max(0, 100 - o.totalPrice),
      }));
      state.activeItineraryId = state.itineraries[0]?.id ?? null;
      renderItineraries();
      if (state.activeItineraryId) renderItineraryOnMap(state.activeItineraryId);
    } catch (e) {
      console.error("findRoundTrip:", e);
      body.innerHTML = `<div class="empty"><h4>Round-trip search failed</h4><p>${escapeHtml(String(e))}</p></div>`;
      toast.error("Round-trip failed", String(e));
    } finally {
      chatSend.disabled = false;
    }
  }

  async function findMultiCityBestFare() {
    if (state.destinations.length < 1) {
      toast.warn("Pick at least one stop", "Multi-city needs at least one city between home and back.");
      return;
    }
    const home = state.homeIata;
    const stops = state.builder.multiCity.stops.map((s) => ({
      iata: s.iata,
      minStayDays: s.minStayDays,
      maxStayDays: s.maxStayDays,
    }));
    const anchorCity = String($("b-mc-anchor-city")?.value ?? "").trim().toUpperCase();
    const anchorDay = String($("b-mc-anchor-day")?.value ?? "").trim();
    const anchor = /^[A-Z]{3}$/.test(anchorCity) && /^\d{4}-\d{2}-\d{2}$/.test(anchorDay) ? { city: anchorCity, day: anchorDay } : null;

    const payload = {
      homeIata: home,
      stops,
      dateFrom: state.builder.dateFrom,
      dateTo: state.builder.dateTo,
      defaultStayDays: state.builder.multiCity.defaultStayDays,
      defaultFlexDays: state.builder.multiCity.defaultFlexDays,
      legFlexDays: state.builder.multiCity.legFlexDays,
      maxTotalPrice: state.builder.multiCity.maxTotalPrice,
      maxLegPrice: state.builder.multiCity.maxLegPrice,
      anchor,
      limit: state.builder.multiCity.limit,
    };

    chatSend.disabled = true;
    setSidebarMode("itineraries");
    $("sidebar-title").textContent = "Finding best fare…";
    $("sidebar-subtitle").textContent = `${home} → ${state.destinations.join(" → ")} → ${home}`;
    $("sidebar-toolbar").hidden = true;
    const body = $("sidebar-body");
    const legCount = state.destinations.length + 1;
    body.innerHTML = `<div class="empty"><h4>Searching best-fare chains…</h4><p>${legCount} legs · ${stops.length} stop${stops.length === 1 ? "" : "s"} · ≤${payload.maxTotalPrice || "∞"} total${anchor ? ` · be in ${anchor.city} on ${anchor.day}` : ""}.</p></div>`;
    try {
      const r = await postJson("/api/map/multi-city/generate", payload);
      const bundles = r.bundles || [];
      if (bundles.length === 0) {
        body.innerHTML = `<div class="empty"><h4>No bundles</h4><p>No priced chains satisfied all constraints. Loosen the price caps, widen the stays, or pick earlier dates.</p></div>
          <div style="padding:0 20px 20px"><button class="secondary" id="b-back-from-empty">← edit stops</button></div>`;
        $("b-back-from-empty")?.addEventListener("click", () => { clearItineraryLayer(); renderBuilder(); });
        return;
      }
      state.itineraries = bundles.map((b, idx) => {
        const id = `mcbf-${idx}-${b.legs.map((l) => l.departureDate).join("-")}`;
        const stopsLabel = b.legs.map((l) => `${l.from}→${l.to}`).join(" · ");
        const datesLabel = `${b.legs[0]?.departureDate ?? ""} → ${b.legs.at(-1)?.departureDate ?? ""}`;
        return {
          id,
          title: `${state.destinations[0]} circuit · ${b.tripDays} day${b.tripDays === 1 ? "" : "s"}`,
          totalPrice: b.totalPrice,
          currency: b.currency,
          totalDurationMinutes: null,
          legs: b.legs.map((l) => ({
            origin: l.from,
            destination: l.to,
            date: l.departureDate,
            departureDatetime: l.arrivalDatetime,
            arrivalDatetime: l.arrivalDatetime,
            price: l.price,
            currency: l.currency,
            airline: "",
            durationMinutes: null,
            originAirport: l.originAirport,
            destinationAirport: l.destinationAirport,
          })),
          summary: `${stopsLabel} · ${datesLabel}`,
          recommendationScore: Math.max(0, Math.round(100 - b.totalPrice)),
        };
      });
      state.activeItineraryId = state.itineraries[0].id;
      renderItineraries();
      renderItineraryOnMap(state.activeItineraryId);
    } catch (e) {
      console.error("findMultiCityBestFare:", e);
      body.innerHTML = `<div class="empty"><h4>Multi-city search failed</h4><p>${escapeHtml(String(e))}</p></div>`;
      toast.error("Multi-city failed", String(e));
    } finally {
      chatSend.disabled = false;
    }
  }

  function permutationsCount(n) {
    if (n <= 1) return 1;
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return f;
  }

  /* ====================================================== */
  /* SSE loop shared between debug + silent chat modes      */
  /* ====================================================== */
  let homeLocationPromise = null;
  async function requestHomeLocation() {
    if (homeLocationPromise) return homeLocationPromise;
    homeLocationPromise = (async () => {
      const result = { homeIata: state.homeIata, lat: null, lon: null, country: null };
      if (typeof navigator === "undefined" || !navigator.geolocation) return result;
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 4000,
            maximumAge: 60 * 60 * 1000,
          });
        });
        result.lat = pos?.coords?.latitude ?? null;
        result.lon = pos?.coords?.longitude ?? null;
      } catch { /* permission denied or unavailable — fall through */ }
      return result;
    })();
    return homeLocationPromise;
  }

  async function runLlmStream(text, handlers) {
    const home = await requestHomeLocation();
    let resp;
    try {
      resp = await fetch("/api/llm/chat-agent", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          text,
          chatId: chatSessionId,
          clientData: {
            model: undefined,
            maxIterations: 12,
            homeIata: home.homeIata || undefined,
            parameters: getChatSessionParams(),
            homeLocation: {
              lat: home.lat ?? undefined,
              lon: home.lon ?? undefined,
              country: home.country ?? undefined,
            },
          },
        }),
      });
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("AbortError") || msg.includes("ERR_NETWORK_IO_SUSPENDED") || msg.includes("NetworkError") || msg.includes("aborted")) {
        return;
      }
      handlers.onError?.(new Error(msg || "chat_error"));
      return;
    }
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      handlers.onError?.(new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`));
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!block.trim()) continue;
          let evtName = "message";
          let dataLine = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) evtName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          let parsed;
          try { parsed = JSON.parse(dataLine); } catch { continue; }
          handlers.onEvent?.(evtName, parsed);
        }
      }
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("AbortError") || msg.includes("ERR_NETWORK_IO_SUSPENDED") || msg.includes("NetworkError") || msg.includes("aborted")) {
        return;
      }
      handlers.onError?.(e);
    }
  }

  async function submitChat() {
    const prompt = chatInput.value.trim();
    if (!prompt) return;
    chatSend.disabled = true;

    await runChat(prompt);

    chatSend.disabled = false;
    chatInput.value = "";
    autoResize();
  }

  async function runChat(text) {
    aiProgressShow("Thinking…");
    aiProgressAppendStep("Thinking", "");
    let finalAnswer = null;
    let hadError = false;
    let pendingClarification = null;

    await runLlmStream(text, {
      onEvent: (evtName, data) => {
        if (evtName === "status") {
          if (data && data.status === "answering") {
            aiProgressMarkCurrentDone();
            aiProgressAppendStep("Composing answer", "");
            aiProgressUpdate("Composing answer…", "");
          }
          return;
        }
        if (evtName === "tool_progress") {
          if (data && typeof data.label === "string") {
            aiProgressMarkCurrentDone();
            aiProgressAppendStep(data.label, data.tool || "");
            aiProgressUpdate(data.label, data.tool || "");
          }
          return;
        }
        if (evtName === "tool_params") {
          if (data && typeof data.tool === "string" && data.tool === "multi_city_best_fare") {
            applyMultiCityParamsToBuilder(data.args || {});
          }
          return;
        }
        if (evtName === "answer") {
          aiProgressMarkCurrentDone();
          finalAnswer = data && data.answer;
          if (finalAnswer) applyAnswerToUi(finalAnswer);
          if (finalAnswer && finalAnswer.kind === "question") {
            pendingClarification = finalAnswer;
          }
          return;
        }
        if (evtName === "run_triggered") {
          if (data && data.runId) {
            aiProgressMarkCurrentDone();
            aiProgressAppendStep("Triggered background run", data.runId?.slice(0, 8) || "");
            aiProgressUpdate("Triggered background run…", data.runId?.slice(0, 8) || "");
            fetch(`/api/runs/${encodeURIComponent(data.runId)}/stream`).catch(() => { /* ignore */ });
          }
          return;
        }
        if (evtName === "final") {
          if (data && data.chatId) {
            const preview = String(text || "").slice(0, 40) + ((text || "").length > 40 ? "…" : "");
            registerSession(data.chatId, preview, getChatSessionParams());
            chatSessionId = data.chatId;
          }
          return;
        }
        if (evtName === "error") {
          hadError = true;
          aiProgressDone(`Error: ${data?.error || "assistant error"}`);
          toast.error("Assistant error", String(data?.error || ""));
        }
      },
      onError: (err) => {
        hadError = true;
        aiProgressDone("Couldn't reach assistant");
        toast.error("Network error", String(err?.message || err));
      },
    });

    if (pendingClarification) {
      aiProgressDone("I need a bit more info");
      const q = pendingClarification;
      showClarification(q.text || "", Array.isArray(q.suggestions) ? q.suggestions : [], async (reply) => {
        await runChat(reply);
      });
      return;
    }

    if (hadError) return;

    if (finalAnswer && finalAnswer.kind === "summary" && finalAnswer.text) {
      aiProgressDone("Done");
      const t = String(finalAnswer.text);
      if (t.length < 240) toast.info("Assistant", t.slice(0, 200));
    } else {
      aiProgressDone("Done");
    }
  }

  function applyAnswerToUi(answer) {
    if (!answer || typeof answer !== "object") return;
    switch (answer.kind) {
      case "summary":
        return;
      case "question":
        return;
      case "error":
        toast.error("Assistant error", String(answer.message || ""));
        return;
      case "set_origin": {
        const code = String(answer.iata || "").toUpperCase();
        if (!/^[A-Z]{3}$/.test(code)) return;
        state.mapFilterOrigin = code;
        state.mapFilterDestinations = new Set();
        clearDestinationArrows();
        drawPins();
        const ap = state.airportsByIata.get(code);
        if (ap && Number.isFinite(ap.lat) && Number.isFinite(ap.lon)) {
          map.flyTo([ap.lat, ap.lon], Math.max(map.getZoom(), 5), { duration: 0.6 });
        }
        const label = answer.label || (ap ? `${ap.iata} — ${ap.city || ap.name || ""}` : code);
        toast.success(`Origin selected: ${label}`);
        return;
      }
      case "destinations": {
        const origin = String(answer.origin || "").toUpperCase();
        const deals = (answer.arrows || []).filter((d) => d && d.iata);
        if (deals.length === 0) return;
        state.mapFilterOrigin = origin;
        state.mapFilterDestinations = new Set(deals.map((d) => String(d.iata).toUpperCase()));
        drawPins();
        drawDestinationArrows(origin, deals);
        setSidebarMode("builder");
        $("sidebar-title").textContent = `Destinations from ${origin}`;
        const winNote = answer.window ? ` · ${answer.window.dateFrom} → ${answer.window.dateTo}` : "";
        $("sidebar-subtitle").textContent = `${deals.length} route${deals.length === 1 ? "" : "s"} · arrows show price + duration${winNote}`;
        const body = $("sidebar-body");
        body.innerHTML = `<div class="empty"><h4>Map updated</h4><p>${deals.length} destination${deals.length === 1 ? "" : "s"} drawn from <strong>${escapeHtml(origin)}</strong> with price and duration.${answer.note ? `</p><p style="font-size:12px;color:var(--muted);margin-top:6px">${escapeHtml(answer.note)}` : ""}</p><p style="font-size:11px;color:var(--muted);margin-top:6px">Click any pin to inspect, or ask the assistant to filter further (e.g. "cheapest 3 from here").</p></div>`;
        toast.success(`Drew ${deals.length} destination${deals.length === 1 ? "" : "s"} from ${origin}`);
        return;
      }
      case "cheapest_fares": {
        const origin = String(answer.origin || state.homeIata || "").toUpperCase();
        const deals = (answer.deals || []).filter((d) => d && d.iata);
        if (deals.length === 0) return;
        state.mapFilterOrigin = origin;
        state.mapFilterDestinations = new Set(deals.map((d) => String(d.iata).toUpperCase()));
        drawPins();
        drawDestinationArrows(origin, deals);
        renderCheapestDeals(origin, deals, answer.window || {});
        if (origin && state.airportsByIata.has(origin)) {
          const h = state.airportsByIata.get(origin);
          map.flyTo([h.lat, h.lon], Math.max(map.getZoom(), 5), { duration: 0.6 });
        }
        const top = deals[0];
        const topLabel = top ? `${top.iata} · ${top.currency || "EUR"} ${Number(top.bestPrice || 0).toFixed(2)}` : "";
        toast.success(`Top ${deals.length} cheapest fare${deals.length === 1 ? "" : "s"} from ${origin}`, topLabel);
        return;
      }
      case "fares": {
        const iata = String(answer.iata || "").toUpperCase();
        if (!iata) return;
        state.faresAirport = iata;
        state.fares = (answer.fares || []).map((f) => ({
          origin: String(f.origin || "").toUpperCase(),
          destination: String(f.destination || "").toUpperCase(),
          price: Number(f.price || 0),
          currency: String(f.currency || "EUR"),
          departureDate: String(f.departureDate || ""),
          departureDatetime: f.departureDatetime || null,
          durationMinutes: f.durationMinutes ?? null,
          airline: f.airline || null,
          airlineCode: f.airlineCode || null,
        }));
        renderFares(state.fares);
        if (answer.note && state.fares.length > 0) toast.info("Fares", String(answer.note));
        return;
      }
      case "fastest_routes": {
        const destination = String(answer.destination || "").toUpperCase();
        const routes = (answer.routes || []).map((r) => ({
          origin: String(r.origin).toUpperCase(),
          destination: String(r.destination || destination).toUpperCase(),
          price: Number(r.price || 0),
          currency: String(r.currency || "EUR"),
          durationMinutes: Number(r.durationMinutes || 0),
          departureDate: r.departureDate || null,
        }));
        if (routes.length === 0) return;
        renderFastestRoutes(routes, destination, routes.map((r) => r.origin), answer.window || {});
        const winner = routes[0];
        toast.success(`Fastest: ${winner.origin} → ${destination}`, `${Math.floor((winner.durationMinutes || 0) / 60)}h · ${winner.currency} ${Number(winner.price || 0).toFixed(0)}`);
        return;
      }
      case "origin_compare": {
        const destination = String(answer.destination || "").toUpperCase();
        const rows = (answer.rows || []).map((r) => ({
          origin: String(r.origin).toUpperCase(),
          price: Number(r.price || 0),
          currency: String(r.currency || "EUR"),
          durationMinutes: r.durationMinutes ?? null,
          departureDate: r.departureDate || null,
        }));
        if (rows.length === 0) return;
        renderOriginCompare(rows, destination, rows.map((r) => r.origin), answer.window || {});
        toast.success(`Comparing ${rows.length} origins → ${destination}`);
        return;
      }
      case "itineraries": {
        const items = (answer.itineraries || []).map((it) => ({
          id: String(it.id),
          title: String(it.title || ""),
          totalPrice: Number(it.totalPrice || 0),
          currency: String(it.currency || "EUR"),
          totalDurationMinutes: it.totalDurationMinutes ?? null,
          legs: (it.legs || []).map((l) => ({
            origin: String(l.origin).toUpperCase(),
            destination: String(l.destination).toUpperCase(),
            date: String(l.date),
            price: Number(l.price || 0),
            currency: String(l.currency || "EUR"),
            airline: l.airline || null,
            crawlRunId: l.crawlRunId || null,
          })),
          summary: String(it.summary || ""),
          recommendationScore: Number(it.recommendationScore || 0),
        }));
        if (items.length === 0) return;
        state.itineraries = items;
        state.activeItineraryId = items[0].id;
        renderItineraries();
        if (state.activeItineraryId) renderItineraryOnMap(state.activeItineraryId);
        return;
      }
      default:
        return;
    }
  }

  /* ====================================================== */
  /* Silent-mode chat: UI updates instead of conversation  */
  /* ====================================================== */
  const aiProgressEl = () => $("ai-progress");
  const aiProgressLabel = () => $("ai-progress-label");
  const aiProgressTool = () => $("ai-progress-tool");
  const aiProgressHistory = () => $("ai-progress-history");
  const aiProgressClose = () => $("ai-progress-close");

  let aiProgressAutoHideTimer = null;

  function aiProgressReset() {
    if (aiProgressAutoHideTimer) { clearTimeout(aiProgressAutoHideTimer); aiProgressAutoHideTimer = null; }
    const list = aiProgressHistory();
    if (list) list.innerHTML = "";
  }

  function aiProgressShow(label) {
    const el = aiProgressEl();
    if (!el) return;
    aiProgressReset();
    el.classList.remove("hidden", "done");
    el.classList.add("open");
    if (aiProgressLabel()) aiProgressLabel().textContent = label || "Working on it…";
    if (aiProgressTool()) aiProgressTool().textContent = "";
    aiProgressRenderHistory([]);
  }
  function aiProgressUpdate(label, tool) {
    if (aiProgressLabel() && label) aiProgressLabel().textContent = label;
    if (aiProgressTool() && tool) aiProgressTool().textContent = tool;
    const el = aiProgressEl();
    if (!el) return;
    el.classList.remove("hidden", "done");
    el.classList.add("open");
  }
  function aiProgressDone(label) {
    const el = aiProgressEl();
    if (!el) return;
    el.classList.add("done");
    if (aiProgressLabel() && label) aiProgressLabel().textContent = label;
    const list = aiProgressHistory();
    if (list) list.querySelectorAll("li.current").forEach((li) => li.classList.remove("current"));
    if (aiProgressAutoHideTimer) clearTimeout(aiProgressAutoHideTimer);
    aiProgressAutoHideTimer = setTimeout(() => aiProgressHide(), 2400);
  }
  function aiProgressHide() {
    const el = aiProgressEl();
    if (!el) return;
    el.classList.remove("open");
    el.classList.add("hidden");
    if (aiProgressAutoHideTimer) { clearTimeout(aiProgressAutoHideTimer); aiProgressAutoHideTimer = null; }
  }

  function aiProgressAppendStep(label, tool) {
    const list = aiProgressHistory();
    if (!list) return;
    list.querySelectorAll("li.current").forEach((li) => li.classList.remove("current"));
    const li = document.createElement("li");
    li.className = "current";
    const text = tool ? `${label} · ${tool}` : label;
    li.textContent = text;
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  function aiProgressMarkCurrentDone() {
    const list = aiProgressHistory();
    if (!list) return;
    list.querySelectorAll("li.current").forEach((li) => li.classList.remove("current"));
  }

  function aiProgressRenderHistory(items) {
    const list = aiProgressHistory();
    if (!list) return;
    list.innerHTML = "";
    for (const it of items) {
      const li = document.createElement("li");
      if (it.current) li.className = "current";
      li.textContent = it.tool ? `${it.label} · ${it.tool}` : it.label;
      list.appendChild(li);
    }
  }

  aiProgressClose()?.addEventListener("click", () => aiProgressHide());

  const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmtMonthDay(iso) {
    if (!iso || typeof iso !== "string") return "";
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    const idx = Math.max(0, Math.min(11, parseInt(m[2], 10) - 1));
    return `${MONTH_ABBR[idx]} ${parseInt(m[3], 10)}`;
  }
  function fmtWindowRange(win) {
    if (!win || !win.dateFrom || !win.dateTo) return "";
    const a = fmtMonthDay(win.dateFrom);
    const b = fmtMonthDay(win.dateTo);
    const yearA = String(win.dateFrom).slice(0, 4);
    if (!a || !b) return `${win.dateFrom} → ${win.dateTo}`;
    return `${a} → ${b}, ${yearA}`;
  }
  function renderCheapestDeals(origin, deals, win) {
    state.faresAirport = origin || null;
    setSidebarMode("fares");
    const ap = origin ? state.airportsByIata.get(origin) : null;
    $("sidebar-title").textContent = `Cheapest fares from ${origin}`;
    $("sidebar-subtitle").textContent = `${fmtWindowRange(win)} · ${deals.length} result${deals.length === 1 ? "" : "s"}${ap && ap.country ? " · " + ap.country : ""}`;
    const body = $("sidebar-body");
    body.innerHTML = deals.map((d, i) => {
      const iata = String(d.iata || "").toUpperCase();
      const city = d.city || (state.airportsByIata.get(iata)?.city) || "";
      const country = d.country || (state.airportsByIata.get(iata)?.country) || "";
      const place = city ? `${iata} · ${city}` : iata;
      const price = Number(d.bestPrice || 0).toFixed(2);
      const currency = d.currency || "EUR";
      const bestDate = d.bestDate ? fmtMonthDay(d.bestDate) : "—";
      const airline = d.bestAirline || "";
      const flights = d.nFlights != null ? `${d.nFlights} fare${d.nFlights === 1 ? "" : "s"}` : "";
      const inTrip = state.destinations.includes(iata) ? " · in trip" : "";
      return `<div class="fare-card deal-card${i === 0 ? " active" : ""}" data-deal-iata="${escapeHtml(iata)}" data-deal-rank="${i + 1}">
        <div class="fare-route"><span style="color:var(--muted);font-weight:600;margin-right:6px;font-size:11px">#${i + 1}</span>${escapeHtml(origin || "")} <span class="arrow">→</span> ${escapeHtml(place)}${country ? ` <span style="color:var(--muted);font-weight:500">· ${escapeHtml(country)}</span>` : ""}</div>
        <div class="fare-meta">
          <span>${escapeHtml(bestDate)}${airline ? " · " + escapeHtml(airline) : ""}${flights ? " · " + escapeHtml(flights) : ""}${escapeHtml(inTrip)}</span>
          <span class="fare-price">${escapeHtml(currency)} ${escapeHtml(price)}</span>
        </div>
      </div>`;
    }).join("");

    $("fares-back")?.remove();
    const back = document.createElement("div");
    back.id = "fares-back";
    back.style.cssText = "padding:8px 20px 0;font-size:12px;display:flex;gap:6px;align-items:center";
    back.innerHTML = `<button class="ghost small" id="b-back-builder">← trip builder</button><span style="color:var(--muted);font-size:11px;margin-left:auto">Click a row to fly the map</span>`;
    body.parentNode?.insertBefore(back, body);
    back.querySelector("#b-back-builder").addEventListener("click", exitFaresToBuilder);

    body.querySelectorAll(".deal-card").forEach((card) => {
      card.addEventListener("click", () => {
        body.querySelectorAll(".deal-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        const iata = card.dataset.dealIata;
        if (iata && state.airportsByIata.has(iata)) {
          const ap2 = state.airportsByIata.get(iata);
          map.flyTo([ap2.lat, ap2.lon], Math.max(map.getZoom(), 6), { duration: 0.6 });
        }
      });
    });
  }

  function renderFastestRoutes(routes, destination, origins, win) {
    setSidebarMode("fares");
    $("sidebar-title").textContent = `Fastest to ${destination}`;
    $("sidebar-subtitle").textContent = `${(origins || []).join(", ")} → ${destination} · ${fmtWindowRange(win)} · ranked by duration`;
    const body = $("sidebar-body");
    if (!routes || routes.length === 0) {
      body.innerHTML = `<div class="empty"><h4>No routes</h4><p>No priced flights from ${(origins || []).join(", ")} to ${escapeHtml(destination)} in this window.</p></div>`;
      return;
    }
    const winner = routes[0];
    body.innerHTML = routes.map((r, i) => {
      const winnerCls = i === 0 ? " winner" : "";
      const dur = r.durationMinutes ? `${Math.floor(r.durationMinutes / 60)}h${r.durationMinutes % 60 ? " " + (r.durationMinutes % 60) + "m" : ""}` : "—";
      const price = Number(r.price || 0).toFixed(2);
      const date = r.bestDate ? fmtMonthDay(r.bestDate) : "—";
      const ap = state.airportsByIata.get(r.origin);
      const city = ap?.city || "";
      return `<div class="fare-card${winnerCls}${i === 0 ? " active" : ""}" data-origin="${escapeHtml(r.origin)}">
        <div class="fare-route"><span style="color:var(--muted);font-weight:600;margin-right:6px;font-size:11px">#${i + 1}</span>${escapeHtml(r.origin)} <span class="arrow">→</span> ${escapeHtml(destination)}${city ? ` <span style="color:var(--muted);font-weight:500">· ${escapeHtml(city)}</span>` : ""}</div>
        <div class="fare-meta">
          <span><strong>${escapeHtml(dur)}</strong> · ${escapeHtml(date)}${r.airline ? " · " + escapeHtml(r.airline) : ""}</span>
          <span class="fare-price">${escapeHtml(r.currency)} ${escapeHtml(price)}</span>
        </div>
      </div>`;
    }).join("");
    $("fares-back")?.remove();
    const back = document.createElement("div");
    back.id = "fares-back";
    back.style.cssText = "padding:8px 20px 0;font-size:12px;display:flex;gap:6px;align-items:center";
    back.innerHTML = `<button class="ghost small" id="b-back-builder">← trip builder</button><span style="color:var(--muted);font-size:11px;margin-left:auto">Fastest highlighted</span>`;
    body.parentNode?.insertBefore(back, body);
    back.querySelector("#b-back-builder").addEventListener("click", exitFaresToBuilder);
    const winnerAirport = state.airportsByIata.get(winner.origin);
    const destAirport = state.airportsByIata.get(destination);
    if (winnerAirport && destAirport) {
      clearDestinationArrows();
      const line = L.polyline([[winnerAirport.lat, winnerAirport.lon], [destAirport.lat, destAirport.lon]], {
        color: "#10b981",
        weight: 4,
        opacity: 0.9,
      });
      const label = L.marker([(winnerAirport.lat + destAirport.lat) / 2, (winnerAirport.lon + destAirport.lon) / 2], {
        icon: L.divIcon({
          className: "leg-label",
          html: `<div style="background:#10b981;color:#fff;border-radius:6px;padding:3px 7px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.25);">⚡ ${escapeHtml(dur)}${winner.price ? " · " + escapeHtml(winner.currency) + " " + Number(winner.price).toFixed(0) : ""}</div>`,
          iconSize: null,
          iconAnchor: [0, 0],
        }),
        interactive: false,
      });
      state.destinationArrowsLayer = L.layerGroup([line, label]).addTo(map);
      const b = L.latLngBounds([[winnerAirport.lat, winnerAirport.lon], [destAirport.lat, destAirport.lon]]);
      map.fitBounds(b, { padding: [80, 80], maxZoom: 7, animate: true });
    }
  }

  function renderOriginCompare(rows, destination, origins, win) {
    setSidebarMode("fares");
    $("sidebar-title").textContent = `Compare origins → ${destination}`;
    $("sidebar-subtitle").textContent = `${(origins || []).join(", ")} → ${destination} · ${fmtWindowRange(win)}`;
    const body = $("sidebar-body");
    if (!rows || rows.length === 0) {
      body.innerHTML = `<div class="empty"><h4>No comparison</h4><p>None of ${(origins || []).join(", ")} have priced flights to ${escapeHtml(destination)} in this window.</p></div>`;
      return;
    }
    body.innerHTML = rows.map((r, i) => {
      const dur = r.durationMinutes ? `${Math.floor(r.durationMinutes / 60)}h${r.durationMinutes % 60 ? " " + (r.durationMinutes % 60) + "m" : ""}` : "—";
      const price = Number(r.bestPrice || 0).toFixed(2);
      const date = r.bestDate ? fmtMonthDay(r.bestDate) : "—";
      const ap = state.airportsByIata.get(r.origin);
      const city = ap?.city || "";
      return `<div class="fare-card${i === 0 ? " active" : ""}" data-origin="${escapeHtml(r.origin)}">
        <div class="fare-route">${escapeHtml(r.origin)} <span class="arrow">→</span> ${escapeHtml(destination)}${city ? ` <span style="color:var(--muted);font-weight:500">· ${escapeHtml(city)}</span>` : ""}</div>
        <div class="fare-meta">
          <span>${escapeHtml(date)}${r.bestAirline ? " · " + escapeHtml(r.bestAirline) : ""}${dur !== "—" ? " · " + escapeHtml(dur) : ""}</span>
          <span class="fare-price">${escapeHtml(r.currency)} ${escapeHtml(price)}</span>
        </div>
      </div>`;
    }).join("");
    $("fares-back")?.remove();
    const back = document.createElement("div");
    back.id = "fares-back";
    back.style.cssText = "padding:8px 20px 0;font-size:12px;display:flex;gap:6px;align-items:center";
    back.innerHTML = `<button class="ghost small" id="b-back-builder">← trip builder</button>`;
    body.parentNode?.insertBefore(back, body);
    back.querySelector("#b-back-builder").addEventListener("click", exitFaresToBuilder);
    body.querySelectorAll(".fare-card").forEach((card) => {
      card.addEventListener("click", () => {
        body.querySelectorAll(".fare-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        const o = card.dataset.origin;
        const oa = state.airportsByIata.get(o);
        const da = state.airportsByIata.get(destination);
        if (oa && da) {
          clearDestinationArrows();
          const line = L.polyline([[oa.lat, oa.lon], [da.lat, da.lon]], { color: "#6366f1", weight: 3, opacity: 0.85 });
          state.destinationArrowsLayer = L.layerGroup([line]).addTo(map);
          const b = L.latLngBounds([[oa.lat, oa.lon], [da.lat, da.lon]]);
          map.fitBounds(b, { padding: [80, 80], maxZoom: 7, animate: true });
        }
      });
    });
  }


  function showClarification(question, suggestions, onSubmit) {
    const modal = $("ai-clarification");
    const q = $("ai-clarification-question");
    const suggestionBox = $("ai-clarification-suggestions");
    const reply = $("ai-clarification-reply");
    if (!modal || !q || !reply) return;
    q.textContent = question;
    reply.value = "";
    if (suggestionBox) {
      suggestionBox.replaceChildren();
      const uniqueSuggestions = [...new Set((suggestions || []).map((suggestion) => String(suggestion).trim()).filter(Boolean))].slice(0, 3);
      for (const suggestion of uniqueSuggestions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-chip";
        button.textContent = suggestion;
        button.addEventListener("click", () => {
          reply.value = suggestion;
          submit();
        });
        suggestionBox.appendChild(button);
      }
    }
    modal.classList.add("open");
    setTimeout(() => reply.focus(), 50);
    const close = () => {
      modal.classList.remove("open");
      $("btn-clarification-send").onclick = null;
      document.querySelectorAll("[data-close-clarification]").forEach((b) => { b.onclick = null; });
    };
    const submit = () => {
      const value = reply.value.trim();
      if (!value) { reply.focus(); return; }
      close();
      onSubmit(value);
    };
    $("btn-clarification-send").onclick = submit;
    document.querySelectorAll("[data-close-clarification]").forEach((b) => { b.onclick = close; });
    reply.onkeydown = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    };
  }

  function refreshHotAirportsFromRuns(runCards) {
    if (runCards.size === 0) return;
    if (state.faresAirport) loadFaresForAirport(state.faresAirport);
    if (state.destinations.length && state.sidebarMode === "itineraries" && state.itineraries.length) {
      renderItineraries();
      renderItineraryOnMap(state.activeItineraryId);
    }
  }

  function renderItineraries() {
    const body = $("sidebar-body");
    $("sidebar-title").textContent = "Itineraries";
    $("sidebar-subtitle").textContent = `${state.itineraries.length} option${state.itineraries.length === 1 ? "" : "s"} for your trip`;
    const fitBtn = $("btn-fit-itinerary");
    if (fitBtn) fitBtn.hidden = state.itineraries.length === 0;

    const header = document.createElement("div");
    header.id = "itineraries-header";
    header.style.cssText = "padding:10px 20px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap";
    header.innerHTML = `
      <button class="ghost small" id="b-back-builder-2">← edit destinations</button>
      <span style="font-size:11px;color:var(--muted);margin-left:auto">${state.itineraries.length} result${state.itineraries.length === 1 ? "" : "s"}</span>
    `;
    body.parentNode?.insertBefore(header, body);
    header.querySelector("#b-back-builder-2").addEventListener("click", () => {
      clearItineraryLayer();
      renderBuilder();
    });
    body.innerHTML = state.itineraries.map((it) => {
      const incomplete = !it.legs.every((l) => l.price > 0);
      const klass = it.id === state.activeItineraryId ? "active" : "";
      const fav = state.favorites.some((f) => f.itineraryId === it.id);
      return `<div class="itinerary-card ${klass}" data-itid="${escapeHtml(it.id)}">
        <div class="itinerary-head">
          <div class="itinerary-title">${escapeHtml(it.title || it.id.slice(0, 8))} ${incomplete ? '<span class="status-tag warn">incomplete</span>' : '<span class="status-tag ok">priced</span>'}</div>
          <div class="itinerary-price">${escapeHtml(it.currency)} ${Number(it.totalPrice).toFixed(2)}</div>
        </div>
        <div class="itinerary-stats">
          <span>${it.legs.length} legs</span>
          ${it.totalDurationMinutes ? `<span>${Math.round(it.totalDurationMinutes / 60)}h total</span>` : ""}
          <span>Score: ${it.recommendationScore}</span>
        </div>
        <div class="itinerary-summary">${escapeHtml(it.summary || "")}</div>
        <div class="leg-list">
          ${it.legs.map((l) => `<div class="leg-row">
            <span class="leg-iata">${escapeHtml(l.origin)}→${escapeHtml(l.destination)}</span>
            <span class="leg-meta">${escapeHtml(l.airline || "—")} · ${escapeHtml(l.date || "—")}</span>
            <span class="leg-iata">${l.price > 0 ? `${escapeHtml(l.currency)} ${Number(l.price).toFixed(2)}` : "—"}</span>
          </div>`).join("")}
        </div>
        <div class="itinerary-actions">
          <button class="secondary small" data-action="favorite">${fav ? "★ Saved" : "☆ Save"}</button>
          <button class="secondary small" data-action="refresh">Refresh crawl</button>
          <button class="secondary small" data-action="view">View trace</button>
        </div>
      </div>`;
    }).join("");

    body.querySelectorAll(".itinerary-card").forEach((card) => {
      card.addEventListener("click", (ev) => {
        const action = ev.target.closest("[data-action]")?.dataset.action;
        const id = card.dataset.itid;
        if (action === "favorite") {
          ev.stopPropagation();
          toggleFavorite(id);
          return;
        }
        if (action === "refresh") {
          ev.stopPropagation();
          refreshItineraryCrawl(id);
          return;
        }
        if (action === "view") {
          ev.stopPropagation();
          const it = state.itineraries.find((x) => x.id === id);
          if (it && it.legs[0]?.crawlRunId) window.open(`/admin?view=traces&trace=${encodeURIComponent(it.legs[0].crawlRunId)}`, "_blank");
          return;
        }
        state.activeItineraryId = id;
        state.selectedTripItineraryId = id;
        body.querySelectorAll(".itinerary-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        drawPins();
        renderItineraryOnMap(id);
      });
    });
  }

  function clearItineraryLayer() {
    if (state.itineraryLayer) {
      map.removeLayer(state.itineraryLayer);
      state.itineraryLayer = null;
    }
    state.selectedTripItineraryId = null;
  }

  function renderItineraryOnMap(id) {
    clearItineraryLayer();
    const it = state.itineraries.find((x) => x.id === id);
    if (!it) return;

    const coords = [];
    for (const leg of it.legs) {
      const oa = state.airportsByIata.get(leg.origin);
      const da = state.airportsByIata.get(leg.destination);
      if (oa && da) coords.push([oa, da, leg]);
    }
    if (coords.length === 0) {
      toast.warn("No coordinates", "Itinerary airports are missing lat/lon.");
      return;
    }

    const lines = [];
    const labels = [];
    const routeCounts = new Map();
    for (const [oa, da, leg] of coords) {
      const key = [oa.iata, da.iata].sort().join("|");
      routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
    }
      const routeOffsets = new Map();
    for (const [oa, da, leg] of coords) {
      const key = [oa.iata, da.iata].sort().join("|");
      const count = routeCounts.get(key) ?? 1;
      if (!routeOffsets.has(key)) routeOffsets.set(key, 0);
      const offset = routeOffsets.get(key) ?? 0;
      routeOffsets.set(key, offset + 1);
      const dLat = da.lat - oa.lat;
      const dLon = da.lon - oa.lon;
      const len = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
      const perpLat = (-dLon / len) * 0.6;
      const perpLon = (dLat / len) * 0.6;
      const stackOffset = count > 1 ? (offset % 2 === 0 ? 1 : -1) : 0;
      const mid = [(oa.lat + da.lat) / 2 + perpLat * stackOffset, (oa.lon + da.lon) / 2 + perpLon * stackOffset];
      lines.push(L.polyline([[oa.lat, oa.lon], [da.lat, da.lon]], {
        color: leg.price > 0 ? "#6366f1" : "#94a3b8",
        weight: 3,
        opacity: 0.9,
        dashArray: leg.price > 0 ? null : "6 6",
      }));
      const priceLabel = leg.price > 0 ? `${leg.currency} ${leg.price.toFixed(0)}` : "no data";
      labels.push(L.marker(mid, {
        icon: L.divIcon({
          className: "leg-label",
          html: `<div style="background:rgba(255,255,255,0.95);border:1px solid #4f46e5;border-radius:6px;padding:3px 6px;font-size:11px;font-weight:600;color:#4f46e5;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.2);">${escapeHtml(leg.origin)}→${escapeHtml(leg.destination)}<br/><span style="color:#64748b;font-weight:500">${escapeHtml(leg.date || "")} · ${escapeHtml(priceLabel)} · ${escapeHtml(leg.airline || "—")}</span></div>`,
          iconSize: null,
          iconAnchor: [0, 0],
        }),
        interactive: false,
      }));
    }
    state.itineraryLayer = L.layerGroup([...lines, ...labels]).addTo(map);

    const bounds = L.latLngBounds([]);
    for (const [oa, da] of coords) bounds.extend([oa.lat, oa.lon]).extend([da.lat, da.lon]);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [80, 80], maxZoom: 7, animate: true });
  }

  /* ====================================================== */
  /* Favorites                                              */
  /* ====================================================== */
  async function refreshFavorites() {
    try {
      const r = await getJson("/api/map/itinerary/favorites");
      state.favorites = r.favorites || [];
    } catch (e) {
      console.warn("refreshFavorites:", e);
      state.favorites = JSON.parse(localStorage.getItem("wayfarer.localFavs") || "[]");
    }
  }

  async function toggleFavorite(itineraryId) {
    const existing = state.favorites.find((f) => f.itineraryId === itineraryId);
    if (existing) {
      try {
        await delJson(`/api/map/itinerary/favorites/${encodeURIComponent(existing.id)}`);
        toast.success("Favorite removed");
      } catch (e) {
        toast.error("Could not remove favorite", String(e));
      }
    } else {
      const it = state.itineraries.find((x) => x.id === itineraryId);
      if (!it) return;
      try {
        await postJson("/api/map/itinerary/favorites", { itinerary: it });
        toast.success("Favorite saved");
      } catch (e) {
        const local = { id: crypto.randomUUID(), itineraryId: it.id, title: it.title, totalPrice: it.totalPrice, currency: it.currency, legs: it.legs, savedAt: new Date().toISOString() };
        const arr = JSON.parse(localStorage.getItem("wayfarer.localFavs") || "[]");
        arr.unshift(local);
        localStorage.setItem("wayfarer.localFavs", JSON.stringify(arr));
        toast.warn("Saved locally", "Server unavailable; stored in browser only.");
      }
    }
    await refreshFavorites();
    renderItineraries();
  }

  async function refreshItineraryCrawl(id) {
    const it = state.itineraries.find((x) => x.id === id);
    if (!it) return;
    try {
      const legs = it.legs.filter((l) => l.origin && l.destination).map((l) => ({
        origin: l.origin,
        destination: l.destination,
        date: l.date,
        dateTo: l.date,
      }));
      const r = await postJson("/api/map/itinerary/refresh-crawl", {
        legs,
        airline: "Ryanair",
      });
      toast.success("Crawl triggered", `Run ${r.runId?.slice(0, 12)}… · ${r.legsQueued} legs`);
    } catch (e) {
      toast.error("Crawl failed", String(e));
    }
  }

  /* ====================================================== */
  /* Toolbar                                                */
  /* ====================================================== */
  function syncAirlineToggle() {
    const btn = $("btn-toggle-airline");
    if (!btn) return;
    btn.classList.toggle("on", state.airline === "Ryanair");
    btn.textContent = state.airline === "Ryanair" ? "Ryanair" : "All";
  }
  $("btn-toggle-airline")?.addEventListener("click", () => {
    state.airline = state.airline === "Ryanair" ? "" : "Ryanair";
    localStorage.setItem("wayfarer.airline", state.airline);
    syncAirlineToggle();
    loadAirports();
  });
  $("btn-fit-itinerary")?.addEventListener("click", () => {
    if (state.activeItineraryId) renderItineraryOnMap(state.activeItineraryId);
  });
  $("btn-clear-airport")?.addEventListener("click", () => {
    if (state.mapFilterOrigin == null) return;
    state.mapFilterOrigin = null;
    state.mapFilterDestinations.clear();
    clearDestinationArrows();
    drawPins();
  });
  syncAirlineToggle();

  $("sort-select").addEventListener("change", (e) => {
    state.faresSort = e.target.value;
    if (state.selectedAirport) renderFares(sortFares(state.fares, state.faresSort));
  });
  ["filter-origin", "filter-dest"].forEach((id) => {
    $(id).addEventListener("input", (e) => {
      const v = e.target.value.toUpperCase();
      e.target.value = v;
      if (id === "filter-origin") state.faresFilters.origin = v;
      else state.faresFilters.dest = v;
      if (state.selectedAirport) loadFaresForAirport(state.selectedAirport);
    });
  });
  $("filter-date").addEventListener("change", (e) => {
    state.faresFilters.date = e.target.value;
    if (state.selectedAirport) loadFaresForAirport(state.selectedAirport);
  });
  ["f-ryanair", "f-easyjet"].forEach((id) => {
    $(id).addEventListener("change", () => {
      state.faresFilters.ryanair = $("f-ryanair").checked;
      state.faresFilters.easyjet = $("f-easyjet").checked;
      $("pill-ryanair").classList.toggle("on", state.faresFilters.ryanair);
      $("pill-easyjet").classList.toggle("on", state.faresFilters.easyjet);
      if (state.selectedAirport) loadFaresForAirport(state.selectedAirport);
    });
  });
  $("pill-ryanair").classList.toggle("on", state.faresFilters.ryanair);
  $("pill-easyjet").classList.toggle("on", state.faresFilters.easyjet);

  /* ====================================================== */
  /* Sidebar toggle, modals                                  */
  /* ====================================================== */
  $("sidebar-toggle").addEventListener("click", () => {
    $("sidebar").classList.toggle("collapsed");
  });
  document.querySelectorAll("[data-close-modal]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".modal-bg.open").forEach((m) => m.classList.remove("open"));
    });
  });
  document.querySelectorAll(".modal-bg").forEach((bg) => {
    bg.addEventListener("click", (e) => { if (e.target === bg) bg.classList.remove("open"); });
  });
  $("btn-settings").addEventListener("click", () => {
    $("set-home").value = state.homeIata;
    $("set-operator").checked = state.operatorMode;
    const slot = $("set-llm-status");
    if (slot) {
      if (state.llmStatus?.configured) {
        slot.innerHTML = `<span style="color:#047857;font-weight:600">● Hosted · ${escapeHtml(state.llmStatus.provider || "LLM")}${state.llmStatus.model ? " · " + escapeHtml(state.llmStatus.model) : ""}</span>`;
      } else {
        slot.innerHTML = `<span style="color:#b91c1c;font-weight:600">● Not configured</span> — set <code>OPENAI_API_KEY</code> / <code>MINIMAX_API_KEY</code> / etc. on the server.`;
      }
    }
    $("modal-settings").classList.add("open");
  });
  $("btn-account").addEventListener("click", () => {
    $("set-display-name").value = state.displayName;
    $("modal-account").classList.add("open");
  });
  $("btn-save-settings").addEventListener("click", async () => {
    state.homeIata = ($("set-home").value || "MLA").toUpperCase();
    if (!IATA_RE.test(state.homeIata)) { toast.warn("Invalid home IATA"); return; }
    state.operatorMode = $("set-operator").checked;
    localStorage.setItem("wayfarer.home", state.homeIata);
    localStorage.setItem("wayfarer.operator", state.operatorMode ? "1" : "0");
    syncOperatorLink();

    state.destinations = state.destinations.filter((d) => d !== state.homeIata);
    saveDestinations();
    clearDestinationArrows();
    clearItineraryLayer();
    state.selectedTripItineraryId = null;
    await refreshReachableToHome();
    drawPins();
    flyToHome();
    if (state.sidebarMode === "builder") renderBuilder();
    toast.success("Settings saved");
    $("modal-settings").classList.remove("open");
  });
  $("btn-export-favs").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.favorites, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wayfarer-favorites-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("nav-favorites").addEventListener("click", async (e) => {
    e.preventDefault();
    await refreshFavorites();
    $("sidebar-title").textContent = "Favorites";
    $("sidebar-subtitle").textContent = state.favorites.length === 0 ? "No favorites yet." : `${state.favorites.length} saved trip${state.favorites.length === 1 ? "" : "s"}`;
    setSidebarMode("itineraries");
    const body = $("sidebar-body");
    if (state.favorites.length === 0) {
      body.innerHTML = `<div class="empty"><h4>No favorites yet</h4><p>Plan a trip, then click ☆ Save on any itinerary.</p></div>
        <div class="builder-actions"><button class="primary" id="b-back-builder-3">Plan a trip →</button></div>`;
      body.querySelector("#b-back-builder-3")?.addEventListener("click", renderBuilder);
      return;
    }
    state.itineraries = state.favorites.map((f) => ({
      id: f.itineraryId,
      title: f.title,
      totalPrice: f.totalPrice,
      currency: f.currency,
      legs: f.legs,
      summary: "Saved favorite",
      recommendationScore: 100,
      totalDurationMinutes: null,
    }));
    state.activeItineraryId = state.itineraries[0].id;
    renderItineraries();
    renderItineraryOnMap(state.activeItineraryId);
  });

  /* ====================================================== */
  /* Boot                                                   */
  /* ====================================================== */
  async function boot() {
    autoResize();
    syncOperatorLink();
    initSessionChannel();
    const sessions = getStoredSessions();
    if (sessions.length > 0) {
      const latest = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      chatSessionId = latest.id;
      chatSessionParameters = latest.parameters || {};
      const currentLabel = $("session-current")?.querySelector(".session-label");
      if (currentLabel) currentLabel.textContent = latest.name || "New chat";
    }
    await Promise.all([loadAirports(), refreshFavorites(), refreshLlmStatus()]);
    renderBuilder();
  }
  boot().catch((e) => toast.error("Boot failed", String(e)));

  function syncOperatorLink() {
    const link = $("operator-link");
    if (!link) return;
    link.style.display = state.operatorMode ? "block" : "none";
  }

  async function refreshLlmStatus() {
    try {
      const r = await getJson(`/api/llm/status`);
      state.llmStatus = r;
    } catch (e) {
      state.llmStatus = { ok: false, configured: false, source: "none" };
    }
  }
})();
