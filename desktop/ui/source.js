"use strict";

// Kit Source page: show the current source and switch between public, private and a local folder.
(function () {
  const { el, invoke, errText } = zak;

  // `zak kit source` prints one of: "Kit source: local <path>", "Kit source: public remote",
  // "Kit source: private remote", "Kit source: automatic (private if authorized, else public)".
  const AUTOMATIC = "Automatic (private if authorized, else public)";
  function parse(text) {
    const line = String(text || "").split("\n").map((l) => l.trim()).find((l) => /^kit source:/i.test(l)) || String(text || "").trim();
    const v = line.replace(/^kit source:\s*/i, "");
    const local = v.match(/^local\s+(.+)$/i);
    if (local) return { choice: "local", path: local[1].trim(), label: "Local folder" };
    if (/^public\b/i.test(v)) return { choice: "public", path: "", label: "Public" };
    if (/^private\b/i.test(v)) return { choice: "private", path: "", label: "Private" };
    if (/^automatic\b/i.test(v)) return { choice: null, path: "", label: AUTOMATIC };
    return { choice: null, path: "", label: v || "Unknown" };
  }

  const LABELS = [["public", "Public"], ["private", "Private"], ["local", "Local folder"]];

  function render(container) {
    container.replaceChildren();
    const st = { current: null, choice: null, path: "", loading: true, error: null, message: null };
    const body = el("div", { class: "page-body" });
    container.append(el("div", { class: "toolbar", "data-tauri-drag-region": true }, el("div", { class: "titles", "data-tauri-drag-region": true }, el("h1", { text: "Kit Source" }))), body);
    const live = () => container.isConnected;

    async function load() {
      st.loading = true;
      st.error = null;
      paint();
      try {
        st.current = parse(String(await invoke("kit_source_get")));
        st.choice = st.current.choice;
        st.path = st.current.path;
      } catch (e) {
        st.error = errText(e);
      }
      st.loading = false;
      if (live()) paint();
    }

    function choiceString() {
      return st.choice === "local" ? `local:${st.path}` : st.choice;
    }

    function apply() {
      const choice = choiceString();
      const label = st.choice === "local" ? `the local folder ${st.path}` : `the ${st.choice} source`;
      const ctl = zak.sheet({
        title: "Change the kit source?",
        content: el("p", {}, `Future kit installs and updates will read from ${label}. Files already installed stay as they are until you update.`),
        confirm: { label: "Change Source" },
        onConfirm: async () => {
          await invoke("kit_source_set", { choice });
        },
      });
      ctl.done.then(async (ok) => {
        if (!ok || !live()) return;
        st.message = { kind: "ok", text: "Kit source changed." };
        await load();
      });
    }

    async function choose() {
      try {
        const p = await zak.pickFolder();
        if (p) {
          st.path = p;
          st.message = null;
          paint();
        }
      } catch (e) {
        st.message = { kind: "error", text: errText(e) };
        paint();
      }
    }

    function currentNode() {
      const c = st.current;
      if (!c) return el("span", { class: "form-value", text: "—" });
      const n = el("span", { class: "form-value" }, el("span", { text: c.label }));
      if (c.path) n.append(": ", el("span", { class: "mono", text: c.path }));
      return n;
    }

    function paint() {
      body.replaceChildren();
      if (st.loading) return body.append(el("p", { class: "loading", text: "Reading the kit source…" }));
      if (st.error) {
        return body.append(
          el("div", { class: "empty" }, el("h2", { text: "Could not read the kit source" }), el("p", { text: st.error }), el("button", { class: "btn", type: "button", text: "Try Again", on: { click: load } }))
        );
      }
      const seg = el("div", { class: "seg", role: "radiogroup", "aria-label": "Kit source" });
      for (const [v, label] of LABELS) {
        const b = el("button", { type: "button", role: "radio", "aria-checked": String(st.choice === v), text: label });
        b.addEventListener("click", () => {
          st.choice = v;
          st.message = null;
          paint();
          const again = body.querySelector('[role="radio"][aria-checked="true"]');
          if (again) again.focus();
        });
        seg.append(b);
      }
      const rows = [
        el("div", { class: "form-row" }, el("span", { class: "form-label", text: "Current source" }), currentNode()),
        el("div", { class: "form-row" }, el("span", { class: "form-label", text: "Change to" }), seg),
      ];
      if (st.choice === "local") {
        const path = el("input", { class: "field mono", type: "text", readOnly: true, value: "", placeholder: "No folder chosen", "aria-label": "Local kit folder" });
        path.value = st.path;
        rows.push(el("div", { class: "form-row" }, el("span", { class: "form-label", text: "Folder" }), el("div", { class: "inline grow" }, path, el("button", { class: "btn", type: "button", text: "Choose…", on: { click: choose } }))));
      }
      // Automatic has no matching button, so any explicit choice (even Private) is a change from it.
      const cur = st.current;
      const unchanged = !!cur && st.choice === cur.choice && (st.choice !== "local" || st.path === cur.path);
      const needsPath = st.choice === "local" && !st.path;
      const applyBtn = el("button", { class: "btn primary", type: "button", text: "Apply…", disabled: !st.choice || needsPath || unchanged, on: { click: apply } });
      body.append(
        el("div", { class: "group form" }, ...rows, el("div", { class: "group-foot end" }, applyBtn)),
        el("p", { class: "help", text: needsPath ? "Choose a folder to use a local source." : !st.choice ? "Pick a source to change to." : "Public and private read the published kit. If the CLI rejects a choice, for example Private without access, the sheet shows its message. A local folder lets you test changes before you publish." })
      );
      if (st.message) body.insertBefore(zak.banner(st.message.kind, st.message.text), body.lastChild);
    }

    load();
  }

  zak.pages.source = { render };
})();
