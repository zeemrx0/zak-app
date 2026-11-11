"use strict";

// Install pages: This Mac and each project. Reads lock-driven state, checks drift, and runs
// install/update/uninstall through the plan sheet (dry run first, commit second).
(function () {
  const { el, icon, invoke, errText, firstLine, plural } = zak;

  const HOSTS = [
    { id: "claude", label: "Claude Code" },
    { id: "codex", label: "Codex" },
  ];
  const TIER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
  const VERBS = { install: ["Install", "Installing"], update: ["Update", "Updating"], uninstall: ["Uninstall", "Removing"] };

  const stores = new Map(); // location key -> { sel, base, extra, states, busy, notes, results }
  const checkedOnce = new Set();
  let channel = null; // null (default) | "stable" | "beta"
  let view = null; // refs of the page currently on screen

  const HELP_GLOBAL = "Each host starts with the tiers recorded in its lock file. For This Mac the ticked tiers are the exact list: unticking an installed tier removes its files on the next Update.";
  const HELP_PROJECT = "Each host starts with the tiers recorded in its lock file. For a project, ticked tiers are added on top of general and the tiers the kit detects. Unticking a tier that is installed sends it as an exclusion, so the next Update removes it.";

  const keyOf = (loc) => (loc.path == null ? "global" : "project:" + loc.path);
  const nameOf = (loc) => (loc.path == null ? "This Mac" : zak.baseName(loc.path));

  function findLoc(key) {
    const I = zak.state.installs;
    if (!I) return null;
    return key === "global" ? I.global : I.projects.find((p) => p.path === key.slice(8)) || null;
  }

  function getStore(loc) {
    const key = keyOf(loc);
    let s = stores.get(key);
    if (!s) {
      s = { sel: null, extra: new Set(), states: { claude: { kind: "idle" }, codex: { kind: "idle" } }, busy: false, notes: [], results: [] };
      stores.set(key, s);
    }
    if (!s.sel) {
      // Defaults come from the lock files, never from a hard-coded tier. A host with no lock copies the other.
      const a = loc.hosts.claude ? loc.hosts.claude.tiers : null;
      const b = loc.hosts.codex ? loc.hosts.codex.tiers : null;
      s.sel = { claude: new Set(a || b || ["general"]), codex: new Set(b || a || ["general"]) };
      s.base = { claude: new Set(s.sel.claude), codex: new Set(s.sel.codex) };
    }
    return s;
  }

  // What the boxes changed against the baseline (the lock, or the other host's tiers when there is no lock).
  function tierDelta(store, h) {
    const base = store.base[h];
    const sel = store.sel[h];
    return { removed: [...base].filter((t) => !sel.has(t)).sort(), added: [...sel].filter((t) => !base.has(t)).sort() };
  }
  const hasDelta = (d) => d.removed.length > 0 || d.added.length > 0;

  function tierRows(loc, store) {
    const all = new Set(["general", ...store.extra]);
    for (const h of HOSTS) {
      if (loc.hosts[h.id]) loc.hosts[h.id].tiers.forEach((t) => all.add(t));
      store.sel[h.id].forEach((t) => all.add(t));
    }
    return [...all].sort((x, y) => x.localeCompare(y));
  }

  // ---- reading kit_run results ----
  const hasItems = (x) => (Array.isArray(x) ? x.length > 0 : !!x && typeof x === "object" ? Object.keys(x).length > 0 : !!x);
  const isChange = (op) => !/^(unchanged|skip|skipped|keep|noop|none)$/i.test(String(op.action || ""));
  function describeItem(x) {
    if (typeof x === "string") return x;
    if (x && typeof x === "object") {
      if (x.message) return String(x.message);
      if (x.rel) return [x.rel, x.reason || x.kind].filter(Boolean).join(": ");
    }
    return JSON.stringify(x);
  }
  const itemsOf = (x) => (Array.isArray(x) ? x : hasItems(x) ? [x] : []).map(describeItem);

  function normAction(a) {
    const s = String(a || "").toLowerCase();
    if (/^(remove|delete|uninstall)/.test(s)) return "Remove";
    if (/^(add|create|install|new)/.test(s)) return "Add";
    if (/^(update|replace|modify|overwrite)/.test(s)) return "Update";
    return s ? s[0].toUpperCase() + s.slice(1) : "Other";
  }

  function interpretCheck(res) {
    const rep = res.reports && res.reports[0];
    if (!rep) return { kind: "failed", detail: firstLine(res.stderr) || firstLine(res.stdout) || `Exit code ${res.exit_code}` };
    const problems = [...itemsOf(rep.conflicts), ...itemsOf(rep.issues)];
    if (problems.length) return { kind: "failed", detail: problems[0] };
    const n = (rep.operations || []).filter(isChange).length;
    if (rep.inSync === true) return { kind: "insync" };
    if (n > 0) return { kind: "changes", count: n };
    // Drift with no file operations: the lock itself changes (new kit version, legacy lock).
    if (rep.lockChange === true || rep.inSync === false) return { kind: "lockonly" };
    if (res.exit_code !== 0) return { kind: "failed", detail: firstLine(res.stderr) || `Exit code ${res.exit_code}` };
    return { kind: "insync" };
  }

  function request(loc, host, tiers, noTiers, action, dry) {
    return {
      action,
      targets: [host],
      tiers,
      no_tiers: noTiers,
      scope: loc.path == null ? { kind: "global" } : { kind: "project", path: loc.path },
      dry_run: dry,
      channel: action === "install" || action === "update" ? channel : null,
    };
  }
  const runKit = (loc, target, action, dry) => invoke("kit_run", { request: request(loc, target.host.id, target.tiers, target.noTiers, action, dry) });

  // Each host gets its own call because hosts can carry different tiers. A project install adds the ticked tiers
  // on top of general and the detected ones, so a baseline tier that was unticked goes out as an exclusion.
  // A global install takes the exact list and needs no exclusions.
  function targetsFor(action, loc, store) {
    const hosts = [];
    const skipped = [];
    for (const h of HOSTS) {
      const installed = !!loc.hosts[h.id];
      const tiers = [...store.sel[h.id]].sort();
      const delta = tierDelta(store, h.id);
      const noTiers = loc.path != null && action !== "uninstall" ? delta.removed : [];
      if (action !== "install" && !installed) {
        if (action !== "check") skipped.push(`${h.label} skipped: not installed.`);
        continue;
      }
      if ((loc.path == null || action === "install") && tiers.length === 0) {
        skipped.push(`${h.label} skipped: no tiers selected.`);
        continue;
      }
      hosts.push({ host: h, tiers, noTiers, delta });
    }
    return { hosts, skipped };
  }

  // ---- painting ----
  const live = (key) => view && view.key === key && view.root.isConnected;

  function stateView(loc, store, h) {
    if (!loc.hosts[h]) return { text: "Not installed", dot: "off" };
    const s = store.states[h];
    if (s.kind !== "checking" && s.kind !== "failed" && hasDelta(tierDelta(store, h))) return { text: "Tiers changed", dot: "amber", title: "The ticked tiers differ from the lock file." };
    switch (s.kind) {
      case "checking":
        return { text: "Checking…", dot: "busy" };
      case "insync":
        return { text: "In sync", dot: "green" };
      case "changes":
        return { text: plural(s.count, "change"), dot: "amber" };
      case "lockonly":
        return { text: "Lock update", dot: "amber", title: "No files change, but the lock file needs an update." };
      case "failed":
        return { text: "Check failed", dot: "red", title: s.detail };
      default:
        return { text: "Not checked", dot: "off" };
    }
  }

  // Sidebar dot for a location: the worst known state across its installed hosts, or null before any check.
  function locationDot(key) {
    const loc = findLoc(key);
    if (!loc || !checkedOnce.has(key)) return null;
    const store = getStore(loc);
    const dots = HOSTS.filter((h) => loc.hosts[h.id]).map((h) => stateView(loc, store, h.id));
    if (!dots.length || dots.some((d) => d.dot === "busy" || d.dot === "off")) return null;
    const worst = dots.find((d) => d.dot === "red") || dots.find((d) => d.dot === "amber") || dots[0];
    return { dot: worst.dot, text: worst.text };
  }

  function paint(key) {
    if (zak.updateDots) zak.updateDots();
    if (!live(key)) return;
    const loc = findLoc(key);
    const store = getStore(loc);
    for (const h of HOSTS) {
      const r = view.rows[h.id];
      const sv = stateView(loc, store, h.id);
      r.dot.className = "dot " + sv.dot;
      r.text.textContent = sv.text;
      r.cell.title = sv.title || "";
      r.cell.classList.toggle("bad", sv.dot === "red");
    }
    view.checkBtn.disabled = store.busy;
    view.updateBtn.disabled = store.busy;
    view.moreBtn.disabled = store.busy;
    view.checkBtn.textContent = store.busy ? "Working…" : "Check";
    view.notes.replaceChildren(...store.notes.map((n) => el("li", { text: n })));
    view.notes.hidden = store.notes.length === 0;
    view.results.replaceChildren(...store.results.map((r) => zak.banner(r.kind, r.text)));
  }

  async function runCheck(key) {
    const loc = findLoc(key);
    if (!loc) return;
    const store = getStore(loc);
    if (store.busy) return;
    store.busy = true;
    checkedOnce.add(key);
    const { hosts, skipped } = targetsFor("check", loc, store);
    store.notes = skipped;
    for (const h of HOSTS) store.states[h.id] = { kind: loc.hosts[h.id] && hosts.some((t) => t.host.id === h.id) ? "checking" : "idle" };
    paint(key);
    for (const t of hosts) {
      try {
        const res = await runKit(loc, t, "check", false);
        store.states[t.host.id] = interpretCheck(res);
      } catch (e) {
        store.states[t.host.id] = { kind: "failed", detail: errText(e) };
      }
      const s = store.states[t.host.id];
      if (s.kind === "failed") store.notes = [...store.notes, `${t.host.label} check failed: ${s.detail}`];
      paint(key);
    }
    store.busy = false;
    paint(key);
  }

  // ---- plan sheet ----
  const opKey = (op) => `${normAction(op.action)}:${op.rel}`;
  const stripRoot = (rel, root) => (root && String(rel).startsWith(root + "/") ? String(rel).slice(root.length + 1) : String(rel));

  // Two path segments of the folder, without the host directory: skills/<name>/.
  function folderKey(rel) {
    const parts = rel.split("/").filter(Boolean);
    if (parts[0] === ".claude" || parts[0] === ".codex") parts.shift();
    const dirs = parts.slice(0, -1).slice(0, 2);
    return dirs.length ? dirs.join("/") + "/" : "(root)";
  }

  function groupNode(label, rels, cls, openAll) {
    const g = el("div", { class: "plan-group" + (cls ? " " + cls : "") });
    g.append(el("div", { class: "plan-action" }, el("span", { text: label }), el("span", { class: "count", text: plural(rels.length, "file") })));
    const folders = new Map();
    for (const rel of rels) {
      const key = folderKey(rel);
      if (!folders.has(key)) folders.set(key, []);
      folders.get(key).push(rel);
    }
    for (const [folder, files] of [...folders.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
      const d = el("details", { class: "plan-folder" });
      d.open = openAll || files.length <= 6;
      d.append(
        el("summary", {}, el("span", { class: "mono", text: folder }), el("span", { class: "count", text: String(files.length) })),
        el("ul", { class: "files mono" }, ...files.sort().map((f) => el("li", { text: f })))
      );
      g.append(d);
    }
    return g;
  }

  function deltaNode(delta) {
    const p = el("p", { class: "plan-tiers" }, el("span", { class: "muted", text: "Tiers: " }));
    const items = [...delta.removed.map((t) => ({ t, removed: true })), ...delta.added.map((t) => ({ t, removed: false }))];
    items.forEach((it, i) => {
      if (i) p.append(", ");
      p.append(el("span", { class: it.removed ? "bad" : "", text: (it.removed ? "−" : "+") + it.t }));
    });
    return p;
  }

  const OUTCOME_LABELS = { done: ["Done", "ok"], failed: ["Failed", "bad"], skipped: ["Not run", ""] };

  function planNode(plans, skipped, outcomes) {
    const root = el("div", { class: "plan" });
    for (const s of skipped) root.append(el("p", { class: "plan-note", text: s }));
    for (const p of plans) {
      const section = el("section", { class: "plan-host" });
      const head = el("div", { class: "plan-host-head" }, el("h3", { text: p.host.label }));
      section.append(head);
      const outcome = outcomes[p.host.id];
      if (outcome) {
        const [text, cls] = OUTCOME_LABELS[outcome.kind];
        head.append(el("span", { class: "count " + cls, text }));
      }
      if (hasDelta(p.delta)) section.append(deltaNode(p.delta));
      if (outcome && outcome.detail) section.append(el("p", { class: "plan-error", text: outcome.detail }));
      if (p.error) {
        if (!outcome) head.append(el("span", { class: "count bad", text: "Failed" }));
        section.append(el("p", { class: "plan-error", text: p.error }));
        root.append(section);
        continue;
      }
      const problems = planProblems(p);
      if (!outcome) head.append(el("span", { class: "count", text: p.ops.length ? plural(p.ops.length, "file") : p.lockOnly ? "Lock update" : p.kept.length ? "Nothing to remove" : "No changes" }));
      if (problems.length) section.append(el("ul", { class: "plan-problems" }, ...problems.map((m) => el("li", { text: m }))));
      const groups = new Map();
      for (const op of p.ops) {
        const a = normAction(op.action);
        if (!groups.has(a)) groups.set(a, []);
        groups.get(a).push(stripRoot(op.rel, p.root));
      }
      const order = (a) => ["Remove", "Add", "Update"].indexOf(a) + 1 || 9;
      const sorted = [...groups.entries()].sort((x, y) => order(x[0]) - order(y[0]) || x[0].localeCompare(y[0]));
      for (const [action, rels] of sorted) section.append(groupNode(action, rels, action === "Remove" ? "remove" : "", action === "Remove"));
      if (p.kept.length) {
        section.append(groupNode("Kept (edited)", p.kept.map((r) => stripRoot(r, p.root)), "keep", false));
        section.append(el("p", { class: "plan-note", text: "Edited files stay in place. Only unedited kit files are removed." }));
      }
      root.append(section);
    }
    return root;
  }

  function planProblems(p) {
    const out = [];
    const res = p.res;
    if (res.exit_code !== 0) out.push(`The dry run exited with code ${res.exit_code}. ${firstLine(res.stderr) || firstLine(res.stdout)}`.trim());
    else if (!res.reports || !res.reports[0]) out.push("The dry run returned no report.");
    for (const m of p.problems) out.push(m);
    return out;
  }

  // Reads each host's dry-run report. Uninstall keeps edited files as conflicts: they are shown as kept, not
  // as blockers. Every other conflict or issue blocks the commit.
  function summarize(plans, action, loc) {
    let total = 0;
    let removes = 0;
    let kept = 0;
    let lockOnly = 0;
    let blocked = false;
    for (const p of plans) {
      if (p.error) {
        blocked = true;
        continue;
      }
      const rep = p.res.reports && p.res.reports[0];
      const lock = loc.hosts[p.host.id];
      p.root = rep && rep.destination ? String(rep.destination) : lock ? String(lock.lock_path).replace(/\/[^/]*$/, "") : "";
      p.ops = rep ? (rep.operations || []).filter(isChange) : [];
      const conflicts = rep ? itemsOf(rep.conflicts) : [];
      const issues = rep ? itemsOf(rep.issues).map((m) => "Issue: " + m) : [];
      p.kept = action === "uninstall" ? (rep ? (rep.conflicts || []).map((c) => String(c.rel || describeItem(c))) : []) : [];
      p.problems = action === "uninstall" ? issues : [...conflicts.map((m) => "Conflict: " + m), ...issues];
      p.lockOnly = !!rep && rep.lockChange === true && p.ops.length === 0;
      if (p.res.exit_code !== 0 || !rep || p.problems.length) blocked = true;
      total += p.ops.length;
      removes += p.ops.filter((o) => normAction(o.action) === "Remove").length;
      kept += p.kept.length;
      if (p.lockOnly) lockOnly++;
    }
    let confirm;
    if (blocked) confirm = { label: "Cannot continue", disabled: true };
    else if (total === 0 && lockOnly > 0) confirm = { label: action === "uninstall" ? "Remove lock file" : "Update lock file" };
    else if (total === 0) confirm = { label: "Nothing to change", disabled: true };
    else if (action === "uninstall" || removes === total) confirm = { label: `Remove ${plural(total, "file")}`, danger: true };
    else if (removes > 0) confirm = { label: `${VERBS[action][0]} ${plural(total - removes, "file")}, remove ${removes}`, danger: true };
    else confirm = { label: `${VERBS[action][0]} ${plural(total, "file")}` };
    return { total, removes, kept, blocked, confirm };
  }

  // Judges one real (non-dry) run. Uninstall exit 2 with only kept files is a finished removal.
  function judgeRun(res, action) {
    const rep = res.reports && res.reports[0];
    const issues = rep ? itemsOf(rep.issues) : [];
    const conflicts = rep ? itemsOf(rep.conflicts) : [];
    if (action === "uninstall" && res.exit_code === 2 && rep && issues.length === 0 && conflicts.length > 0) return { ok: true, kept: conflicts.length, rep };
    if (res.exit_code !== 0 || issues.length || conflicts.length) {
      return { ok: false, detail: issues[0] || conflicts[0] || firstLine(res.stderr) || firstLine(res.stdout) || "exit code " + res.exit_code };
    }
    return { ok: true, kept: 0, rep };
  }

  // Files whose action differs between the plan and what the real run did (a release may have changed between).
  function driftCount(plan, rep) {
    const planned = new Set(plan.ops.map(opKey));
    const applied = new Set(((rep && rep.operations) || []).filter(isChange).map(opKey));
    let n = 0;
    for (const k of planned) if (!applied.has(k)) n++;
    for (const k of applied) if (!planned.has(k)) n++;
    return n;
  }

  async function openPlan(action, key) {
    const loc = findLoc(key);
    if (!loc) return;
    const store = getStore(loc);
    if (store.busy) return;
    const { hosts, skipped } = targetsFor(action, loc, store);
    store.busy = true;
    store.results = [];
    paint(key);
    let touched = false;
    let plans = [];
    let outcomes = {};

    async function planAll() {
      plans = [];
      outcomes = {};
      ctl.setContent(el("p", { class: "loading", text: hosts.length ? "Planning changes…" : "Nothing to plan." }));
      ctl.setConfirm({ label: "Planning…", disabled: true });
      ctl.setStatus("");
      for (const t of hosts) {
        try {
          plans.push({ ...t, res: await runKit(loc, t, action, true) });
        } catch (e) {
          plans.push({ ...t, error: errText(e) });
        }
      }
      const sum = summarize(plans, action, loc);
      ctl.setContent(planNode(plans, skipped, outcomes));
      ctl.setConfirm(sum.confirm);
      if (sum.blocked) ctl.setStatus("Fix the problems listed above, then plan again. Nothing was changed.", "error");
      else if (sum.removes > 0 || sum.kept > 0) {
        const parts = [];
        if (sum.removes > 0) parts.push(`${plural(sum.removes, "file")} will be removed.`);
        if (sum.kept > 0) parts.push(`${plural(sum.kept, "edited file")} will be kept.`);
        ctl.setStatus(parts.join(" "), sum.removes > 0 ? "danger" : "warn");
      }
    }

    async function commit(c) {
      const runnable = plans.filter((p) => !p.error);
      outcomes = {};
      for (const p of runnable) outcomes[p.host.id] = { kind: "skipped" };
      let failure = null;
      for (let i = 0; i < runnable.length && !failure; i++) {
        const p = runnable[i];
        c.setStatus(`${VERBS[action][1]} ${p.host.label} (${i + 1} of ${runnable.length})…`);
        touched = true;
        try {
          const j = judgeRun(await runKit(loc, p, action, false), action);
          if (!j.ok) throw new Error(j.detail);
          outcomes[p.host.id] = { kind: "done" };
          if (j.kept > 0) store.results.push({ kind: "warn", text: `${p.host.label}: finished with ${plural(j.kept, "edited file")} kept. Remove them by hand if you want them gone.` });
          const drift = driftCount(p, j.rep);
          if (drift > 0) {
            store.results.push({ kind: "warn", text: `${p.host.label}: the applied changes differ from the plan in ${plural(drift, "file")}. The kit release may have changed after the preview. The page is checking again.` });
          }
        } catch (e) {
          failure = `${p.host.label}: ${errText(e).replace(/^Error: /, "")}`;
          outcomes[p.host.id] = { kind: "failed" };
        }
      }
      if (!failure) return undefined;
      // Some hosts may already have changed, so the plan on screen is stale. Only a new dry run can continue.
      c.setContent(planNode(plans, skipped, outcomes));
      c.setStatus(failure, "error");
      c.setConfirm({ label: "Plan Again", run: async () => (await planAll(), { stay: true }) });
      c.setCancelLabel("Close");
      return { stay: true };
    }

    const ctl = zak.sheet({
      title: `${VERBS[action][0]} kit on ${nameOf(loc)}`,
      subtitle: loc.path || "Global install",
      subtitleMono: loc.path != null,
      content: el("p", { class: "loading", text: "Planning changes…" }),
      confirm: { label: "Planning…", disabled: true },
      onConfirm: commit,
    });
    await planAll();

    await ctl.done;
    store.busy = false;
    if (touched) {
      await zak.refreshInstalls();
      runCheck(key);
    } else {
      paint(key);
    }
  }

  // ---- page ----
  function lockDirs(loc) {
    const dirs = HOSTS.map((h) => loc.hosts[h.id]).filter(Boolean).map((l) => String(l.lock_path).replace(/\/[^/]*$/, ""));
    if (dirs.length) return [...new Set(dirs)].join(" · ");
    return loc.path == null ? "~/.claude · ~/.codex" : loc.path;
  }

  function hostTable(loc, store, rows) {
    const body = el("tbody");
    for (const h of HOSTS) {
      const lock = loc.hosts[h.id];
      const dot = el("span", { class: "dot off" });
      const text = el("span");
      const cell = el("td", { class: "state" }, dot, text);
      rows[h.id] = { dot, text, cell };
      body.append(
        el(
          "tr",
          {},
          el("th", { scope: "row", class: "host", text: h.label }),
          el("td", { class: "num" + (lock ? "" : " muted"), text: lock ? String(lock.kit_version) : "—" }),
          el("td", { class: lock ? "" : "muted", text: lock ? (lock.tiers.length ? lock.tiers.join(", ") : "No tiers") : "—" }),
          cell
        )
      );
    }
    return el(
      "div",
      { class: "group" },
      el(
        "table",
        { class: "table" },
        el("thead", {}, el("tr", {}, ...["Host", "Version", "Tiers", "State"].map((t) => el("th", { scope: "col", text: t })))),
        body
      )
    );
  }

  function tierMatrix(loc, store, key) {
    const body = el("tbody");
    const input = el("input", { class: "field", type: "text", placeholder: "Add tier…", "aria-label": "New tier name", autocomplete: "off", spellcheck: "false" });
    const err = el("p", { class: "field-error", role: "alert", hidden: true });
    function rebuild() {
      body.replaceChildren();
      for (const tier of tierRows(loc, store)) {
        const tr = el("tr", {}, el("th", { scope: "row", text: tier }));
        for (const h of HOSTS) {
          const cb = el("input", { type: "checkbox", "aria-label": `${tier} for ${h.label}`, checked: store.sel[h.id].has(tier) });
          cb.addEventListener("change", () => {
            if (cb.checked) store.sel[h.id].add(tier);
            else store.sel[h.id].delete(tier);
            paint(key);
          });
          tr.append(el("td", { class: "check" }, cb));
        }
        body.append(tr);
      }
    }
    function add() {
      const v = input.value.trim();
      if (!v) return;
      if (!TIER_RE.test(v)) {
        err.textContent = "Use letters, numbers, - or _. Start with a letter or number.";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      store.extra.add(v);
      HOSTS.forEach((h) => store.sel[h.id].add(v));
      input.value = "";
      rebuild();
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        add();
      }
    });
    rebuild();
    return el(
      "div",
      {},
      el(
        "div",
        { class: "group" },
        el(
          "table",
          { class: "table" },
          el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Tier" }), ...HOSTS.map((h) => el("th", { scope: "col", class: "check", text: h.label })))),
          body
        ),
        el("div", { class: "group-foot" }, input, el("button", { class: "btn", type: "button", text: "Add", on: { click: add } }))
      ),
      err
    );
  }

  function render(container, key) {
    container.replaceChildren();
    const I = zak.state.installs;
    if (!I) {
      const retry = el("button", { class: "btn", type: "button", text: "Try Again", on: { click: () => zak.refreshInstalls() } });
      container.append(
        el("div", { class: "toolbar", "data-tauri-drag-region": true }, el("div", { class: "titles" }, el("h1", { text: "This Mac" }))),
        zak.state.installsError
          ? el("div", { class: "empty" }, el("h2", { text: "Could not read installs" }), el("p", { text: zak.state.installsError }), retry)
          : el("div", { class: "empty" }, el("p", { class: "loading", text: "Reading lock files…" }))
      );
      view = null;
      return;
    }
    const loc = findLoc(key);
    if (!loc) {
      container.append(el("div", { class: "empty" }, el("h2", { text: "Project not found" }), el("p", { text: "It is no longer in the project list." })));
      view = null;
      return;
    }
    if (zak.cliInstall.missing()) {
      container.append(
        el("div", { class: "toolbar", "data-tauri-drag-region": true }, el("div", { class: "titles", "data-tauri-drag-region": true }, el("h1", { text: nameOf(loc) }))),
        zak.cliInstall.emptyState()
      );
      view = null;
      return;
    }
    const store = getStore(loc);
    const rows = {};

    const checkBtn = el("button", { class: "btn", type: "button", text: "Check", on: { click: () => runCheck(key) } });
    const updateBtn = el("button", { class: "btn primary", type: "button", text: "Update…", on: { click: () => openPlan("update", key) } });
    const moreBtn = el("button", { class: "btn", type: "button" }, el("span", { text: "More" }), icon("chevron"));
    zak.attachMenu(moreBtn, () => [
      { label: "Install…", onSelect: () => openPlan("install", key) },
      { label: "Uninstall…", onSelect: () => openPlan("uninstall", key), danger: true },
      { separator: true },
      { label: "Default channel", checked: channel === null, onSelect: () => (channel = null) },
      { label: "Stable channel", checked: channel === "stable", onSelect: () => (channel = "stable") },
      { label: "Beta channel", checked: channel === "beta", onSelect: () => (channel = "beta") },
      ...(loc.path != null ? [{ separator: true }, { label: "Remove from List…", onSelect: () => removeProject(loc) }] : []),
    ]);

    const toolbar = el(
      "div",
      { class: "toolbar", "data-tauri-drag-region": true },
      el("div", { class: "titles", "data-tauri-drag-region": true }, el("h1", { text: nameOf(loc) }), el("p", { class: "sub mono", text: lockDirs(loc), title: loc.path || "" })),
      el("div", { class: "actions" }, checkBtn, el("div", { class: "menu-wrap" }, moreBtn), updateBtn)
    );

    const notes = el("ul", { class: "notes", "aria-live": "polite", hidden: true });
    const results = el("div", { class: "results", "aria-live": "polite" });
    const bodyEl = el("div", { class: "page-body" });
    if (loc.error) bodyEl.append(zak.banner("error", `Could not read a lock file: ${loc.error}`));
    bodyEl.append(
      results,
      hostTable(loc, store, rows),
      notes,
      el("h2", { class: "section-title", text: "Tiers" }),
      el("p", { class: "help", text: loc.path == null ? HELP_GLOBAL : HELP_PROJECT }),
      tierMatrix(loc, store, key)
    );
    container.append(toolbar, bodyEl);

    view = { key, root: container, rows, checkBtn, updateBtn, moreBtn, notes, results };
    paint(key);
    if (!checkedOnce.has(key)) runCheck(key);
  }

  function removeProject(loc) {
    const key = keyOf(loc);
    const ctl = zak.sheet({
      title: `Remove “${nameOf(loc)}” from the list?`,
      subtitle: loc.path,
      content: el("p", { text: "This only forgets the project in this app. Kit files in the project stay where they are." }),
      confirm: { label: "Remove from List", danger: true },
      onConfirm: () => invoke("project_remove", { path: loc.path }),
    });
    ctl.done.then(async (ok) => {
      if (!ok) return;
      stores.delete(key);
      checkedOnce.delete(key);
      await zak.refreshInstalls();
      zak.select("global");
    });
  }

  zak.pages.installs = {
    render,
    locationDot,
    // Defaults follow the lock files again after every refresh.
    onRefresh() {
      for (const s of stores.values()) s.sel = null;
    },
  };
})();
