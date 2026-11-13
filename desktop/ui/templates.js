"use strict";

// Templates page: edit the six z-unity-setup templates through the kit's templates.cjs. A template list on the
// left, a text editor on the right. Edits stay local until Save, which opens the plan sheet with a line diff.
(function () {
  const { el, invoke, errText } = zak;

  const T = {
    status: "idle", // idle | loading | ready | error
    error: null,
    dir: "",
    list: [],
    name: null, // selected template
    detail: null, // templates_get result for `name`
    draft: "", // editor text
    banner: null, // { kind, message, reload? }
    saving: false,
    seq: 0, // newest detail request wins
  };
  let ui = null;

  const dirty = () => !!T.detail && T.draft !== T.detail.content;
  const overridden = () => !!T.detail && !!T.detail.overridden;
  const live = () => !!ui && ui.root.isConnected;

  // ---- line diff (LCS; templates are small) ----
  const LCS_LIMIT = 4000000;

  function splitLines(text) {
    if (text === "") return [];
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  // Returns [{ kind: "same" | "add" | "del", text }].
  function diffLines(before, after) {
    const a = splitLines(before);
    const b = splitLines(after);
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const ma = a.slice(head, a.length - tail);
    const mb = b.slice(head, b.length - tail);
    const out = a.slice(0, head).map((text) => ({ kind: "same", text }));
    if (ma.length * mb.length > LCS_LIMIT) {
      out.push(...ma.map((text) => ({ kind: "del", text })), ...mb.map((text) => ({ kind: "add", text })));
    } else {
      const w = mb.length + 1;
      const t = new Uint32Array((ma.length + 1) * w);
      for (let i = ma.length - 1; i >= 0; i--) {
        for (let j = mb.length - 1; j >= 0; j--) {
          t[i * w + j] = ma[i] === mb[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < ma.length && j < mb.length) {
        if (ma[i] === mb[j]) {
          out.push({ kind: "same", text: ma[i] });
          i++;
          j++;
        } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) {
          out.push({ kind: "del", text: ma[i++] });
        } else {
          out.push({ kind: "add", text: mb[j++] });
        }
      }
      while (i < ma.length) out.push({ kind: "del", text: ma[i++] });
      while (j < mb.length) out.push({ kind: "add", text: mb[j++] });
    }
    out.push(...a.slice(a.length - tail).map((text) => ({ kind: "same", text })));
    return out;
  }

  const CONTEXT = 2;

  // A unified-style view: changed lines plus two lines of context, gaps collapsed.
  function diffNode(before, after) {
    const rows = diffLines(before, after);
    const show = rows.map((r) => r.kind !== "same");
    const keep = rows.map((_, i) => {
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) if (show[k]) return true;
      return false;
    });
    const box = el("pre", { class: "linediff mono", "aria-label": "Changes" });
    if (!show.some(Boolean)) return el("p", { class: "help", text: "No line changes." });
    let gap = false;
    rows.forEach((r, i) => {
      if (!keep[i]) {
        gap = true;
        return;
      }
      if (gap && box.childNodes.length) box.append(el("span", { class: "ld-line gap", text: "…" }));
      gap = false;
      const sign = r.kind === "add" ? "+" : r.kind === "del" ? "-" : " ";
      box.append(el("span", { class: "ld-line " + r.kind }, el("span", { class: "ld-sign", "aria-hidden": "true", text: sign }), el("span", { class: "ld-text", text: r.text })));
    });
    const added = rows.filter((r) => r.kind === "add").length;
    const removed = rows.filter((r) => r.kind === "del").length;
    return el("div", { class: "plan" }, el("p", { class: "count", text: `${zak.plural(added, "line")} added, ${zak.plural(removed, "line")} removed (before → after)` }), box);
  }

  // ---- loading ----
  function setupHint() {
    return "Install Node.js and make sure it is on your login-shell PATH. Install the kit's unity tier for Claude Code or Codex with “zak kit install --global --tier unity”, then try again.";
  }

  async function loadList() {
    const r = await invoke("templates_list");
    T.dir = String(r.dir || "");
    T.list = Array.isArray(r.templates) ? r.templates : [];
    if (!T.list.length) throw new Error("The kit reported no templates.");
  }

  async function loadDetail(name) {
    const seq = ++T.seq;
    const d = await invoke("templates_get", { name });
    if (seq !== T.seq) return false;
    T.name = name;
    T.detail = d;
    T.draft = String(d.content == null ? "" : d.content);
    return true;
  }

  // Reloads the list and the selected template, discarding the draft.
  async function load(keepBanner) {
    T.status = "loading";
    T.error = null;
    if (!keepBanner) T.banner = null;
    paintPage();
    try {
      await loadList();
      const name = T.list.some((t) => t.name === T.name) ? T.name : T.list[0].name;
      await loadDetail(name);
      T.status = "ready";
    } catch (e) {
      T.status = "error";
      T.error = errText(e);
    }
    if (live()) paintPage();
  }

  async function refreshAfterWrite(banner) {
    try {
      await loadList();
      await loadDetail(T.name);
      T.banner = banner;
    } catch (e) {
      T.banner = { kind: "error", message: errText(e) };
    }
    if (live()) paintPage();
  }

  // ---- switching ----
  function choose(name) {
    if (name === T.name) return;
    const go = async () => {
      T.banner = null;
      try {
        await loadDetail(name);
      } catch (e) {
        T.banner = { kind: "error", message: errText(e) };
      }
      if (live()) paintPage();
    };
    if (!dirty()) return void go();
    const ctl = zak.sheet({
      title: "Discard unsaved changes?",
      content: el("p", {}, `Your edits to ${currentLabel()} are not saved. Switching templates discards them.`),
      confirm: { label: "Discard Changes", danger: true },
      cancelLabel: "Keep Editing",
    });
    ctl.done.then((ok) => ok && go());
  }

  const meta = (name) => T.list.find((t) => t.name === name) || { name, label: name };
  const currentLabel = () => meta(T.name).label || T.name;

  // ---- save / reset sheets ----
  function pathOf() {
    return (T.detail && T.detail.path) || T.dir || "";
  }

  function conflict(c, name) {
    c.setStatus(`${name} changed on disk after you loaded it. Nothing was changed. Reloading shows the current file and discards your edits.`, "error");
    c.setConfirm({ label: "Reload and Discard Edits", danger: true, run: async () => void (await load(false)) });
    c.setCancelLabel("Keep Editing");
    return { stay: true };
  }

  function failure(c, r, fallback) {
    c.setStatus((r.body && (r.body.error || JSON.stringify(r.body))) || `${fallback} (status ${r.status}).`, "error");
    return { stay: true };
  }

  function openSave() {
    if (T.saving || !dirty()) return;
    const name = T.name;
    const d = T.detail;
    const content = T.draft;
    zak.sheet({
      title: `Save ${currentLabel()}?`,
      subtitle: pathOf(),
      subtitleMono: true,
      content: diffNode(d.content, content),
      confirm: { label: "Save Template" },
      onConfirm: async (c) => {
        T.saving = true;
        paintToolbar();
        try {
          const r = await invoke("templates_save", { name, content, baseHash: d.hash == null ? null : d.hash });
          if (r.status === 200) {
            const where = (r.body && r.body.path) || pathOf();
            await refreshAfterWrite({ kind: "ok", message: `Saved to ${where}.` });
            return undefined;
          }
          if (r.status === 409) return conflict(c, "The template");
          if (r.status === 422) {
            c.setStatus(((r.body && r.body.errors) || ["The template is not valid."]).map(String).join("\n"), "error");
            return { stay: true };
          }
          return failure(c, r, "Save failed");
        } finally {
          T.saving = false;
          paintToolbar();
        }
      },
    });
  }

  function openReset() {
    if (T.saving || !overridden()) return;
    const name = T.name;
    const d = T.detail;
    zak.sheet({
      title: `Reset ${currentLabel()} to default?`,
      subtitle: pathOf(),
      subtitleMono: true,
      content: el("div", {}, el("p", { class: "help", text: "This deletes your override. The kit uses its bundled template again." }), diffNode(d.content, String(d.default == null ? "" : d.default))),
      confirm: { label: "Reset to Default", danger: true },
      onConfirm: async (c) => {
        T.saving = true;
        paintToolbar();
        try {
          const r = await invoke("templates_reset", { name, baseHash: d.hash == null ? null : d.hash });
          if (r.status === 200) {
            await refreshAfterWrite({ kind: "ok", message: `${currentLabel()} is back to the default.` });
            return undefined;
          }
          if (r.status === 409) return conflict(c, "The template");
          return failure(c, r, "Reset failed");
        } finally {
          T.saving = false;
          paintToolbar();
        }
      },
    });
  }

  function revert() {
    if (!T.detail) return;
    T.draft = String(T.detail.content == null ? "" : T.detail.content);
    T.banner = null;
    paintPage();
  }

  // ---- painting ----
  function paintToolbar() {
    if (!live()) return;
    const ready = T.status === "ready";
    ui.reset.hidden = !(ready && overridden());
    ui.reset.disabled = T.saving;
    ui.revert.disabled = !ready || !dirty() || T.saving;
    ui.save.disabled = !ready || !dirty() || T.saving;
  }

  function paintList() {
    ui.list.replaceChildren();
    for (const t of T.list) {
      const selected = t.name === T.name;
      const head = el("span", { class: "tpl-name" }, el("span", { class: "tpl-label", text: t.label || t.name }));
      const edited = t.name === T.name && T.detail ? T.detail.overridden : t.overridden;
      if (edited) head.append(el("span", { class: "tpl-badge", text: "Edited" }));
      if (selected && dirty()) head.append(el("span", { class: "tpl-badge unsaved", text: "Unsaved" }));
      ui.list.append(
        el(
          "button",
          { class: "tpl-item", type: "button", "aria-current": selected ? "true" : null, on: { click: () => choose(t.name) } },
          head,
          t.description ? el("span", { class: "tpl-desc", text: t.description }) : null
        )
      );
    }
  }

  function paintEditor() {
    const d = T.detail;
    ui.path.textContent = d ? d.path || "" : "";
    ui.format.textContent = d ? `${d.format === "json" ? "JSON" : "Text"} · ${d.overridden ? "using your override" : "using the bundled default"}` : "";
    ui.banner.replaceChildren();
    if (T.banner) ui.banner.append(zak.banner(T.banner.kind, T.banner.message));
    if (ui.editor.value !== T.draft) ui.editor.value = T.draft;
    ui.editor.setAttribute("aria-label", `${currentLabel()} template`);
  }

  function paintPage() {
    if (!live()) return;
    const ready = T.status === "ready";
    ui.main.hidden = !ready;
    ui.listWrap.hidden = !ready;
    ui.state.hidden = ready;
    if (T.status === "loading" || T.status === "idle") {
      ui.state.replaceChildren(el("p", { class: "loading", text: "Loading templates…" }));
    } else if (T.status === "error") {
      ui.state.replaceChildren(
        el("h2", { text: "Templates is unavailable" }),
        el("p", { text: setupHint() }),
        el("p", { class: "muted mono block", text: T.error || "" }),
        el("button", { class: "btn", type: "button", text: "Try Again", on: { click: () => load(false) } })
      );
    }
    if (ready) {
      paintList();
      paintEditor();
    }
    paintToolbar();
  }

  function render(container) {
    container.replaceChildren();
    const revertBtn = el("button", { class: "btn", type: "button", text: "Revert", on: { click: revert } });
    const resetBtn = el("button", { class: "btn", type: "button", text: "Reset to Default…", hidden: true, on: { click: openReset } });
    const saveBtn = el("button", { class: "btn primary", type: "button", text: "Save…", on: { click: openSave } });
    const list = el("nav", { class: "tpl-list", "aria-label": "Templates" });
    const listWrap = el("div", { class: "tpl-list-wrap" }, list);
    const path = el("span", { class: "mono tpl-path" });
    const format = el("span", { class: "tpl-format" });
    const banner = el("div", { class: "banner-slot" });
    const editor = el("textarea", { class: "editor mono", spellcheck: "false", autocomplete: "off", autocapitalize: "off", wrap: "off" });
    editor.addEventListener("input", () => {
      T.draft = editor.value;
      T.banner = null;
      ui.banner.replaceChildren();
      paintToolbar();
      paintList();
    });
    const main = el("div", { class: "tpl-main" }, el("div", { class: "tpl-meta" }, path, format), banner, editor);
    const state = el("div", { class: "empty" });
    container.append(
      el(
        "div",
        { class: "toolbar", "data-tauri-drag-region": true },
        el("div", { class: "titles", "data-tauri-drag-region": true }, el("h1", { text: "Templates" })),
        el("div", { class: "actions" }, resetBtn, revertBtn, saveBtn)
      ),
      el("div", { class: "tpl-body" }, state, listWrap, main)
    );
    ui = { root: container, list, listWrap, path, format, banner, editor, main, state, reset: resetBtn, revert: revertBtn, save: saveBtn };
    if (T.status === "idle" || T.status === "error") load(false);
    else paintPage();
  }

  zak.pages.templates = { render };
})();
