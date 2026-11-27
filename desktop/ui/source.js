"use strict";

// Kit Source page: show the current local kit folder and let the user set another one.
(function () {
  const { el, invoke, errText } = zak;

  // `zak kit source` prints "Kit source: <path>" or "Kit source: not set".
  function parse(text) {
    const line = String(text || "").split("\n").map((l) => l.trim()).find((l) => /^kit source:/i.test(l)) || String(text || "").trim();
    const v = line.replace(/^kit source:\s*/i, "");
    return !v || /^not set$/i.test(v) ? "" : v;
  }

  function render(container) {
    container.replaceChildren();
    const st = { current: null, path: "", loading: true, error: null, message: null };
    const body = el("div", { class: "page-body" });
    container.append(el("div", { class: "toolbar", "data-tauri-drag-region": true }, el("div", { class: "titles", "data-tauri-drag-region": true }, el("h1", { text: "Kit Source" }))), body);
    const live = () => container.isConnected;

    async function load() {
      st.loading = true;
      st.error = null;
      paint();
      try {
        st.current = parse(String(await invoke("kit_source_get")));
        st.path = st.current;
      } catch (e) {
        st.error = errText(e);
      }
      st.loading = false;
      if (live()) paint();
    }

    function apply() {
      const path = st.path;
      const ctl = zak.sheet({
        title: "Change the kit source?",
        content: el("p", {}, `Future kit installs and updates will read from the local folder ${path}. Files already installed stay as they are until you update.`),
        confirm: { label: "Change Source" },
        onConfirm: async () => {
          await invoke("kit_source_set", { path });
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

    function paint() {
      body.replaceChildren();
      if (st.loading) return body.append(el("p", { class: "loading", text: "Reading the kit source…" }));
      if (st.error) {
        return body.append(
          el("div", { class: "empty" }, el("h2", { text: "Could not read the kit source" }), el("p", { text: st.error }), el("button", { class: "btn", type: "button", text: "Try Again", on: { click: load } }))
        );
      }
      const current = st.current ? el("span", { class: "form-value mono", text: st.current }) : el("span", { class: "form-value", text: "Not set" });
      const path = el("input", { class: "field mono", type: "text", readOnly: true, value: "", placeholder: "No folder chosen", "aria-label": "Local kit folder" });
      path.value = st.path;
      const unchanged = st.path === st.current;
      const applyBtn = el("button", { class: "btn primary", type: "button", text: "Apply…", disabled: !st.path || unchanged, on: { click: apply } });
      body.append(
        el(
          "div",
          { class: "group form" },
          el("div", { class: "form-row" }, el("span", { class: "form-label", text: "Current source" }), current),
          el("div", { class: "form-row" }, el("span", { class: "form-label", text: "Folder" }), el("div", { class: "inline grow" }, path, el("button", { class: "btn", type: "button", text: "Choose…", on: { click: choose } }))),
          el("div", { class: "group-foot end" }, applyBtn)
        ),
        el("p", { class: "help", text: st.path ? "The folder must be a z-agent-kit checkout. If the CLI rejects it, the sheet shows its message." : "Choose the folder where you cloned z-agent-kit." })
      );
      if (st.message) body.insertBefore(zak.banner(st.message.kind, st.message.text), body.lastChild);
    }

    load();
  }

  zak.pages.source = { render };
})();
