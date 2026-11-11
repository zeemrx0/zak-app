"use strict";

// Installing the zak CLI from inside the app: the empty state of the Install pages, the confirm sheet and the
// tool-status popover entry. The backend (`cli_install`) downloads and verifies the official install.sh.
(function () {
  const { el, invoke, errText } = zak;
  const REPO = "zeemrx0/zak-cli";
  const NODE_MIN = "26.11.1";
  let channel = "stable";

  // True once tool status has loaded and no zak was found.
  const missing = () => !!zak.state.tools && !zak.state.tools.zak.path;
  const nodeReady = () => !!zak.state.tools && zak.state.tools.node_ok === true;

  function nodeNote() {
    const t = zak.state.tools;
    const found = t && t.node.path && t.node.version ? ` Found ${String(t.node.version).replace(/^v/, "")}.` : "";
    return `Node ${NODE_MIN} or newer is required to install zak.${found} Install Node first, then reopen this page.`;
  }

  function resultLog(r) {
    const text = [r.stdout, r.stderr].map((s) => String(s || "").trim()).filter(Boolean).join("\n");
    return el("pre", { class: "install-log", tabindex: "0", "aria-label": "Installer output", text: text || "The installer printed no output." });
  }

  function open() {
    if (!nodeReady()) return;
    const segDefs = [["stable", "Stable"], ["beta", "Beta"]];
    const seg = el("div", { class: "seg", role: "radiogroup", "aria-label": "Release channel" });
    const source = el("span", { class: "mono" });
    const paintSource = () => (source.textContent = `https://github.com/${REPO}/releases (${channel})`);
    const segButtons = segDefs.map(([v, label]) =>
      el("button", {
        type: "button",
        role: "radio",
        "aria-checked": String(channel === v),
        text: label,
        on: {
          click: () => {
            channel = v;
            segButtons.forEach((b, i) => b.setAttribute("aria-checked", String(segDefs[i][0] === v)));
            paintSource();
          },
        },
      })
    );
    seg.append(...segButtons);
    paintSource();

    const intro = el(
      "div",
      { class: "install-info" },
      el("div", { class: "inline" }, el("span", { class: "pop-label", text: "Channel" }), seg),
      el(
        "ul",
        { class: "notes" },
        el("li", {}, "Downloads install.sh from the latest release at ", source, "."),
        el("li", { text: "Verifies its SHA-256 against the release digest before running it." }),
        el("li", { text: "Installs zak to ~/.local/bin/zak." }),
        el("li", { text: "Needs curl and tar." })
      )
    );

    async function run(ctl) {
      segButtons.forEach((b) => (b.disabled = true));
      let r;
      try {
        r = await invoke("cli_install", { channel });
      } catch (e) {
        segButtons.forEach((b) => (b.disabled = false));
        ctl.setConfirm({ label: "Retry", run });
        throw e;
      }
      if (r.exit_code !== 0) {
        ctl.setContent(resultLog(r));
        ctl.setStatus(`The installer failed with exit code ${r.exit_code}.`, "error");
        ctl.setConfirm({ label: "Retry", run: async (c) => (c.setContent(intro), segButtons.forEach((b) => (b.disabled = false)), run(c)) });
        return { stay: true };
      }
      ctl.setTitle("zak CLI installed");
      ctl.setSubtitle(r.version ? `zak ${String(r.version).replace(/^zak\s+/i, "")} · ~/.local/bin/zak` : "~/.local/bin/zak");
      ctl.setContent(resultLog(r));
      ctl.setStatus("");
      ctl.setConfirm({ label: "Done" });
      ctl.setCancelLabel("Close");
      await zak.refreshTools();
      await zak.refreshInstalls();
      return { stay: true };
    }

    zak.sheet({
      title: "Install zak CLI",
      subtitle: `From ${REPO}`,
      content: intro,
      confirm: { label: "Install zak CLI", run },
    });
  }

  // The Install pages show this instead of the host table while zak is missing.
  function emptyState() {
    const ready = nodeReady();
    return el(
      "div",
      { class: "empty" },
      el("h2", { text: "The zak CLI is not installed" }),
      el("p", { class: ready ? "help" : "help bad", text: ready ? "The app needs zak to read and change kit installs. It can install zak for you." : nodeNote() }),
      el("button", { class: "btn primary", type: "button", text: "Install zak CLI…", disabled: !ready, on: { click: open } })
    );
  }

  zak.cliInstall = { missing, nodeReady, nodeNote, nodeMin: NODE_MIN, open, emptyState };
})();
