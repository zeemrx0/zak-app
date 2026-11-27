"use strict";

// Shell: sidebar, routing, tool status. Pages live in installs.js, models.js, templates.js and source.js.
(function () {
  const { el, icon, invoke, errText } = zak;
  const $ = (id) => document.getElementById(id);
  const S = zak.state;
  let addError = null;

  const pageFor = (id) => (id === "models" ? zak.pages.models : id === "templates" ? zak.pages.templates : id === "source" ? zak.pages.source : zak.pages.installs);

  function navButton(id, label, iconName, title, withDot) {
    const b = el("button", { class: "nav-item", type: "button", "data-nav": id, title: title || label, on: { click: () => select(id) } }, icon(iconName), el("span", { class: "nav-label", text: label }));
    if (withDot) b.append(el("span", { class: "dot nav-dot", "data-dot": id, hidden: true }));
    return b;
  }

  // A sync dot per location once its check has run. Green, amber or red; hidden before and while checking.
  zak.updateDots = function () {
    for (const d of document.querySelectorAll("[data-dot]")) {
      const info = zak.pages.installs.locationDot(d.dataset.dot);
      d.hidden = !info;
      if (info) {
        d.className = "dot nav-dot " + info.dot;
        d.setAttribute("role", "img");
        d.setAttribute("aria-label", info.text);
        d.title = info.text;
      }
    }
  };

  function renderSidebar() {
    const nav = $("nav");
    nav.replaceChildren();
    const I = S.installs;
    const installs = el("div", { class: "nav-group", role: "group", "aria-labelledby": "grp-installs" }, el("h2", { class: "nav-title", id: "grp-installs", text: "Installs" }));
    installs.append(navButton("global", "This Mac", "laptop", null, true));
    if (I) for (const p of I.projects) installs.append(navButton("project:" + p.path, zak.baseName(p.path), "folder", p.path, true));
    else if (S.installsError) installs.append(el("p", { class: "nav-note bad", text: "Could not read installs." }));
    if (I && I.projects_error) installs.append(el("p", { class: "nav-note bad", role: "alert", text: I.projects_error }));
    installs.append(el("button", { class: "nav-item add", type: "button", on: { click: addProject } }, icon("plus"), el("span", { class: "nav-label", text: "Add Project…" })));
    if (addError) installs.append(el("p", { class: "nav-note bad", role: "alert", text: addError }));

    const config = el(
      "div",
      { class: "nav-group", role: "group", "aria-labelledby": "grp-config" },
      el("h2", { class: "nav-title", id: "grp-config", text: "Configuration" }),
      navButton("models", "Agent Models", "sliders"),
      navButton("templates", "Templates", "doc"),
      navButton("source", "Kit Source", "cube")
    );
    nav.append(installs, config);
    markCurrent();
    zak.updateDots();
  }

  function markCurrent() {
    for (const b of document.querySelectorAll("[data-nav]")) {
      const on = b.dataset.nav === S.current;
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
  }

  function select(id) {
    zak.closeMenu();
    S.current = id;
    markCurrent();
    const page = $("page");
    pageFor(id).render(page, id);
  }
  zak.select = select;

  zak.refreshInstalls = async function () {
    S.installsError = null;
    try {
      S.installs = await invoke("installs");
    } catch (e) {
      S.installsError = errText(e);
    }
    zak.pages.installs.onRefresh();
    renderSidebar();
    if (S.current && S.current.startsWith("project:") && S.installs && !S.installs.projects.some((p) => "project:" + p.path === S.current)) S.current = "global";
    if (S.current === "global" || (S.current && S.current.startsWith("project:"))) select(S.current);
  };

  async function addProject() {
    addError = null;
    try {
      const path = await zak.pickFolder();
      if (!path) return renderSidebar();
      const added = await invoke("project_add", { path });
      await zak.refreshInstalls();
      select("project:" + added.path);
    } catch (e) {
      addError = errText(e);
      renderSidebar();
    }
  }

  // Up and Down move the selection through the sidebar items.
  $("nav").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...document.querySelectorAll("[data-nav]")];
    const i = items.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    const next = items[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    select(next.dataset.nav);
    next.focus();
  });

  // ---- tool status ----
  const clean = (v) => String(v == null ? "" : v).replace(/^(zak|node)\s+/i, "").replace(/^v(?=\d)/, "");

  function paintTools() {
    const t = S.tools;
    const dot = $("tool-dot");
    const text = $("tool-text");
    if (!t) {
      dot.className = "dot off";
      text.textContent = "Tools unavailable";
      return;
    }
    const zakOk = !!t.zak.path;
    const all = zakOk && !!t.node.path && !!t.z_delegate.path;
    dot.className = "dot " + (all ? "green" : zakOk ? "amber" : "red");
    text.textContent = zakOk ? `zak ${clean(t.zak.version) || "unknown"} · node ${clean(t.node.version) || "missing"}` : "zak not installed";
    const pop = $("tool-pop");
    const row = (label, value, bad) => el("div", { class: "pop-row" }, el("span", { class: "pop-label", text: label }), el("span", { class: "mono" + (bad ? " bad" : ""), text: value }));
    pop.replaceChildren(
      row("zak", t.zak.path || "Not found", !t.zak.path),
      row("node", !t.node.path ? "Not found" : t.node_ok ? t.node.path : `${t.node.path} (needs ${zak.cliInstall.nodeMin} or newer)`, !t.node.path || !t.node_ok),
      row("z-delegate", t.z_delegate.path || "Not found", !t.z_delegate.path),
      row("agents.json", t.current_config && t.current_config.path ? `${t.current_config.path}${t.current_config.exists ? "" : " (missing)"}` : "Unknown", !(t.current_config && t.current_config.exists))
    );
    if (!zakOk) {
      pop.append(
        el("button", { class: "btn", type: "button", text: "Install zak CLI…", disabled: !zak.cliInstall.nodeReady(), title: zak.cliInstall.nodeReady() ? "" : zak.cliInstall.nodeNote(), on: { click: () => (setPop(false), zak.cliInstall.open()) } })
      );
    }
  }

  // The Install pages swap their body when zak appears or disappears, so redraw the current page then.
  zak.refreshTools = async function () {
    const was = zak.cliInstall.missing();
    try {
      S.tools = await invoke("tool_status");
    } catch (e) {
      S.tools = null;
    }
    paintTools();
    const installsPage = S.current === "global" || (S.current && S.current.startsWith("project:"));
    if (installsPage && was !== zak.cliInstall.missing()) select(S.current);
  };

  function setPop(open) {
    $("tool-pop").hidden = !open;
    $("tool-status").setAttribute("aria-expanded", String(open));
  }
  $("tool-status").addEventListener("click", () => setPop($("tool-pop").hidden));
  document.addEventListener("pointerdown", (e) => {
    if (!$("tool-pop").hidden && !e.target.closest(".status-wrap")) setPop(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("tool-pop").hidden) {
      setPop(false);
      $("tool-status").focus();
    }
  });

  // ---- start ----
  S.current = "global";
  renderSidebar();
  select("global");
  zak.refreshTools();
  zak.refreshInstalls();
})();
