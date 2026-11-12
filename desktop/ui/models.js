"use strict";

// Agent Models page: a table of every known agent with an inspector for the selected one.
// Validation and saving stay in z-delegate; this page edits rows and shows its verdicts.
(function () {
  const { el, icon, invoke, errText, plural } = zak;

  const MODEL_RE = /^[a-z0-9][a-z0-9._:-]*\/[a-z0-9][a-z0-9._:-]*$/;
  const SOURCE_LABELS = { claude: "Claude", "claude-project": "Claude", codex: "Codex", "codex-project": "Codex", builtin: "Built-in", config: "Config only" };

  const M = {
    status: "idle", // idle | loading | ready | error
    error: null,
    missing: [],
    data: null,
    names: [],
    sources: {},
    rows: {},
    orig: {},
    sel: null,
    filter: "all",
    q: "",
    chains: {},
    chainError: null,
    previewSeq: 0,
    banner: null, // { kind, message, reload }
    saving: false,
  };
  let ui = null; // refs for the mounted page
  let previewTimer = null;

  const emptyRow = () => ({ model: [], thinking: "", inherit: "" });
  const isEmpty = (r) => !r.model.length && !r.thinking && !r.inherit;
  const same = (a, b) => a.thinking === b.thinking && a.inherit === b.inherit && a.model.join("\n") === b.model.join("\n");
  const clone = (r) => ({ model: [...r.model], thinking: r.thinking, inherit: r.inherit });

  function normAlias(v) {
    const strs = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === "string") : []);
    if (typeof v === "string") return { model: [v], thinking: "", inherit: "" };
    if (Array.isArray(v)) return { model: strs(v), thinking: "", inherit: "" };
    if (v && typeof v === "object") {
      return {
        model: typeof v.model === "string" ? [v.model] : strs(v.model),
        thinking: typeof v.thinking === "string" ? v.thinking : "",
        inherit: typeof v.inherit === "string" ? v.inherit : "",
      };
    }
    return emptyRow();
  }

  const changedNames = () => M.names.filter((n) => !same(M.rows[n], M.orig[n]));

  function buildEdits() {
    const edits = {};
    for (const n of changedNames()) edits[n] = isEmpty(M.rows[n]) ? null : clone(M.rows[n]);
    return edits;
  }

  function effective(name) {
    const seen = new Set();
    const out = { model: null, modelFrom: null, effort: null, effortFrom: null };
    let cur = name;
    while (cur && !seen.has(cur) && M.rows[cur]) {
      seen.add(cur);
      const r = M.rows[cur];
      if (out.model == null && r.model.length) {
        out.model = r.model;
        out.modelFrom = cur;
      }
      if (out.effort == null && r.thinking) {
        out.effort = r.thinking;
        out.effortFrom = cur;
      }
      cur = r.inherit;
    }
    return out;
  }

  function sourceText(name) {
    const labels = [...new Set((M.sources[name] || ["config"]).map((s) => SOURCE_LABELS[s] || s))];
    return labels.join(", ");
  }

  // ---- loading ----
  async function missingTools() {
    try {
      const t = await invoke("tool_status");
      zak.state.tools = t;
      const out = [];
      if (!t.node.path) out.push("Node.js (node)");
      if (!t.z_delegate.path) out.push("the z-delegate helper (z-delegate.cjs)");
      return out;
    } catch (e) {
      return [];
    }
  }

  async function load(keepSelection) {
    M.status = "loading";
    M.error = null;
    paintPage();
    try {
      const s = await invoke("models_state");
      if (!s || !Array.isArray(s.agents)) throw new Error((s && s.error) || "The model state was empty.");
      M.data = s;
      const aliases = (s.config && s.config.models && s.config.models.aliases) || {};
      M.sources = {};
      for (const a of s.agents) M.sources[a.name] = a.sources;
      const names = new Set(s.agents.map((a) => a.name));
      for (const n of Object.keys(aliases)) names.add(n);
      M.names = [...names].sort((x, y) => x.localeCompare(y));
      M.rows = {};
      M.orig = {};
      for (const n of M.names) {
        M.orig[n] = normAlias(aliases[n]);
        M.rows[n] = clone(M.orig[n]);
      }
      if (!keepSelection || !M.names.includes(M.sel)) M.sel = null;
      M.banner = s.error ? { kind: "error", message: String(s.error) } : null;
      M.status = "ready";
      paintPage();
      runPreview();
    } catch (e) {
      M.status = "error";
      M.error = errText(e);
      M.missing = await missingTools();
      paintPage();
    }
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 300);
  }

  async function runPreview() {
    if (M.status !== "ready") return;
    const seq = ++M.previewSeq;
    const rows = {};
    for (const n of M.names) rows[n] = clone(M.rows[n]);
    try {
      const r = await invoke("models_preview", { rows });
      if (seq !== M.previewSeq) return;
      M.chains = (r && r.chains) || {};
      M.chainError = null;
    } catch (e) {
      if (seq !== M.previewSeq) return;
      M.chains = {};
      M.chainError = errText(e);
    }
    if (ui && ui.root.isConnected) {
      M.names.forEach(paintRow);
      paintInspectorChain();
    }
  }

  // ---- preference chain text ----
  // The chain is the ordered model list. Whether an entry runs depends on the orchestrator that spawns the agent,
  // so an entry is marked bad only when no host can run it.
  const shortModel = (m) => m.slice(m.indexOf("/") + 1);

  function chainParts(name) {
    if (M.chainError) return [{ text: "Preview unavailable", bad: true, title: M.chainError }];
    const r = M.chains[name];
    if (!r) return [{ text: "…", muted: true }];
    if (r.error) return [{ text: String(r.error), bad: true }];
    if (!r.chain.length) return [{ text: "—", muted: true }];
    return r.chain.map((x, i) => ({
      text: `${i + 1}. ${shortModel(x.model)}`,
      bad: !x.ok,
      title: x.ok ? x.model : `${x.model}\n${(x.reasons || []).join("\n")}`,
    }));
  }

  function chainNode(name) {
    const wrap = el("span", { class: "chain-line mono" });
    chainParts(name).forEach((p, i) => {
      if (i) wrap.append(" ");
      wrap.append(el("span", { class: p.bad ? "bad" : p.muted ? "muted" : "", text: p.text, title: p.title || "" }));
    });
    return wrap;
  }

  // ---- table ----
  function modelCell(name) {
    const r = M.rows[name];
    if (r.model.length) {
      const wrap = el("span", {}, el("span", { class: "mono", text: r.model[0] }));
      if (r.model.length > 1) wrap.append(el("span", { class: "more", text: ` +${r.model.length - 1}` }));
      return wrap;
    }
    const eff = effective(name);
    if (eff.model) return el("span", { class: "muted", title: `Inherited from ${eff.modelFrom}` }, el("span", { class: "mono", text: eff.model[0] }));
    return el("span", { class: "muted", text: "—" });
  }

  // Effort symbol (Symbols Nerd Font, Material Design range): filling circle for lower levels, fire for the top two. Unknown values get none.
  const FIRE = "\u{F0238}";
  const EFFORT_SYMBOLS = { off: "\u{F0766}", minimal: "\u{F0A9F}", low: "\u{F0AA1}", medium: "\u{F0AA3}", high: "\u{F0AA5}", xhigh: FIRE, max: FIRE + FIRE };
  function effortSymbol(value) {
    return Object.hasOwn(EFFORT_SYMBOLS, value) ? EFFORT_SYMBOLS[value] : "";
  }
  function effortSymbolNode(value) {
    const hot = value === "xhigh" || value === "max";
    return el("span", { class: hot ? "effort-sym hot" : "effort-sym", "aria-hidden": "true", text: effortSymbol(value) });
  }
  function effortContent(value) {
    return el("span", { class: "effort-val" }, ...(effortSymbol(value) ? [effortSymbolNode(value)] : []), el("span", { class: "effort-text", text: value }));
  }

  function paintRow(name) {
    const refs = ui && ui.rowRefs[name];
    if (!refs) return;
    const r = M.rows[name];
    const changed = !same(r, M.orig[name]);
    refs.mark.hidden = !changed;
    refs.tr.classList.toggle("changed", changed);
    refs.model.replaceChildren(modelCell(name));
    const eff = effective(name);
    if (r.thinking) {
      refs.effort.className = "num";
      refs.effort.title = "";
      refs.effort.replaceChildren(effortContent(r.thinking));
    } else {
      refs.effort.className = "num muted";
      refs.effort.replaceChildren(eff.effort ? effortContent(eff.effort) : "—");
      refs.effort.title = eff.effort ? `Inherited from ${eff.effortFrom}` : "";
    }
    refs.inherit.className = r.inherit ? "" : "muted";
    refs.inherit.textContent = r.inherit || "—";
    refs.chain.replaceChildren(chainNode(name));
  }

  function visibleNames() {
    const q = M.q.trim().toLowerCase();
    return M.names.filter((n) => {
      if (q && !n.toLowerCase().includes(q)) return false;
      if (M.filter === "configured") return !isEmpty(M.rows[n]);
      if (M.filter === "unconfigured") return isEmpty(M.rows[n]);
      return true;
    });
  }

  function selectRow(name, focus) {
    M.sel = name;
    for (const [n, r] of Object.entries(ui.rowRefs)) r.tr.setAttribute("aria-selected", String(n === name));
    if (focus && ui.rowRefs[name]) ui.rowRefs[name].tr.focus();
    paintInspector();
  }

  function paintBody() {
    ui.rowRefs = {};
    const names = visibleNames();
    ui.tbody.replaceChildren();
    for (const n of names) {
      const mark = el("span", { class: "mark", title: "Changed", hidden: true }, el("span", { class: "sr", text: "Changed" }));
      const model = el("td");
      const effort = el("td", { class: "num" });
      const inherit = el("td");
      const chain = el("td", { class: "chain-cell" });
      const tr = el(
        "tr",
        { tabindex: "0", "aria-selected": String(n === M.sel), class: "row" },
        el("th", { scope: "row", class: "agent" }, mark, el("span", { text: n })),
        el("td", { class: "muted", text: sourceText(n), title: (M.sources[n] || []).join(", ") }),
        model,
        effort,
        inherit,
        chain
      );
      tr.addEventListener("click", () => selectRow(n, false));
      tr.addEventListener("keydown", (e) => {
        const list = visibleNames();
        const i = list.indexOf(n);
        if (e.key === "ArrowDown" && i < list.length - 1) selectRow(list[i + 1], true);
        else if (e.key === "ArrowUp" && i > 0) selectRow(list[i - 1], true);
        else if (e.key === "Enter" || e.key === " ") selectRow(n, false);
        else return;
        e.preventDefault();
      });
      ui.rowRefs[n] = { tr, mark, model, effort, inherit, chain };
      ui.tbody.append(tr);
      paintRow(n);
    }
    ui.empty.hidden = names.length > 0;
    ui.empty.textContent = M.names.length ? "No agents match." : "No agents found.";
  }

  // ---- inspector ----
  function paintInspector(focusKey) {
    const box = ui.inspector;
    box.replaceChildren();
    const name = M.sel;
    if (!name) {
      box.append(el("p", { class: "inspector-empty", text: "Select an agent to edit its model chain, effort and inheritance." }));
      return;
    }
    const r = M.rows[name];
    const eff = effective(name);
    box.append(el("h2", { class: "inspector-title", text: name }), el("p", { class: "muted small", text: sourceText(name) }));

    // model chain
    const chain = el("ol", { class: "chain" });
    r.model.forEach((id, i) => {
      chain.append(
        el(
          "li",
          { class: "chain-item" },
          el("span", { class: "mono id", text: id, title: id }),
          el("span", { class: "chain-actions" },
            iconBtn("up", "Move up", i === 0, () => move(name, i, -1), `up${i}`),
            iconBtn("down", "Move down", i === r.model.length - 1, () => move(name, i, 1), `down${i}`),
            iconBtn("x", "Remove", false, () => removeModel(name, i), `rm${i}`)
          )
        )
      );
    });
    const known = (M.data.models || []).filter((m) => !r.model.includes(m));
    const pick = el("select", { class: "field", "aria-label": "Add a known model", "data-key": "pick" }, el("option", { value: "", text: "Add known model…" }), ...known.map((m) => el("option", { value: m, text: m })));
    pick.addEventListener("change", () => {
      if (pick.value) addModel(name, pick.value, "pick");
    });
    const free = el("input", { class: "field mono", type: "text", placeholder: "provider/model-id", "aria-label": "Custom model id", autocomplete: "off", spellcheck: "false", "data-key": "free" });
    const err = el("p", { class: "field-error", role: "alert", hidden: true });
    const addFree = () => {
      const v = free.value.trim();
      if (!v) return;
      if (!MODEL_RE.test(v)) {
        err.textContent = "Use provider/model with lowercase letters, numbers and . _ : -";
        err.hidden = false;
        return;
      }
      if (r.model.includes(v)) {
        err.textContent = "That model is already in the chain.";
        err.hidden = false;
        return;
      }
      addModel(name, v, "free");
    };
    free.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addFree();
      }
    });
    box.append(
      el("h3", { text: "Model chain" }),
      r.model.length ? chain : el("p", { class: "muted small", text: eff.model ? `No model set. Inherits ${eff.model.join(", ")} from ${eff.modelFrom}.` : "No model set." }),
      pick,
      el("div", { class: "inline" }, free, el("button", { class: "btn", type: "button", text: "Add", on: { click: addFree } })),
      err
    );

    // effort
    const efforts = [...(M.data.efforts || [])];
    if (r.thinking && !efforts.includes(r.thinking)) efforts.push(r.thinking);
    const effortSel = el("select", { class: "field", id: "ins-effort", "data-key": "effort" }, el("option", { value: "", text: "Inherit / none" }), ...efforts.map((x) => el("option", { value: x, text: x })));
    effortSel.value = r.thinking;
    effortSel.addEventListener("change", () => edit(name, () => (r.thinking = effortSel.value), "effort"));
    // Native option popups cannot use the bundled font, so the effective symbol sits in the heading.
    const effortSym = el("span", { class: "effort-head-sym" });
    const paintEffortSym = () => {
      const v = r.thinking || effective(name).effort;
      effortSym.replaceChildren(...(effortSymbol(v) ? [effortSymbolNode(v)] : []));
      effortSym.classList.toggle("muted", !r.thinking);
    };
    paintEffortSym();
    effortSel.addEventListener("change", paintEffortSym);
    box.append(
      el("h3", {}, el("label", { for: "ins-effort", text: "Effort" }), effortSym),
      effortSel
    );
    if (!r.thinking) box.append(el("p", { class: "muted small", text: eff.effort ? `Effective: ${eff.effort} from ${eff.effortFrom}.` : "Effective: none." }));

    // inherit
    const inh = [...M.names.filter((n) => n !== name)];
    if (r.inherit && !inh.includes(r.inherit)) inh.push(r.inherit);
    const inhSel = el("select", { class: "field", id: "ins-inherit", "data-key": "inherit" }, el("option", { value: "", text: "None" }), ...inh.map((x) => el("option", { value: x, text: x })));
    inhSel.value = r.inherit;
    inhSel.addEventListener("change", () => edit(name, () => (r.inherit = inhSel.value), "inherit"));
    box.append(el("h3", {}, el("label", { for: "ins-inherit", text: "Inherit" })), inhSel);

    // preference order
    ui.insChain = el("div", { class: "pref-detail" });
    box.append(el("h3", { text: "Preference order" }), ui.insChain);
    paintInspectorChain();

    box.append(
      el("div", { class: "inspector-foot" }, el("button", { class: "btn", type: "button", text: "Clear alias", disabled: isEmpty(r), "data-key": "clear", on: { click: () => edit(name, () => Object.assign(r, emptyRow()), "pick") } }))
    );
    if (focusKey) {
      const t = box.querySelector(`[data-key="${focusKey}"]`) || box.querySelector("[data-key]");
      if (t) t.focus();
    }
  }

  function paintInspectorChain() {
    if (!ui || !ui.insChain || !M.sel) return;
    ui.insChain.replaceChildren();
    const r = M.chains[M.sel];
    if (M.chainError) return ui.insChain.append(el("p", { class: "bad small", text: M.chainError }));
    if (!r) return ui.insChain.append(el("p", { class: "muted small", text: "Checking models…" }));
    if (r.error) return ui.insChain.append(el("p", { class: "bad small", text: String(r.error) }));
    if (!r.chain.length) return ui.insChain.append(el("p", { class: "muted small", text: "No models set." }));
    const list = el("ol", { class: "pref-list" });
    r.chain.forEach((x) => {
      const item = el("li", { class: "small" }, el("span", { class: x.ok ? "mono" : "mono bad", text: x.model }));
      if (!x.ok) item.append(el("span", { class: "muted block", text: `Cannot run: ${(x.reasons || []).join("; ")}` }));
      list.append(item);
    });
    ui.insChain.append(list, el("p", { class: "muted small", text: "The orchestrator picks the route when it spawns the agent." }));
  }

  function iconBtn(name, label, disabled, onClick, key) {
    return el("button", { class: "icon-btn", type: "button", "aria-label": label, title: label, disabled, "data-key": key, on: { click: onClick } }, icon(name));
  }

  function edit(name, mutate, focusKey) {
    mutate();
    paintRow(name);
    paintInspector(focusKey);
    paintToolbar();
    schedulePreview();
  }
  function move(name, i, d) {
    const m = M.rows[name].model;
    edit(name, () => m.splice(i + d, 0, m.splice(i, 1)[0]), d < 0 ? `up${Math.max(i - 1, 0)}` : `down${i + 1}`);
  }
  const removeModel = (name, i) => edit(name, () => M.rows[name].model.splice(i, 1), "pick");
  const addModel = (name, id, key) => edit(name, () => M.rows[name].model.push(id), key);

  // ---- toolbar, banner, save ----
  function paintToolbar() {
    if (!ui) return;
    const n = changedNames().length;
    ui.revert.disabled = n === 0 || M.saving;
    ui.save.disabled = n === 0 || M.saving;
    ui.save.textContent = M.saving ? "Saving…" : n ? `Save ${n} ${n === 1 ? "Change" : "Changes"}…` : "Save Changes…";
  }

  function paintBanner() {
    if (!ui) return;
    ui.banner.replaceChildren();
    const b = M.banner;
    if (!b) return;
    const actions = b.reload ? [el("button", { class: "btn", type: "button", text: "Reload", on: { click: () => load(true) } })] : [];
    ui.banner.append(zak.banner(b.kind, b.message, actions));
  }

  // ---- save plan sheet ----
  const dash = (v) => (v ? v : "—");
  const chain = (r) => (r.model.length ? r.model.join(" → ") : "—");

  function diffLine(label, before, after, removed) {
    return el(
      "li",
      { class: "diff-line" },
      el("span", { class: "diff-field", text: label }),
      el("span", { class: "mono diff-before", text: before }),
      el("span", { class: "diff-arrow", "aria-hidden": "true", text: "→" }),
      el("span", { class: "mono diff-after" + (removed ? " bad" : ""), text: after })
    );
  }

  function saveNode(names) {
    const root = el("div", { class: "plan" });
    for (const n of names) {
      const before = M.orig[n];
      const after = M.rows[n];
      const removed = isEmpty(after);
      const added = isEmpty(before);
      const lines = [];
      if (before.model.join("\n") !== after.model.join("\n")) lines.push(diffLine("Model", chain(before), chain(after), removed));
      if (before.thinking !== after.thinking) lines.push(diffLine("Effort", dash(before.thinking), dash(after.thinking), removed));
      if (before.inherit !== after.inherit) lines.push(diffLine("Inherit", dash(before.inherit), dash(after.inherit), removed));
      root.append(
        el(
          "section",
          { class: "plan-host" + (removed ? " remove" : "") },
          el("div", { class: "plan-host-head" }, el("h3", { text: n }), el("span", { class: "count" + (removed ? " bad" : ""), text: removed ? "Removed" : added ? "New" : "Changed" })),
          el("ul", { class: "diff" }, ...lines)
        )
      );
    }
    return root;
  }

  // Save opens the plan sheet. The validator's verdicts (409, 422) stay inside it, so nothing is lost on a refusal.
  function openSave() {
    if (M.saving) return;
    const edits = buildEdits();
    const names = Object.keys(edits);
    if (!names.length) return;
    const label = `Save ${plural(names.length, "change")} to agents.json`;
    zak.sheet({
      title: "Save agent models?",
      subtitle: M.data.path || "agents.json",
      subtitleMono: true,
      content: saveNode(names),
      confirm: { label },
      onConfirm: async (c) => {
        M.saving = true;
        M.banner = null;
        paintBanner();
        paintToolbar();
        try {
          const r = await invoke("models_save", { edits, baseHash: M.data.hash == null ? null : M.data.hash });
          if (r.status === 200) {
            const where = (r.body && r.body.path) || M.data.path;
            await load(true);
            M.banner = { kind: "ok", message: `Saved to ${where}.` };
            paintBanner();
            return undefined;
          }
          if (r.status === 409) {
            c.setStatus("agents.json changed on disk after you loaded it. Nothing was saved. Reloading shows the current file and discards your edits.", "error");
            c.setConfirm({ label: "Reload and Discard Edits", danger: true, run: async () => void (await load(true)) });
            c.setCancelLabel("Keep Editing");
            return { stay: true };
          }
          if (r.status === 422) {
            const errs = (r.body && r.body.errors) || ["The configuration is not valid."];
            c.setStatus(errs.map(String).join("\n"), "error");
            return { stay: true };
          }
          c.setStatus((r.body && (r.body.error || JSON.stringify(r.body))) || `Save failed (status ${r.status}).`, "error");
          return { stay: true };
        } finally {
          M.saving = false;
          paintToolbar();
        }
      },
    });
  }

  function revert() {
    for (const n of M.names) M.rows[n] = clone(M.orig[n]);
    M.banner = null;
    paintBanner();
    paintBody();
    paintInspector();
    paintToolbar();
    schedulePreview();
  }

  // ---- page shell ----
  function setupHint() {
    const parts = M.missing.length ? `Missing: ${M.missing.join(" and ")}.` : "The model editor could not start.";
    return parts;
  }

  function paintPage() {
    if (!ui || !ui.root.isConnected) return;
    const ready = M.status === "ready";
    ui.main.hidden = !ready;
    ui.inspector.hidden = !ready;
    ui.state.hidden = ready;
    ui.search.disabled = !ready;
    ui.segButtons.forEach((b) => (b.disabled = !ready));
    if (M.status === "loading" || M.status === "idle") {
      ui.state.replaceChildren(el("p", { class: "loading", text: "Loading agents…" }));
    } else if (M.status === "error") {
      ui.state.replaceChildren(
        el("h2", { text: "Agent Models is unavailable" }),
        el("p", { text: setupHint() }),
        el("p", { class: "muted", text: "Install Node.js and make sure it is on your login-shell PATH. Install the kit's z-delegation skill with “zak kit install --global --tier general”, then try again." }),
        el("p", { class: "muted mono block", text: M.error || "" }),
        el("button", { class: "btn", type: "button", text: "Try Again", on: { click: () => load(false) } })
      );
    }
    if (ready) {
      paintBody();
      paintInspector();
      paintBanner();
    }
    paintToolbar();
  }

  function render(container) {
    container.replaceChildren();
    const search = el("input", { class: "field search", type: "search", placeholder: "Search agents", "aria-label": "Search agents", autocomplete: "off", spellcheck: "false" });
    search.value = M.q;
    search.addEventListener("input", () => {
      M.q = search.value;
      paintBody();
    });
    const segDefs = [["all", "All"], ["configured", "Configured"], ["unconfigured", "Not configured"]];
    const seg = el("div", { class: "seg", role: "radiogroup", "aria-label": "Filter agents" });
    const segButtons = segDefs.map(([v, label]) => {
      const b = el("button", { type: "button", role: "radio", "aria-checked": String(M.filter === v), text: label });
      b.addEventListener("click", () => {
        M.filter = v;
        segButtons.forEach((x, i) => x.setAttribute("aria-checked", String(segDefs[i][0] === v)));
        paintBody();
      });
      return b;
    });
    seg.append(...segButtons);
    const revertBtn = el("button", { class: "btn", type: "button", text: "Revert", on: { click: revert } });
    const saveBtn = el("button", { class: "btn primary", type: "button", text: "Save Changes", on: { click: openSave } });

    const tbody = el("tbody");
    const emptyEl = el("p", { class: "table-empty", hidden: true });
    const table = el(
      "table",
      { class: "table models-table" },
      el("thead", {}, el("tr", {}, ...["Agent", "Source", "Model", "Effort", "Inherit", "Preference order"].map((t) => el("th", { scope: "col", text: t })))),
      tbody
    );
    const banner = el("div", { class: "banner-slot" });
    const main = el("div", { class: "models-main" }, banner, el("div", { class: "group table-scroll" }, table, emptyEl));
    const inspector = el("aside", { class: "inspector", "aria-label": "Inspector" });
    const state = el("div", { class: "empty" });

    container.append(
      el(
        "div",
        { class: "toolbar", "data-tauri-drag-region": true },
        el("div", { class: "titles", "data-tauri-drag-region": true }, el("h1", { text: "Agent Models" })),
        el("div", { class: "actions" }, el("span", { class: "search-wrap" }, icon("search"), search), seg, revertBtn, saveBtn)
      ),
      el("div", { class: "models-body" }, state, main, inspector)
    );
    ui = { root: container, search, segButtons, revert: revertBtn, save: saveBtn, tbody, empty: emptyEl, banner, main, inspector, state, rowRefs: {}, insChain: null };
    if (M.status === "idle") load(false);
    else paintPage();
  }

  zak.pages.models = { render };
})();
