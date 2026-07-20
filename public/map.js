/* ====================================================== */
/* Wayfarer — map UI script                                 */
/* ====================================================== */

(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const IATA_RE = /^[A-Z]{3}$/;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    destinations: loadDestinations(),
    faresAirport: null,
    itineraries: [],
    activeItineraryId: null,
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
    builder: {
      mode: localStorage.getItem("wayfarer.builder.mode") || "multi",
      planner: localStorage.getItem("wayfarer.builder.planner") || "sql",
      maxItineraries: Number(localStorage.getItem("wayfarer.builder.maxItineraries")) || 4,
      dateFrom: localStorage.getItem("wayfarer.builder.dateFrom") || nextStartIso(),
      dateTo: localStorage.getItem("wayfarer.builder.dateTo") || monthAfterNextIso(),
      daysPerStop: Number(localStorage.getItem("wayfarer.builder.daysPerStop")) || 3,
      minDays: Number(localStorage.getItem("wayfarer.builder.minDays")) || 3,
      maxDays: Number(localStorage.getItem("wayfarer.builder.maxDays")) || 14,
    },
  };

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
      const r = await getJson(`/api/map/airports?airline=${encodeURIComponent(state.airline)}`);
      state.airports = r.airports || [];
      state.airportsByIata = new Map(state.airports.map((a) => [a.iata, a]));
      drawPins();
      flyToHome();
      syncAirlineToggle();
    } catch (e) {
      console.error("loadAirports:", e);
      toast.error("Could not load airports", String(e));
    }
  }

  function pinHtml(airport, opts = {}) {
    const klass = ["airport-pin"];
    if (opts.home) klass.push("home");
    if (opts.inTrip) klass.push("in-trip");
    if (opts.faresView) klass.push("fares-view");
    if (opts.filterOrigin) klass.push("filter-origin");
    if (opts.dimmed) klass.push("dimmed");
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
    return {
      home: isHome,
      inTrip: isInDest,
      faresView: state.faresAirport === iata,
      filterOrigin: isFilterOrigin,
      dimmed: state.mapFilterOrigin != null && !isHome && !isInDest && !isFilterOrigin && !isConnected,
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
        viewFaresForAirport(a.iata);
      });
      m.bindTooltip(
        `${a.iata} · ${a.city || a.name || ""}${a.country ? " (" + a.country + ")" : ""}<br/><span style="font-size:11px;opacity:.75">Click to add · Right-click for fares</span>`,
        { direction: "top", offset: [0, -8] },
      );
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
      map.flyTo(allPoints[0], 12, { duration: 1 });
      return;
    }
    const bounds = L.latLngBounds(allPoints);
    const fittingZoom = map.getBoundsZoom(bounds, false, [80, 80]);
    const zoom = Math.min(Math.max(fittingZoom + 1, 8), 17);
    const center = bounds.getCenter();
    map.flyTo([center.lat, center.lng], zoom, { duration: 1 });
  }

  function toggleDestination(iata) {
    if (iata === state.homeIata) {
      toast.warn("That's your home airport", "Change it in settings.");
      return;
    }
    const idx = state.destinations.indexOf(iata);
    if (idx === -1) {
      if (state.builder.mode === "round") {
        state.destinations = [iata];
      } else {
        state.destinations.push(iata);
      }
      toast.info(state.builder.mode === "round" ? `Round-trip target: ${iata}` : "Added to trip", iata);
    } else {
      state.destinations.splice(idx, 1);
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
        const params = new URLSearchParams({ limit: "500" });
        const r = await getJson(`/api/map/airports/${encodeURIComponent(iata)}/fares?${params.toString()}`);
        const fares = r.fares || [];
        for (const f of fares) {
          if (f.origin === iata) state.mapFilterDestinations.add(f.destination);
          else state.mapFilterDestinations.add(f.origin);
        }
        drawPins();
      } catch (e) {
        console.warn("handlePinClick: failed to load fares for filter:", e);
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
      const params = new URLSearchParams({ limit: "500" });
      const r = await getJson(`/api/map/airports/${encodeURIComponent(iata)}/fares?${params.toString()}`);
      const fares = r.fares || [];
      for (const f of fares) {
        if (f.origin === iata) state.mapFilterDestinations.add(f.destination);
        else state.mapFilterDestinations.add(f.origin);
      }
      drawPins();
      fitToDestinations(iata);
    } catch (e) {
      console.warn("handlePinClick: failed to load fares for filter:", e);
    }
    toggleDestination(iata);
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
  function renderBuilder() {
    $("itineraries-header")?.remove();
    $("fares-back")?.remove();
    setSidebarMode("builder");
    const isRound = state.builder.mode === "round";
    const n = state.destinations.length;
    const subTitle = isRound
      ? (n === 0 ? "Round trip — pick one destination on the map" : n === 1 ? `Round trip to ${state.destinations[0]}` : "Round trip — keep one destination only")
      : `From ${state.homeIata} · ${n} destination${n === 1 ? "" : "s"} selected`;
    $("sidebar-title").textContent = isRound ? "Plan a round trip" : "Plan a multi-stop trip";
    $("sidebar-subtitle").textContent = subTitle;
    const body = $("sidebar-body");
    const home = state.airportsByIata.get(state.homeIata);
    const homeLabel = home ? `${state.homeIata} · ${home.city || home.name || ""}` : state.homeIata;

    const destChips = state.destinations.map((iata) => {
      const a = state.airportsByIata.get(iata);
      const label = a ? `${iata} · ${a.city || a.country || ""}` : iata;
      return `<span class="dest-chip">${escapeHtml(label)}<button class="dest-chip-remove" data-remove="${iata}" title="Remove">×</button></span>`;
    }).join("");

    const planDisabled = isRound ? n !== 1 : n === 0;
    const isSqlPlanner = state.builder.planner === "sql";
    const dateInputs = `
      <div class="builder-row">
        <div><label>Depart from</label><input type="date" id="b-from" value="${state.builder.dateFrom}" /></div>
        <div><label>Return by</label><input type="date" id="b-to" value="${state.builder.dateTo}" /></div>
      </div>
      <div class="builder-row" style="margin-top:8px">
        ${isRound
          ? `<div><label>Min trip days</label><input type="number" id="b-min-days" min="1" max="60" value="${state.builder.minDays}" /></div>
             <div><label>Max trip days</label><input type="number" id="b-max-days" min="1" max="60" value="${state.builder.maxDays}" /></div>`
          : `<div><label>Days per stop</label><input type="number" id="b-days" min="1" max="30" value="${state.builder.daysPerStop}" /></div>
             <div><label>Max itineraries</label><input type="number" id="b-max" min="1" max="8" value="${state.builder.maxItineraries}" /></div>`}
      </div>
      ${!isRound ? `
      <div class="builder-row" style="margin-top:8px">
        <div style="flex:1">
          <label>Planner</label>
          <select id="b-planner">
            <option value="sql" ${isSqlPlanner ? "selected" : ""}>SQL — single ClickHouse pass over all permutations</option>
            <option value="legacy" ${!isSqlPlanner ? "selected" : ""}>Legacy — JS-side permutation loop (slower)</option>
          </select>
        </div>
      </div>` : ""}
    `;

    body.innerHTML = `
      <div class="builder-section">
        <h4>Home</h4>
        <div style="font-weight:700">${escapeHtml(homeLabel)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Change in settings (top-right).</div>
      </div>
      <div class="builder-section">
        <h4>Trip type</h4>
        <div style="display:flex;gap:6px">
          <button class="secondary" id="b-mode-multi" style="flex:1;${!isRound ? "background:var(--accent-soft);color:var(--accent);border-color:var(--accent)" : ""}">Multi-stop</button>
          <button class="secondary" id="b-mode-round" style="flex:1;${isRound ? "background:var(--accent-soft);color:var(--accent);border-color:var(--accent)" : ""}">Round trip</button>
        </div>
      </div>
      <div class="builder-section">
        <h4>${isRound ? "Destination (click one pin)" : "Destinations (click pins to add)"}</h4>
        <div class="builder-destinations">${destChips}</div>
        ${isRound && n > 1 ? `<div style="font-size:11px;color:var(--warn);margin-top:6px">Round trip keeps only one destination. Remove extras or switch to Multi-stop.</div>` : ""}
      </div>
      <div class="builder-section">${dateInputs}</div>
      <div class="builder-summary">${summaryLine()}</div>
      <div class="builder-actions">
        <button class="secondary" id="b-clear" ${n === 0 ? "disabled" : ""}>Clear</button>
        <button class="primary" id="b-plan" ${planDisabled ? "disabled" : ""}>
          ${isRound ? "Find round trip →" : "Plan trip →"}
        </button>
      </div>
      <div class="builder-section">
        <h4>Or ask the assistant</h4>
        <p style="font-size:12px;color:var(--muted);margin:0 0 8px">Free-form prompts also work and will auto-detect countries.</p>
      </div>
    `;

    body.querySelectorAll("[data-remove]").forEach((b) =>
      b.addEventListener("click", () => toggleDestination(b.dataset.remove)),
    );
    $("b-mode-multi")?.addEventListener("click", () => { state.builder.mode = "multi"; renderBuilder(); });
    $("b-mode-round")?.addEventListener("click", () => { state.builder.mode = "round"; if (state.destinations.length > 1) { state.destinations = state.destinations.slice(0, 1); saveDestinations(); } renderBuilder(); });
    $("b-from").addEventListener("change", (e) => { state.builder.dateFrom = e.target.value; renderBuilder(); });
    $("b-to").addEventListener("change", (e) => { state.builder.dateTo = e.target.value; renderBuilder(); });
    $("b-days")?.addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(30, Number(e.target.value) || 3));
      state.builder.daysPerStop = v;
      e.target.value = String(v);
    });
    $("b-min-days")?.addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(60, Number(e.target.value) || 1));
      state.builder.minDays = v;
      e.target.value = String(v);
    });
    $("b-max-days")?.addEventListener("change", (e) => {
      const v = Math.max(state.builder.minDays, Math.min(60, Number(e.target.value) || 14));
      state.builder.maxDays = v;
      e.target.value = String(v);
    });
    $("b-max")?.addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(8, Number(e.target.value) || 4));
      state.builder.maxItineraries = v;
      localStorage.setItem("wayfarer.builder.maxItineraries", String(v));
      e.target.value = String(v);
    });
    $("b-planner")?.addEventListener("change", (e) => {
      state.builder.planner = e.target.value === "legacy" ? "legacy" : "sql";
      localStorage.setItem("wayfarer.builder.planner", state.builder.planner);
      toast.info("Planner set", state.builder.planner === "sql" ? "SQL — single ClickHouse pass" : "Legacy — JS permutation loop");
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
      if (state.builder.mode === "round") findRoundTrip();
      else planTrip();
    });
  }

  function summaryLine() {
    if (state.destinations.length === 0) return "";
    const home = state.homeIata;
    if (state.builder.mode === "round") {
      const dest = state.destinations[0];
      return `Route: <strong>${escapeHtml(home)} ⇄ ${escapeHtml(dest)}</strong><br/>${state.builder.minDays}–${state.builder.maxDays} day trips.`;
    }
    const stops = state.destinations.join(" → ");
    const totalDays = Math.max(1, daysBetween(state.builder.dateFrom, state.builder.dateTo));
    return `Route: <strong>${escapeHtml(home)} → ${escapeHtml(stops)} → ${escapeHtml(home)}</strong><br/>${totalDays} days, ~${state.builder.daysPerStop} per stop.`;
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

  document.querySelectorAll(".chat-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (chip.dataset.action === "clear") {
        state.destinations = [];
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
      if (chip.dataset.iata) {
        const iatas = chip.dataset.iata.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s));
        state.destinations = iatas.filter((i) => i !== state.homeIata);
        saveDestinations();
        for (const iata of state.airportsByIata.keys()) refreshPin(iata);
        if (state.sidebarMode !== "builder") exitFaresToBuilder();
        else renderBuilder();
        toast.success("Sample loaded", state.destinations.join(" → "));
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
    chatSend.disabled = true;
    setSidebarMode("itineraries");
    const home = state.homeIata;
    const stops = state.destinations.join(" → ");
    $("sidebar-title").textContent = "Planning your trip…";
    $("sidebar-subtitle").textContent = `${home} → ${stops} → ${home}`;
    $("sidebar-toolbar").hidden = true;
    const body = $("sidebar-body");
    const plannerLabel = state.builder.planner === "sql"
      ? `Single ClickHouse pass over all ${permutationsCount(state.destinations.length)} permutations.`
      : `Legacy JS-side loop over ${permutationsCount(state.destinations.length)} permutations.`;
    body.innerHTML = `<div class="empty"><h4>Generating itineraries…</h4><p>Computing ${state.destinations.length} stop${state.destinations.length === 1 ? "" : "s"} across ${permutationsCount(state.destinations.length)} permutations.</p><p style="font-size:11px;color:var(--muted);margin-top:6px">Planner: <strong>${state.builder.planner === "sql" ? "SQL" : "Legacy"}</strong> — ${plannerLabel}</p></div>`;

    try {
      const r = await postJson("/api/map/itinerary/generate", {
        homeIata: state.homeIata,
        destinations: state.destinations,
        dateFrom: state.builder.dateFrom,
        dateTo: state.builder.dateTo,
        daysPerCountry: state.builder.daysPerStop,
        maxItineraries: state.builder.maxItineraries,
        planner: state.builder.planner,
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

  function permutationsCount(n) {
    if (n <= 1) return 1;
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return f;
  }

  async function submitChat() {
    const prompt = chatInput.value.trim();
    if (!prompt) return;
    chatSend.disabled = true;
    setSidebarMode("itineraries");
    $("sidebar-toolbar").hidden = true;
    $("sidebar-title").textContent = "Assistant";
    $("sidebar-subtitle").textContent = prompt;
    const body = $("sidebar-body");
    const conversation = document.createElement("div");
    conversation.className = "chat-thread";
    conversation.innerHTML = `
      <div class="chat-msg user">${escapeHtml(prompt)}</div>
      <div class="chat-msg assistant assistant-text" data-role="assistant-text"><span class="thinking">Thinking…</span></div>
      <div class="chat-events" data-role="events"></div>
    `;
    body.innerHTML = "";
    body.appendChild(conversation);
    const assistantEl = conversation.querySelector("[data-role=assistant-text]");
    const eventsEl = conversation.querySelector("[data-role=events]");
    const runCards = new Map();

    const messages = [{ role: "user", content: prompt }];
    let resp;
    try {
      resp = await fetch("/api/llm/chat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ messages, maxIterations: 6 }),
      });
    } catch (e) {
      assistantEl.innerHTML = `<span class="err">Network error: ${escapeHtml(String(e))}</span>`;
      chatSend.disabled = false;
      return;
    }
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      assistantEl.innerHTML = `<span class="err">Assistant error (HTTP ${resp.status}): ${escapeHtml(text)}</span>`;
      chatSend.disabled = false;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantText = "";
    let sawDone = false;

    const finish = () => {
      chatSend.disabled = false;
      if (assistantText) {
        $("sidebar-title").textContent = "Assistant";
        $("sidebar-subtitle").textContent = `Plan ready · ${runCards.size} live task${runCards.size === 1 ? "" : "s"}`;
      } else {
        assistantEl.innerHTML = assistantEl.innerHTML.includes("err") ? assistantEl.innerHTML : `<span class="muted">(no reply)</span>`;
      }
      chatInput.value = "";
      autoResize();
      refreshHotAirportsFromRuns(runCards);
    };

    const handleEvent = (evtName, data) => {
      if (evtName === "status") return;
      if (evtName === "assistant_delta") {
        if (typeof data.content === "string") {
          assistantText += data.content;
          assistantEl.innerHTML = escapeHtml(assistantText).replace(/\n/g, "<br/>");
        }
        return;
      }
      if (evtName === "tool_call") {
        const card = document.createElement("div");
        card.className = "chat-tool-card";
        card.dataset.tool = data.name;
        card.innerHTML = `<div class="chat-tool-head"><span class="chat-tool-name">${escapeHtml(data.name)}</span><span class="status pending" data-status-for="${data.id}">running…</span></div><pre class="chat-tool-args">${escapeHtml(JSON.stringify(data.arguments ?? {}, null, 2))}</pre>`;
        eventsEl.appendChild(card);
        card.dataset.toolCallId = data.id;
        return;
      }
      if (evtName === "tool_result") {
        const card = eventsEl.querySelector(`.chat-tool-card[data-tool-call-id="${data.id}"]`);
        if (!card) return;
        const status = card.querySelector(`[data-status-for="${data.id}"]`);
        if (status) status.outerHTML = `<span class="status ok">ok</span>`;
        const pre = document.createElement("pre");
        pre.className = "chat-tool-result";
        const summary = summarizeToolResult(data.name, data.result);
        pre.innerHTML = `<details><summary>${escapeHtml(summary)}</summary><code>${escapeHtml(JSON.stringify(data.result ?? {}, null, 2)).slice(0, 2000)}</code></details>`;
        card.appendChild(pre);
        const result = data.result;
        if (result && typeof result === "object") {
          const flights = Array.isArray(result.itineraries) ? result.itineraries : Array.isArray(result.options) ? result.options : [];
          if (flights.length > 0) {
            const wrapped = flights.map((it, i) => ({
              id: String(it.id || `llm-${i}-${Date.now()}`),
              title: String(it.title || `Option ${i + 1}`),
              totalPrice: Number(it.totalPrice ?? 0),
              currency: String(it.currency ?? "EUR"),
              totalDurationMinutes: it.totalDurationMinutes ?? null,
              legs: it.legs || [],
              summary: String(it.summary || ""),
              recommendationScore: Number(it.recommendationScore ?? 0),
            }));
            state.itineraries = wrapped;
            state.activeItineraryId = wrapped[0].id;
          }
        }
        return;
      }
      if (evtName === "run_triggered") {
        const card = document.createElement("div");
        card.className = "chat-run-card";
        card.dataset.runId = data.runId;
        card.innerHTML = `
          <div class="chat-run-head">
            <span class="status queued" data-run-status>QUEUED</span>
            <strong>${escapeHtml(data.task || data.toolName || "task")}</strong>
            <span class="muted mono">${escapeHtml(String(data.runId).slice(0, 8))}…</span>
          </div>
          <div class="chat-run-meta muted" data-run-meta>just triggered</div>
        `;
        eventsEl.appendChild(card);
        runCards.set(data.runId, card);
        subscribeRunPolls(data.runId);
        return;
      }
      if (evtName === "run_status" || evtName === "run_final") {
        const card = runCards.get(data.runId);
        if (!card) return;
        const status = String(data.status || "UNKNOWN").toLowerCase();
        const badge = card.querySelector("[data-run-status]");
        if (badge) {
          badge.className = `status ${status}`;
          badge.textContent = data.status;
        }
        const meta = card.querySelector("[data-run-meta]");
        if (meta) {
          const parts = [];
          if (data.taskIdentifier) parts.push(escapeHtml(String(data.taskIdentifier)));
          if (data.costInCents != null) parts.push(`cost $${(Number(data.costInCents) / 100).toFixed(4)}`);
          if (data.durationMs != null) parts.push(`${Math.round(Number(data.durationMs) / 1000)}s`);
          meta.innerHTML = parts.length ? parts.join(" · ") : `<span class="muted">live · ${escapeHtml(evtName === "run_final" ? "finished" : "watching…")}</span>`;
        }
        if (evtName === "run_final" && /COMPLETED|FAILED|CANCEL|CRASH|TIMEOUT|EXPIRED/.test(String(data.status).toUpperCase())) {
          card.classList.add("run-done");
        }
        return;
      }
      if (evtName === "error") {
        assistantEl.innerHTML = `<span class="err">${escapeHtml(String(data.error || "Assistant error"))}</span>`;
        return;
      }
    };

    const subscribeRunPolls = (runId) => {
      fetch(`/api/runs/${encodeURIComponent(runId)}/stream`).catch(() => { /* if the chat already closed, ignore */ });
    };

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
          if (evtName === "done") sawDone = true;
          handleEvent(evtName, parsed);
        }
      }
    } catch (e) {
      assistantEl.innerHTML += `<br/><span class="err">Stream error: ${escapeHtml(String(e))}</span>`;
    }
    finish();
  }

  function summarizeToolResult(name, result) {
    if (!result || typeof result !== "object") return `result`;
    if (result.ok === false) return `error: ${result.error || "unknown"}`;
    if (name === "search_airports") return `${result.count ?? 0} airport${(result.count ?? 0) === 1 ? "" : "s"}`;
    if (name === "get_airport_fares") return `${result.count ?? 0} fare${(result.count ?? 0) === 1 ? "" : "s"} for ${result.iata || ""}`;
    if (name === "plan_round_trip") return `${result.count ?? 0} round trip${(result.count ?? 0) === 1 ? "" : "s"}`;
    if (name === "plan_multi_stop") return `${result.count ?? 0} itinerary options`;
    if (name === "trigger_refresh_crawl") return `enqueued ${result.enqueued ?? 0}, queued worker run ${(result.runId || "").slice(0, 8)}…`;
    if (name === "list_favorites") return `${result.count ?? 0} favorite${(result.count ?? 0) === 1 ? "" : "s"}`;
    if (name === "save_favorite" || name === "remove_favorite") return "ok";
    return "result";
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
        body.querySelectorAll(".itinerary-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        renderItineraryOnMap(id);
      });
    });
  }

  function clearItineraryLayer() {
    if (state.itineraryLayer) {
      map.removeLayer(state.itineraryLayer);
      state.itineraryLayer = null;
    }
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
    for (const [oa, da, leg] of coords) {
      lines.push(L.polyline([[oa.lat, oa.lon], [da.lat, da.lon]], {
        color: leg.price > 0 ? "#6366f1" : "#94a3b8",
        weight: 3,
        opacity: 0.9,
        dashArray: leg.price > 0 ? null : "6 6",
      }));
      const mid = [(oa.lat + da.lat) / 2, (oa.lon + da.lon) / 2];
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
