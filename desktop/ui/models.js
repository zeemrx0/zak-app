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
    legacy: {}, // alias-level thinking from the file, read only: the fallback for entries that carry none
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

  const DEFAULT_EFFORT = "medium";
  const emptyRow = () => ({ model: [], inherit: "", active: "" });
  const isEmpty = (r) => !r.model.length && !r.inherit && !r.active;
  const same = (a, b) => a.inherit === b.inherit && a.active === b.active && a.model.length === b.model.length && a.model.every((e, i) => e.id === b.model[i].id && e.thinking === b.model[i].thinking);
  const clone = (r) => ({ model: r.model.map((e) => ({ ...e })), inherit: r.inherit, active: r.active });

  // An entry with thinking "" is not set in the file. It resolves to the nearest alias-level thinking on the inherit chain, else medium.
  function effort(rows, name, entry) {
    if (entry.thinking) return entry.thinking;
    const seen = new Set();
    for (let cur = name; cur && !seen.has(cur) && rows[cur]; cur = rows[cur].inherit) {
      seen.add(cur);
      if (M.legacy[cur]) return M.legacy[cur];
    }
    return DEFAULT_EFFORT;
  }
  const resolved = (rows, name) => ({ ...rows[name], model: rows[name].model.map((e) => ({ id: e.id, thinking: effort(rows, name, e) })) });
  const chainText = (rows, name) => (rows[name].model.length ? rows[name].model.map((e) => `${e.id} · ${effort(rows, name, e)}`).join(" → ") : "—");

  function normAlias(v) {
    const entry = (x, legacy) => {
      if (typeof x === "string") return { id: x, thinking: legacy };
      if (x && typeof x === "object" && typeof x.id === "string") return { id: x.id, thinking: typeof x.thinking === "string" && x.thinking ? x.thinking : legacy };
      return null;
    };
    const list = (x, legacy) => (Array.isArray(x) ? x : x == null ? [] : [x]).map((e) => entry(e, legacy)).filter(Boolean);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const legacy = typeof v.thinking === "string" ? v.thinking : "";
      return { model: list(v.model, legacy), inherit: typeof v.inherit === "string" ? v.inherit : "", active: typeof v.active === "string" ? v.active : "" };
    }
    return { model: list(v, ""), inherit: "", active: "" };
  }

  const changedNames = () => M.names.filter((n) => !same(M.rows[n], M.orig[n]));

  function buildEdits() {
    const edits = {};
    for (const n of changedNames()) edits[n] = isEmpty(M.rows[n]) ? null : resolved(M.rows, n);
    return edits;
  }

  // The nearest row on the inherit chain that has its own model chain.
  function effective(name) {
    const seen = new Set();
    let cur = name;
    while (cur && !seen.has(cur) && M.rows[cur]) {
      seen.add(cur);
      if (M.rows[cur].model.length) return { model: M.rows[cur].model, modelFrom: cur };
      cur = M.rows[cur].inherit;
    }
    return { model: null, modelFrom: null };
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

  // silent: a background refresh keeps the page on screen and ignores a failed read.
  async function load(keepSelection, silent) {
    if (!silent) {
      M.status = "loading";
      M.error = null;
      paintPage();
    }
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
      M.legacy = {};
      for (const n of M.names) {
        const a = aliases[n];
        M.legacy[n] = a && typeof a === "object" && !Array.isArray(a) && typeof a.thinking === "string" ? a.thinking : "";
        M.orig[n] = normAlias(aliases[n]);
        M.rows[n] = clone(M.orig[n]);
      }
      if (!keepSelection || !M.names.includes(M.sel)) M.sel = null;
      M.banner = s.error ? { kind: "error", message: String(s.error) } : null;
      M.status = "ready";
      paintPage();
      runPreview();
    } catch (e) {
      if (silent) return;
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

  // The installed kit can change while the app sits in the background. Refresh when the window returns.
  // Unsaved edits are never discarded: with edits only the preview re-runs, without edits the state reloads too.
  function refreshOnReturn() {
    if (document.visibilityState === "hidden" || !ui || !ui.root.isConnected || M.status !== "ready") return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (!ui || !ui.root.isConnected || M.status !== "ready") return;
      if (changedNames().length) runPreview();
      else load(true, true);
    }, 300);
  }
  // The shell has no unmount hook, so the listeners live once for the page's lifetime and check the mounted state.
  window.addEventListener("focus", refreshOnReturn);
  document.addEventListener("visibilitychange", refreshOnReturn);

  async function runPreview() {
    if (M.status !== "ready") return;
    const seq = ++M.previewSeq;
    const rows = {};
    for (const n of M.names) rows[n] = resolved(M.rows, n);
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

  // ---- table ----
  // The cell lists the effective chain in order. An entry is marked bad only when the preview says no host can run it.
  function modelCell(name) {
    const r = M.rows[name];
    const eff = r.model.length ? null : effective(name);
    const list = r.model.length ? r.model : eff && eff.model;
    if (!list || !list.length) return el("span", { class: "muted", text: "—" });
    const owner = eff ? eff.modelFrom : name;
    const preview = M.chains[name];
    const verdicts = new Map(((preview && preview.chain) || []).map((x) => [x.model, x]));
    const wrap = el("div", { class: "model-chain mono" });
    if (eff) {
      wrap.classList.add("muted");
      wrap.title = `Inherited from ${eff.modelFrom}`;
    }
    list.forEach((e, i) => {
      const v = verdicts.get(e.id);
      const bad = !!v && !v.ok;
      const text = `${e.id} · ${effort(M.rows, owner, e)}`;
      const line = el("div", { class: bad ? "bad" : "", title: bad ? `${text}\n${(v.reasons || []).join("\n")}` : text }, `${i + 1}. ${text}`);
      if (e.id === r.active) line.append(el("span", { class: "active-badge", text: "active", title: "Active model: the router starts here" }));
      wrap.append(line);
    });
    const note = M.chainError ? "Preview unavailable" : preview && preview.error ? String(preview.error) : "";
    if (note) wrap.append(el("div", { class: "bad small", text: note, title: M.chainError || note }));
    return wrap;
  }

  function paintRow(name) {
    const refs = ui && ui.rowRefs[name];
    if (!refs) return;
    const r = M.rows[name];
    const changed = !same(r, M.orig[name]);
    refs.mark.hidden = !changed;
    refs.tr.classList.toggle("changed", changed);
    refs.model.replaceChildren(modelCell(name));
    refs.inherit.className = r.inherit ? "" : "muted";
    refs.inherit.textContent = r.inherit || "—";
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
      const inherit = el("td");
      const tr = el(
        "tr",
        { tabindex: "0", "aria-selected": String(n === M.sel), class: "row" },
        el("th", { scope: "row", class: "agent" }, mark, el("span", { text: n })),
        el("td", { class: "muted", text: sourceText(n), title: (M.sources[n] || []).join(", ") }),
        inherit,
        model
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
      ui.rowRefs[n] = { tr, mark, model, inherit };
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
      box.append(el("p", { class: "inspector-empty", text: "Select an agent to edit its model chain, per-model effort and inheritance." }));
      return;
    }
    const r = M.rows[name];
    const eff = effective(name);
    box.append(el("h2", { class: "inspector-title", text: name }), el("p", { class: "muted small", text: sourceText(name) }));

    // model chain
    const chain = el("ol", { class: "chain" });
    r.model.forEach((m, i) => {
      const efforts = [...(M.data.efforts || [])];
      const cur = effort(M.rows, name, m);
      if (!efforts.includes(cur)) efforts.push(cur);
      const sel = el("select", { class: "field chain-effort", "aria-label": `Effort for ${m.id}`, "data-key": `eff${i}` }, ...efforts.map((x) => el("option", { value: x, text: x })));
      sel.value = cur;
      sel.addEventListener("change", () => edit(name, () => (m.thinking = sel.value), `eff${i}`));
      chain.append(
        el(
          "li",
          { class: "chain-item" },
          el("span", { class: "mono id", text: m.id, title: m.id }),
          el("div", { class: "chain-row2" },
            sel,
            el("span", { class: "chain-actions" },
              iconBtn("up", "Move up", i === 0, () => move(name, i, -1), `up${i}`),
              iconBtn("down", "Move down", i === r.model.length - 1, () => move(name, i, 1), `down${i}`),
              iconBtn("x", "Remove", false, () => removeModel(name, i), `rm${i}`)
            )
          )
        )
      );
    });
    const known = (M.data.models || []).filter((m) => !r.model.some((e) => e.id === m));
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
      if (r.model.some((e) => e.id === v)) {
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
      r.model.length ? chain : el("p", { class: "muted small", text: eff.model ? `No model set. Inherits ${eff.model.map((e) => `${e.id} · ${effort(M.rows, eff.modelFrom, e)}`).join(", ")} from ${eff.modelFrom}.` : "No model set." }),
      pick,
      el("div", { class: "inline" }, free, el("button", { class: "btn", type: "button", text: "Add", on: { click: addFree } })),
      err
    );

    // active model
    const chainIds = (r.model.length ? r.model : eff.model || []).map((e) => e.id);
    const activeIds = r.active && !chainIds.includes(r.active) ? [...chainIds, r.active] : chainIds;
    const activeSel = el("select", { class: "field", id: "ins-active", "data-key": "active" }, el("option", { value: "", text: "Automatic (first usable)" }), ...activeIds.map((x) => el("option", { value: x, text: x })));
    activeSel.value = r.active;
    activeSel.addEventListener("change", () => edit(name, () => (r.active = activeSel.value), "active"));
    box.append(el("h3", {}, el("label", { for: "ins-active", text: "Active model" })), activeSel);

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
      const item = el("li", { class: "small" }, el("span", { class: x.ok ? "mono" : "mono bad", text: `${x.model} · ${x.effort}` }));
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
  const removeModel = (name, i) =>
    edit(
      name,
      () => {
        const r = M.rows[name];
        if (r.model.splice(i, 1)[0].id === r.active) r.active = "";
      },
      "pick"
    );
  const addModel = (name, id, key) => edit(name, () => M.rows[name].model.push({ id, thinking: DEFAULT_EFFORT }), key);

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
      const chainBefore = chainText(M.orig, n);
      const chainAfter = chainText(M.rows, n);
      if (chainBefore !== chainAfter) lines.push(diffLine("Model", chainBefore, chainAfter, removed));
      if (before.active !== after.active) lines.push(diffLine("Active", dash(before.active), dash(after.active), removed));
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
      el("thead", {}, el("tr", {}, ...["Agent", "Source", "Inherit", "Model"].map((t) => el("th", { scope: "col", text: t })))),
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
