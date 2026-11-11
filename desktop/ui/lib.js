"use strict";

// Shared helpers. All dynamic text (paths, agent names, CLI output) goes through textContent or text nodes.
window.zak = {
  state: { installs: null, installsError: null, tools: null, current: null },
  pages: {},
};

(function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const ICONS = {
    laptop: "M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5V10H3zM1.5 12.5h13",
    folder: "M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z",
    plus: "M8 3.5v9M3.5 8h9",
    sliders: "M3 5h10M7 3.5v3M3 11h10M10 9.5v3",
    cube: "M8 2l5 2.5v7L8 14l-5-2.5v-7zM3 4.5l5 2.5 5-2.5M8 7v7",
    chevron: "M4 6.5l4 4 4-4",
    check: "M3.5 8.5l3 3 6-7",
    x: "M4 4l8 8M12 4l-8 8",
    up: "M8 13V3M4 7l4-4 4 4",
    down: "M8 3v10M4 9l4 4 4-4",
    search: "M7 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zM10.8 10.8L14 14",
  };

  zak.icon = function (name) {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", ICONS[name] || "");
    svg.append(path);
    return svg;
  };

  // el(tag, props, ...children). props: class, text, on:{event:fn}, or any attribute. Falsy props are skipped.
  zak.el = function (tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "on") for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
        else if (k === "disabled" || k === "checked" || k === "hidden" || k === "readOnly") node[k] = v;
        else node.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const c of children) if (c != null && c !== false) node.append(c);
    return node;
  };
  const el = zak.el;

  zak.invoke = function (cmd, args) {
    const t = window.__TAURI__;
    if (!t || !t.core) return Promise.reject("The Tauri runtime is not available.");
    return t.core.invoke(cmd, args);
  };

  zak.errText = (e) => (typeof e === "string" ? e : (e && e.message) || JSON.stringify(e));
  zak.firstLine = (s) => String(s || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  zak.plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  zak.baseName = (p) => String(p || "").replace(/\/+$/, "").split("/").pop() || String(p || "");

  zak.pickFolder = async function () {
    const d = window.__TAURI__ && window.__TAURI__.dialog;
    if (!d) throw new Error("The folder picker is not available.");
    const r = await d.open({ directory: true, multiple: false });
    if (Array.isArray(r)) return r[0] || null;
    return typeof r === "string" ? r : null;
  };

  zak.banner = function (kind, message, actions) {
    const body = el("div", { class: "banner-body" });
    if (Array.isArray(message)) {
      body.append(el("ul", { class: "banner-list" }, ...message.map((m) => el("li", { text: m }))));
    } else {
      body.append(el("span", { text: message }));
    }
    return el("div", { class: "banner " + kind, role: kind === "error" ? "alert" : "status" }, body, ...(actions || []));
  };

  // ---- popup menu (More menu) ----
  let openMenu = null;
  function closeMenu(focusButton) {
    if (!openMenu) return;
    const { menu, button } = openMenu;
    openMenu = null;
    menu.remove();
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (focusButton) button.focus();
  }
  function onOutside(e) {
    if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.button.contains(e.target)) closeMenu(false);
  }
  zak.closeMenu = () => closeMenu(false);

  // The button's parent must be a `.menu-wrap`. getItems() runs on every open so labels stay current.
  zak.attachMenu = function (button, getItems) {
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      if (openMenu && openMenu.button === button) return closeMenu(true);
      closeMenu(false);
      const menu = el("div", { class: "menu", role: "menu" });
      for (const it of getItems()) {
        if (it.separator) {
          menu.append(el("div", { class: "menu-sep", role: "separator" }));
          continue;
        }
        const radio = it.checked !== undefined;
        const item = el("button", {
          type: "button",
          role: radio ? "menuitemradio" : "menuitem",
          "aria-checked": radio ? String(!!it.checked) : null,
          class: "menu-item" + (it.danger ? " danger" : ""),
          disabled: !!it.disabled,
          on: {
            click: () => {
              closeMenu(true);
              it.onSelect();
            },
          },
        });
        item.append(el("span", { class: "menu-check" }, it.checked ? zak.icon("check") : null), el("span", { text: it.label }));
        menu.append(item);
      }
      menu.addEventListener("keydown", (e) => {
        const items = [...menu.querySelectorAll(".menu-item:not(:disabled)")];
        const i = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") items[(i + 1) % items.length].focus();
        else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length].focus();
        else if (e.key === "Escape") closeMenu(true);
        else if (e.key === "Tab") closeMenu(false);
        else return;
        e.preventDefault();
      });
      button.parentElement.append(menu);
      button.setAttribute("aria-expanded", "true");
      openMenu = { menu, button };
      document.addEventListener("pointerdown", onOutside, true);
      const first = menu.querySelector(".menu-item:not(:disabled)");
      if (first) first.focus();
    });
  };

  // ---- sheet (every confirmation and the plan view) ----
  // opts: { title, subtitle, subtitleMono, content, confirm: {label, disabled, danger, run}, cancelLabel, onConfirm(ctl) }
  // The confirm button runs cfg.run when set, else opts.onConfirm. A handler that returns { stay: true } keeps
  // the sheet open (for example to plan again). Any other return closes it; a throw shows the error in the sheet.
  // Returns a controller; ctl.done resolves true when the confirm action completed, false otherwise.
  zak.sheet = function (opts) {
    const dlg = document.getElementById("sheet");
    if (dlg.open) dlg.close();
    dlg.replaceChildren();

    const state = { busy: false, committed: false, cfg: opts.confirm || { label: "Confirm" } };
    const title = el("h2", { id: "sheet-title", text: opts.title });
    const sub = el("p", { class: "sheet-sub" + (opts.subtitleMono ? " mono" : "") });
    const body = el("div", { class: "sheet-body" });
    const status = el("p", { class: "sheet-status", role: "status", "aria-live": "polite" });
    const bar = el("div", { class: "progress", hidden: true }, el("span", { class: "progress-run" }));
    const cancel = el("button", { class: "btn", type: "button", text: opts.cancelLabel || "Cancel" });
    const confirm = el("button", { class: "btn primary", type: "button" });

    function syncConfirm() {
      confirm.textContent = state.cfg.label;
      confirm.disabled = state.busy || !!state.cfg.disabled;
      confirm.classList.toggle("danger", !!state.cfg.danger);
    }
    function setSubtitle(text) {
      sub.textContent = text || "";
      sub.hidden = !text;
    }
    function setBusy(busy) {
      state.busy = busy;
      cancel.disabled = busy;
      bar.hidden = !busy;
      syncConfirm();
    }
    function setStatus(text, kind) {
      status.textContent = text || "";
      status.className = "sheet-status" + (kind ? " " + kind : "");
      status.hidden = !text;
    }
    function setContent(node) {
      body.replaceChildren(node);
    }
    function close(ok) {
      state.committed = !!ok;
      if (dlg.open) dlg.close();
    }

    setSubtitle(opts.subtitle);
    setStatus("");
    if (opts.content) setContent(opts.content);
    syncConfirm();

    const ctl = {
      setContent,
      setSubtitle,
      setStatus,
      setCancelLabel: (t) => (cancel.textContent = t),
      setTitle: (t) => (title.textContent = t),
      setConfirm(cfg) {
        state.cfg = cfg;
        syncConfirm();
      },
      close,
    };

    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", async () => {
      const run = state.cfg.run || opts.onConfirm;
      if (!run) return close(true);
      setBusy(true);
      setStatus("");
      try {
        const r = await run(ctl);
        if (r && r.stay) return setBusy(false);
        close(true);
      } catch (e) {
        setBusy(false);
        setStatus(zak.errText(e), "error");
      }
    });
    dlg.oncancel = (e) => {
      if (state.busy) e.preventDefault();
    };

    dlg.append(
      el("div", { class: "sheet-head" }, title, sub),
      body,
      el("div", { class: "sheet-foot" }, bar, status, el("div", { class: "sheet-buttons" }, cancel, confirm))
    );
    ctl.done = new Promise((resolve) => {
      dlg.addEventListener("close", () => resolve(state.committed), { once: true });
    });
    dlg.showModal();
    return ctl;
  };
})();
