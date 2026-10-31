(function () {
  "use strict";

  // ---------- data loaded on demand from data/ (built by build.py) ----------

  const IV = window.IVERIA = {
    _issues: {}, _catalog: {}, _shards: {}, _docs: null, _years: null,
    issue(d) { this._issues[d.id] = d; },
    catalog(y, list) { this._catalog[y] = list; },
    shard(k, map) { this._shards[k] = map; },
    docs(list) { this._docs = list; },
    years(o) { this._years = o; }
  };

  const CONFIG = window.IVERIA_CONFIG || { default: {}, years: {} };
  const MIN_WORD = 3;   // must match build.py
  const SHARD_LEN = 3;  // must match build.py
  const PAGE_SIZE = 20;
  const DRAFTS_KEY = "iveria.drafts.v1";
  const MONTHS_NOM = ["იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი",
    "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი"];
  const MONTHS_DAT = ["იანვარს", "თებერვალს", "მარტს", "აპრილს", "მაისს", "ივნისს",
    "ივლისს", "აგვისტოს", "სექტემბერს", "ოქტომბერს", "ნოემბერს", "დეკემბერს"];
  const FIELDS = [
    ["number", "ნომერი"], ["isoDate", "თარიღი"], ["date", "თარიღი გაზეთზე"],
    ["yearLabel", "წელიწადი"], ["source", "წყარო"], ["scan", "სკანი"], ["contents", "საძიებელი"]
  ];

  // Editing tools appear only when the site is opened from the owner's own computer
  // (the file itself or a local server). On the published site visitors can only read.
  const CAN_EDIT = location.protocol === "file:" ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  document.body.classList.toggle("can-edit", CAN_EDIT);

  const app = document.getElementById("app");
  let build = "";
  let renderToken = 0;

  const loaded = {};
  function load(path) {
    const src = path + (build ? "?v=" + build : "");
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => { delete loaded[src]; s.remove(); reject(new Error(path)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  async function loadYears() {
    if (IV._years) return IV._years;
    build = "";
    await load("data/years.js?t=" + Date.now()).catch(() => {});
    if (IV._years) build = IV._years.build;
    return IV._years;
  }

  async function loadCatalog(year) {
    if (!IV._catalog[year]) await load("data/catalog/" + year + ".js").catch(() => {});
    return IV._catalog[year] || [];
  }

  async function loadIssue(id) {
    if (!IV._issues[id]) await load("data/issues/" + id.slice(0, 4) + "/" + id + ".js").catch(() => {});
    return IV._issues[id];
  }

  // ---------- helpers ----------

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
  }

  function roman(n) {
    const t = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
      [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (const [v, r] of t) while (n >= v) { out += r; n -= v; }
    return out;
  }

  function dateLabel(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? +m[3] + " " + MONTHS_DAT[+m[2] - 1] + " " + m[1] + " წ." : "";
  }

  function plural(n, word) { return n + " " + word; }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  function cfgFor(year) {
    return Object.assign({}, CONFIG.default, (CONFIG.years || {})[year] || {});
  }

  function sheet(inner, cls) { return '<section class="sheet ' + (cls || "") + '">' + inner + "</section>"; }

  function smallMasthead(cfg) {
    return '<header class="masthead"><div></div><div class="mh-center"><a href="#/"><img class="mh-title" src="' +
      esc(cfg.masthead) + '" alt="ივერია"></a></div><div></div></header>' +
      '<div class="mh-sub">' + esc(cfg.subtitle || "") + "</div>";
  }

  function searchBox(q) {
    return '<form class="search" data-search><label for="q">ძიება:</label>' +
      '<input id="q" name="q" type="search" placeholder="სიტყვა ან ფრაზა მთელ არქივში…" value="' + esc(q || "") + '">' +
      '<button type="submit">ძებნა</button></form>';
  }

  function wireSearch() {
    const f = app.querySelector("[data-search]");
    if (f) f.onsubmit = (e) => {
      e.preventDefault();
      const q = f.q.value.trim();
      if (q) location.hash = "#/search?q=" + encodeURIComponent(q);
    };
  }

  function notBuilt() {
    app.innerHTML = sheet(smallMasthead(cfgFor("")) +
      '<p class="empty">არქივი ჯერ არ არის აწყობილი.<br>გაუშვით <b>build.command</b> (Mac) ან <b>build.bat</b> (Windows) — ' +
      'ან ბრძანება <code>python3 build.py</code> — და განაახლეთ გვერდი.</p>' +
      (CAN_EDIT ? '<a class="cta" href="#/help">როგორ ავტვირთო ნომრები?</a>' : ""));
  }

  // ---------- markup → pages of blocks ----------
  //  ===  new page     # rubric     ## article title    ### lead-in
  //  ---  divider      >> signature   blank line = new paragraph

  function parse(text) {
    const pages = [[]];
    let para = [];
    const flush = () => {
      if (para.length) pages[pages.length - 1].push({ t: "p", s: para.join(" ") });
      para = [];
    };
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      let m;
      if (!line) { flush(); continue; }
      if (/^={3,}$/.test(line)) { flush(); pages.push([]); continue; }
      if (/^-{3,}$/.test(line)) { flush(); pages[pages.length - 1].push({ t: "hr" }); continue; }
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flush(); pages[pages.length - 1].push({ t: "h" + m[1].length, s: m[2] }); continue; }
      if ((m = line.match(/^>>\s*(.*)$/))) { flush(); pages[pages.length - 1].push({ t: "sig", s: m[1] }); continue; }
      para.push(line);
    }
    flush();
    return pages.filter((p, i) => p.length || i === 0);
  }

  function autoContents(pages) {
    const items = [];
    let section = null;
    for (const b of pages.flat()) {
      if (b.t === "h1") { section = { title: b.s, subs: [] }; items.push(section); }
      else if (b.t === "h2") {
        if (section) section.subs.push(b.s);
        else items.push({ title: b.s, subs: [] });
      }
    }
    return items.map((it, i) =>
      roman(i + 1) + ". " + it.title.replace(/\.$/, "") +
      (it.subs.length ? ": " + it.subs.map((s) => s.replace(/\.$/, "")).join(", ") : "") + ".").join("—");
  }

  function renderBlocks(blocks) {
    return blocks.map((b) => {
      switch (b.t) {
        case "p": return "<p>" + inline(b.s) + "</p>";
        case "h1": case "h2": case "h3": return "<" + b.t + ">" + inline(b.s) + "</" + b.t + ">";
        case "hr": return "<hr>";
        case "sig": return '<p class="sig">' + inline(b.s) + "</p>";
      }
      return "";
    }).join("");
  }

  function mastheadHTML(issue, cfg) {
    const prices = (cfg.prices || []).map(([label, val]) =>
      '<div class="price-row"><span>' + esc(label) + '</span><span class="dots"></span><span>' + esc(val) + "</span></div>").join("");
    const date = issue.date || dateLabel(issue.isoDate);
    const boxes = (cfg.priceTitle || prices || cfg.notice)
      ? '<div class="mh-boxes"><div>' + (cfg.priceTitle ? '<div class="price-title">' + esc(cfg.priceTitle) + "</div>" : "") + prices +
        "</div><div>" + (cfg.notice || "") + "</div></div>" : "";
    return '<header class="masthead">' +
        '<div class="mh-side left">' + esc(issue.yearLabel || "").replace(/\s+/, "<br>") + "</div>" +
        '<div class="mh-center"><div class="mh-no">№ ' + esc(issue.number || "") + '.</div>' +
          '<img class="mh-title" src="' + esc(cfg.masthead) + '" alt="ივერია"></div>' +
        '<div class="mh-side right">' + esc(date).replace(/\s+(?=\d{4})/, "<br>") + "</div>" +
      "</header>" +
      '<div class="mh-sub">' + esc(cfg.subtitle || "") + "</div>" +
      '<div class="mh-schedule">' + esc(cfg.schedule || "") + "</div>" +
      (cfg.subscription ? '<p class="mh-subscribe">' + cfg.subscription + "</p>" : "") + boxes;
  }

  function issueSheets(issue) {
    const cfg = cfgFor((issue.isoDate || "").slice(0, 4));
    const pages = parse(issue.text);
    const contents = (issue.contents || "").trim() || autoContents(pages);
    return pages.map((blocks, i) => {
      const head = i === 0 ? mastheadHTML(issue, cfg)
        : '<div class="running-head"><span>№ ' + esc(issue.number) + '.</span><span class="rh-title">ივერია</span><span class="rh-page">' + (i + 1) + "</span></div>";
      const toc = i === 0 && contents ? '<p class="contents"><b>საძიებელი:</b> ' + inline(contents) + "</p>" : "";
      const last = i === pages.length - 1;
      const foot = last && (issue.source || issue.scan)
        ? '<div class="sheet-foot"><span>' + (issue.source ? "წყარო: " + esc(issue.source) : "") + "</span>" +
          (issue.scan && /^https?:\/\//.test(issue.scan) ? '<a href="' + esc(issue.scan) + '" target="_blank" rel="noopener">ორიგინალის სკანი ↗</a>' : "") + "</div>"
        : "";
      return '<article class="sheet">' + head + '<div class="columns">' + toc + renderBlocks(blocks) + "</div>" + foot + "</article>";
    }).join("");
  }

  function plainText(issue) {
    return [issue.contents || "", issue.text || ""].join("\n").replace(/^\s*(#{1,3}|>>|={3,}|-{3,})\s*/gm, "").replace(/\*/g, "");
  }

  // ---------- search (index built by build.py) ----------

  function terms(q) {
    const words = (q.toLowerCase().match(/[\p{L}]+/gu) || []).filter((w) => w.length >= MIN_WORD);
    // drop a final vowel so „ჩვეულება“ also finds „ჩვეულების“, „ჩვეულებას“…
    return [...new Set(words.map((w) => w.length > 4 && /[აეიოუ]$/.test(w) ? w.slice(0, -1) : w))];
  }

  function shardFile(key) {
    return "data/search/" + [...key].map((c) => c.codePointAt(0).toString(16)).join("-") + ".js";
  }

  async function findDocs(stems) {
    let result = null;
    for (const stem of stems) {
      const key = [...stem].slice(0, SHARD_LEN).join("");
      if (!(key in IV._shards)) await load(shardFile(key)).catch(() => { IV._shards[key] = {}; });
      const shard = IV._shards[key] || {};
      const hit = new Set();
      for (const w in shard) {
        if (!w.startsWith(stem)) continue;
        let n = 0;
        for (const d of shard[w].split(",")) { n += +d; hit.add(n); }
      }
      result = result ? new Set([...result].filter((x) => hit.has(x))) : hit;
      if (!result.size) break;
    }
    return [...(result || [])].sort((a, b) => a - b);
  }

  function snippet(issue, stems) {
    const p = plainText(issue).replace(/\s+/g, " ");
    const low = p.toLowerCase();
    let at = -1, len = 0;
    for (const s of stems) {
      const i = low.indexOf(s);
      if (i >= 0 && (at < 0 || i < at)) { at = i; len = s.length; }
    }
    if (at < 0) return esc(p.slice(0, 160)) + "…";
    const a = Math.max(0, at - 70), b = Math.min(p.length, at + len + 110);
    return (a ? "…" : "") + markStems(p.slice(a, b), stems) + (b < p.length ? "…" : "");
  }

  function markStems(s, stems) {
    if (!stems.length) return esc(s);
    const re = new RegExp("(" + stems.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    return s.split(re).map((part, i) => i % 2 ? "<mark>" + esc(part) + "</mark>" : esc(part)).join("");
  }

  // ---------- drafts (this browser only) ----------

  function loadDrafts() {
    try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}"); } catch (e) { return {}; }
  }

  function saveDrafts(d) {
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(d)); return true; }
    catch (e) { toast("მონახაზის შენახვა ვერ მოხერხდა — ბრაუზერის მეხსიერება მიუწვდომელია"); return false; }
  }

  function sourceFileName(d) {
    const n = (d.number || "x").trim();
    return (d.isoDate || "0000-00-00") + "_" + (/^\d+$/.test(n) ? n.padStart(3, "0") : n.replace(/[^\p{L}\d-]+/gu, "-")) + ".txt";
  }

  function toSource(d) {
    const head = FIELDS.filter(([k]) => (d[k] || "").trim())
      .map(([k, label]) => label + ": " + String(d[k]).replace(/\s*\n\s*/g, " ").trim());
    return head.join("\n") + "\n\n" + String(d.text || "").trim() + "\n";
  }

  function fromSource(raw) {
    const text = String(raw).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const labels = Object.fromEntries(FIELDS.map(([k, l]) => [l, k]));
    const cut = text.indexOf("\n\n");
    const headLines = (cut < 0 ? text : text.slice(0, cut)).split("\n");
    const out = {};
    for (const line of headLines) {
      const i = line.indexOf(":");
      const key = i > 0 ? labels[line.slice(0, i).trim()] : null;
      if (!key) return { text: text };   // no header — whole file is body text
      out[key] = line.slice(i + 1).trim();
    }
    out.text = cut < 0 ? "" : text.slice(cut + 2);
    return out;
  }

  // ---------- views ----------

  async function viewHome() {
    const years = await loadYears();
    const drafts = !CAN_EDIT ? [] : Object.values(loadDrafts()).sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    if (!years) { notBuilt(); return; }
    const cfg = cfgFor("");
    const ys = years.years;
    const rows = ys.map(([y, n]) =>
      '<li><a href="#/year/' + y + '"><div class="il-row"><span class="il-no">' + y + ' წელი</span><span class="il-dots"></span>' +
      '<span class="il-date">' + plural(n, "ნომერი") + "</span></div></a></li>").join("");
    const draftRows = drafts.map((d) =>
      '<li><a href="#/draft/' + encodeURIComponent(d.did) + '"><div class="il-row"><span class="il-no">№ ' + esc(d.number || "?") +
      '</span><span class="il-dots"></span><span class="il-date">' + esc(d.date || dateLabel(d.isoDate) || "თარიღის გარეშე") + "</span></div>" +
      '<div class="il-meta">' + (d.editOf ? "გამოქვეყნებული ნომრის ცვლილება · " : "ახალი · ") + "შენახულია " +
      esc(new Date(d.savedAt).toLocaleString("ka-GE")) + "</div></a></li>").join("");

    app.innerHTML = sheet(
      smallMasthead(cfg) +
      '<h1 class="archive-title">ნომრების არქივი</h1>' +
      '<p class="archive-lead">' + plural(years.total, "ნომერი") +
        (ys.length ? " · " + ys[0][0] + (ys.length > 1 ? "–" + ys[ys.length - 1][0] : "") + " წწ." : "") + "</p>" +
      searchBox("") +
      (rows ? '<ul class="issue-list">' + rows + "</ul>" : '<p class="empty">ნომრები ჯერ არ არის.</p>') +
      (draftRows ? '<h2 class="list-head">მონახაზები ამ ბრაუზერში</h2><p class="archive-lead left">ჯერ არ არის გამოქვეყნებული — იხ. <a href="#/help">ინსტრუქცია</a>.</p><ul class="issue-list">' + draftRows + "</ul>" : "") +
      (CAN_EDIT ? '<a class="cta" href="#/new">+ ახალი ნომრის ატვირთვა</a>' : ""));
    wireSearch();
  }

  async function viewYear(year) {
    const years = await loadYears();
    if (!years) { notBuilt(); return; }
    const list = await loadCatalog(year);
    const idx = years.years.findIndex(([y]) => y === year);
    const prev = years.years[idx - 1], next = years.years[idx + 1];
    const groups = {};
    for (const e of list) (groups[e.iso.slice(5, 7)] = groups[e.iso.slice(5, 7)] || []).push(e);
    const body = Object.keys(groups).sort().map((m) =>
      '<h2 class="list-head">' + (MONTHS_NOM[+m - 1] || "") + "</h2><ul class=\"issue-list\">" +
      groups[m].map((e) =>
        '<li><a href="#/issue/' + encodeURIComponent(e.id) + '"><div class="il-row"><span class="il-no">№ ' + esc(e.n) +
        '</span><span class="il-dots"></span><span class="il-date">' + esc(e.date) + "</span></div>" +
        '<div class="il-meta">' + esc(e.h.join(" · ")) + (e.h.length ? " · " : "") + e.p + " გვ.</div></a></li>").join("") +
      "</ul>").join("");

    app.innerHTML =
      '<div class="toolbar">' +
        (prev ? '<a href="#/year/' + prev[0] + '">← ' + prev[0] + "</a>" : "") +
        (next ? '<a href="#/year/' + next[0] + '">' + next[0] + " →</a>" : "") +
      "</div>" +
      sheet(smallMasthead(cfgFor(year)) +
        '<h1 class="archive-title">' + esc(year) + " წელი</h1>" +
        '<p class="archive-lead">' + plural(list.length, "ნომერი") + "</p>" +
        searchBox("") + (body || '<p class="empty">ამ წლის ნომრები ვერ მოიძებნა.</p>'));
    wireSearch();
  }

  async function viewIssue(id, q, token) {
    const years = await loadYears();
    if (!years) { notBuilt(); return; }
    const issue = await loadIssue(id);
    if (token !== renderToken) return;
    if (!issue) {
      app.innerHTML = sheet('<p class="empty">ნომერი ვერ მოიძებნა. <a href="#/">არქივში დაბრუნება</a></p>');
      return;
    }
    const list = await loadCatalog(id.slice(0, 4));
    const i = list.findIndex((e) => e.id === id);
    const prev = list[i - 1], next = list[i + 1];
    app.innerHTML =
      '<div class="toolbar">' +
        '<a href="#/year/' + id.slice(0, 4) + '">' + id.slice(0, 4) + " წელი</a>" +
        (prev ? '<a href="#/issue/' + encodeURIComponent(prev.id) + '">← № ' + esc(prev.n) + "</a>" : "") +
        (next ? '<a href="#/issue/' + encodeURIComponent(next.id) + '">№ ' + esc(next.n) + " →</a>" : "") +
        (CAN_EDIT ? '<a href="#/edit/' + encodeURIComponent(id) + '">რედაქტირება</a>' : "") +
        '<button type="button" data-act="print">ბეჭდვა</button>' +
        '<span class="mode-switch" role="group" aria-label="კითხვის რეჟიმი">' +
          '<button type="button" data-mode="scroll">გადახვევა</button>' +
          '<button type="button" data-mode="flip">ფურცვლა</button>' +
        "</span>" +
      "</div>" +
      '<div class="book" id="book">' + issueSheets(issue) + "</div>";
    document.title = "ივერია № " + issue.number + " — " + issue.date;
    app.querySelector('[data-act="print"]').onclick = () => window.print();

    const book = document.getElementById("book");
    const switches = app.querySelectorAll("[data-mode]");
    function applyMode(mode, start) {
      switches.forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
      if (flipCtl) { flipCtl.destroy(); flipCtl = null; }
      if (mode === "flip") flipCtl = setupFlip(book, start || 0);
    }
    switches.forEach((b) => b.onclick = () => {
      const mode = b.dataset.mode;
      if (b.classList.contains("on")) return;
      // keep the reader on the same page when switching modes
      const at = flipCtl ? flipCtl.index() : visiblePage(book);
      saveReadMode(mode);
      applyMode(mode, at);
      book.querySelectorAll(":scope > .sheet")[at].scrollIntoView({ block: "start" });
    });
    applyMode(readMode());

    const first = q ? highlight(terms(q)) : null;
    if (first) {
      if (flipCtl) flipCtl.show([...book.children].indexOf(first.closest(".sheet")));
      setTimeout(() => first.scrollIntoView({ block: "center" }), 50);
    }
  }

  // ---------- page-turning reader ----------

  const READ_MODE_KEY = "iveria.readMode";
  let flipCtl = null;

  function readMode() {
    try { return localStorage.getItem(READ_MODE_KEY) === "flip" ? "flip" : "scroll"; } catch (e) { return "scroll"; }
  }

  function saveReadMode(m) {
    try { localStorage.setItem(READ_MODE_KEY, m); } catch (e) { /* not remembered; fine */ }
  }

  function visiblePage(book) {
    const pages = [...book.querySelectorAll(":scope > .sheet")];
    const i = pages.findIndex((p) => p.getBoundingClientRect().bottom > 120);
    return Math.max(0, i);
  }

  function setupFlip(book, start) {
    const pages = [...book.querySelectorAll(":scope > .sheet")];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cur = 0, busy = false;

    book.classList.add("flip");
    const prevCorner = Object.assign(document.createElement("button"), { type: "button", className: "page-corner prev", title: "წინა გვერდი" });
    const nextCorner = Object.assign(document.createElement("button"), { type: "button", className: "page-corner next", title: "შემდეგი გვერდი" });
    prevCorner.setAttribute("aria-label", "წინა გვერდი");
    nextCorner.setAttribute("aria-label", "შემდეგი გვერდი");
    book.append(prevCorner, nextCorner);
    const nav = document.createElement("div");
    nav.className = "flip-nav";
    nav.innerHTML = '<button type="button" data-go="-1">← წინა</button>' +
      '<span class="flip-count" aria-live="polite"></span>' +
      '<button type="button" data-go="1">შემდეგი →</button>';
    book.after(nav);
    const count = nav.querySelector(".flip-count");
    const [prevBtn, nextBtn] = nav.querySelectorAll("button");

    function fit() { if (!busy) book.style.height = pages[cur].offsetHeight + "px"; }

    function show(i) {
      if (i < 0 || i >= pages.length) return;
      pages.forEach((p, k) => { p.classList.toggle("current", k === i); p.style.zIndex = ""; });
      cur = i;
      book.style.height = pages[i].offsetHeight + "px";
      count.textContent = "გვერდი " + (i + 1) + " / " + pages.length;
      prevBtn.disabled = prevCorner.hidden = i === 0;
      nextBtn.disabled = nextCorner.hidden = i === pages.length - 1;
    }

    async function go(d) {
      const to = cur + d;
      if (busy || to < 0 || to >= pages.length) return;
      const top = book.getBoundingClientRect().top;
      if (top < 0) window.scrollTo({ top: window.scrollY + top - 12, behavior: reduce ? "auto" : "smooth" });
      if (reduce) { show(to); return; }

      busy = true;
      const from = pages[cur], target = pages[to];
      book.style.height = Math.max(from.offsetHeight, target.offsetHeight) + "px";
      target.classList.add("current");
      // forward: the current page lifts off to the left; back: the previous page swings back in over it
      const turning = d > 0 ? from : target;
      const under = d > 0 ? target : from;
      turning.style.zIndex = 3;
      under.style.zIndex = 2;
      turning.classList.add("turning");
      under.classList.add("under");
      const frames = [{ transform: "rotateY(0deg)" }, { transform: "rotateY(-180deg)" }];
      const timing = { duration: 850, easing: "cubic-bezier(.42,.08,.32,1)" };
      const anims = [turning.animate(d > 0 ? frames : frames.slice().reverse(), timing)];
      try {
        const shade = [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }];
        anims.push(turning.animate(shade, Object.assign({ pseudoElement: "::after" }, timing)));
        anims.push(under.animate(d > 0 ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
          Object.assign({ pseudoElement: "::before" }, timing)));
      } catch (e) { /* pseudo-element animation unsupported: turn without shading */ }
      // a background tab may never run the animation; don't leave the reader stuck mid-turn
      await Promise.race([anims[0].finished.catch(() => {}), new Promise((r) => setTimeout(r, timing.duration + 400))]);
      anims.forEach((a) => a.cancel());
      turning.classList.remove("turning");
      under.classList.remove("under");
      busy = false;
      show(to);
    }

    nav.onclick = (e) => { const b = e.target.closest("[data-go]"); if (b) go(+b.dataset.go); };
    prevCorner.onclick = () => go(-1);
    nextCorner.onclick = () => go(1);

    let sx = 0, sy = 0;
    const onStart = (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
    const onEnd = (e) => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    };
    book.addEventListener("touchstart", onStart, { passive: true });
    book.addEventListener("touchend", onEnd, { passive: true });

    // fonts and the masthead image can change a page's height after the first layout
    const ro = new ResizeObserver(fit);
    pages.forEach((p) => ro.observe(p));

    show(Math.min(Math.max(0, start), pages.length - 1));

    return {
      go, show,
      index: () => cur,
      destroy() {
        ro.disconnect();
        book.removeEventListener("touchstart", onStart);
        book.removeEventListener("touchend", onEnd);
        prevCorner.remove(); nextCorner.remove(); nav.remove();
        book.classList.remove("flip");
        book.style.height = "";
        pages.forEach((p) => { p.classList.remove("current", "turning", "under"); p.style.zIndex = ""; });
      }
    };
  }

  document.addEventListener("keydown", (e) => {
    if (!flipCtl || e.altKey || e.ctrlKey || e.metaKey || (e.target.closest && e.target.closest("input, textarea"))) return;
    if (e.key === "ArrowRight") { e.preventDefault(); flipCtl.go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); flipCtl.go(-1); }
  });

  function highlight(stems) {
    if (!stems.length) return;
    const re = new RegExp(stems.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
    const nodes = [];
    const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      re.lastIndex = 0;
      if (n.parentElement.closest(".columns") && re.test(n.nodeValue)) nodes.push(n);
    }
    let first = null;
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(n.nodeValue))) {
        frag.append(n.nodeValue.slice(last, m.index));
        const mk = document.createElement("mark");
        mk.textContent = m[0];
        frag.append(mk);
        first = first || mk;
        last = m.index + m[0].length;
      }
      frag.append(n.nodeValue.slice(last));
      n.replaceWith(frag);
    }
    return first;
  }

  async function viewSearch(q, page, token) {
    const years = await loadYears();
    if (!years) { notBuilt(); return; }
    const stems = terms(q);
    const head = smallMasthead(cfgFor("")) + '<h1 class="archive-title">ძიება</h1>' + searchBox(q);
    if (!stems.length) {
      app.innerHTML = sheet(head + '<p class="empty">ჩაწერეთ მინიმუმ ' + MIN_WORD + "-ასოიანი სიტყვა.</p>");
      wireSearch();
      return;
    }
    app.innerHTML = sheet(head + '<p class="empty">ვეძებ…</p>');
    wireSearch();
    const [found] = await Promise.all([findDocs(stems), IV._docs ? null : load("data/docs.js").catch(() => {})]);
    if (token !== renderToken) return;
    const docs = IV._docs || [];
    const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    page = Math.min(Math.max(1, page), pages);
    const shown = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((n) => docs[n]).filter(Boolean);
    const qs = "q=" + encodeURIComponent(q);
    const rows = shown.map(([id, num, iso, date]) =>
      '<li><a href="#/issue/' + encodeURIComponent(id) + "?" + qs + '"><div class="il-row"><span class="il-no">№ ' + esc(num) +
      '</span><span class="il-dots"></span><span class="il-date">' + esc(date) + "</span></div>" +
      '<div class="il-snip" data-snip="' + esc(id) + '">…</div></a></li>').join("");
    const pager = pages > 1
      ? '<div class="pager">' +
        (page > 1 ? '<a href="#/search?' + qs + "&p=" + (page - 1) + '">← წინა</a>' : "<span></span>") +
        "<span>" + page + " / " + pages + "</span>" +
        (page < pages ? '<a href="#/search?' + qs + "&p=" + (page + 1) + '">შემდეგი →</a>' : "<span></span>") + "</div>"
      : "";
    app.innerHTML = sheet(head +
      '<p class="archive-lead">' + (found.length ? "ნაპოვნია " + plural(found.length, "ნომერში") : "ვერაფერი მოიძებნა") + "</p>" +
      (rows ? '<ul class="issue-list">' + rows + "</ul>" : "") + pager);
    wireSearch();
    // snippets: fetch only the issues shown on this page
    for (const [id] of shown) {
      loadIssue(id).then((issue) => {
        const el = app.querySelector('[data-snip="' + CSS.escape(id) + '"]');
        if (el && issue) el.innerHTML = snippet(issue, stems);
      });
    }
  }

  async function viewEditor(opts) {
    const drafts = loadDrafts();
    let d;
    if (opts.draft) {
      d = drafts[opts.draft];
      if (!d) { location.hash = "#/"; return; }
    } else if (opts.edit) {
      const existing = Object.values(drafts).find((x) => x.editOf === opts.edit);
      if (existing) d = existing;
      else {
        await loadYears();
        const issue = await loadIssue(opts.edit);
        if (!issue) { location.hash = "#/"; return; }
        d = Object.assign({}, issue, { did: "e" + Date.now(), editOf: issue.id });
        delete d.id;
      }
    } else {
      d = { did: "n" + Date.now(), number: "", isoDate: "", date: "", yearLabel: "", source: "", scan: "", contents: "", text: "" };
    }

    app.innerHTML = sheet(
      '<h1 class="ed-title">' + (d.editOf ? "ნომრის რედაქტირება" : "ნომრის ატვირთვა") + "</h1>" +
      (d.editOf ? '<p class="archive-lead">ცვლილებები ჯერ მონახაზად ინახება. გამოსაქვეყნებლად ჩამოტვირთეთ .txt და ჩაანაცვლეთ ძველი ფაილი.</p>' : "") +
      '<form id="ed" class="ed-grid" autocomplete="off">' +
        field("number", "ნომერი *", d.number, "მაგ. 1") +
        field("isoDate", "თარიღი *", d.isoDate, "", "date") +
        field("date", "თარიღი გაზეთზე", d.date, "ცარიელი → ავტომატურად", "text", "span2") +
        field("yearLabel", "წელიწადი", d.yearLabel, "მაგ. წელიწადი პირველი", "text", "span2") +
        field("source", "წყარო", d.source, "ბიბლიოთეკა, ფონდი…", "text", "span2") +
        field("scan", "სკანის ბმული", d.scan, "https://…", "url", "span4") +
        '<label class="field span4">საძიებელი <small>(თუ ცარიელია, სათაურებიდან ავტომატურად შედგება)</small>' +
          '<textarea name="contents" rows="2">' + esc(d.contents) + "</textarea></label>" +
        '<div class="field span4">' +
          '<div class="ed-tabs"><button type="button" class="on" data-tab="text">ტექსტი</button><button type="button" data-tab="preview">გადახედვა</button></div>' +
          '<div data-pane="text">' +
            '<div class="drop" id="drop">ჩააგდეთ აქ .txt ფაილი ან <u>აირჩიეთ ფაილი</u><input type="file" id="file" accept=".txt,.md,text/plain" hidden></div>' +
            '<textarea id="ed-text" name="text" spellcheck="false" placeholder="## წინასიტყვაობა&#10;&#10;ჟურნალ-გაზეთობაში შემოღებულია…">' + esc(d.text) + "</textarea>" +
            '<div class="help">' +
              "<b>ნიშნები:</b> <code>## სათაური</code> — სტატიის სათაური · <code># რუბრიკა</code> — რუბრიკა (მაგ. საქართველოს მატიანე) · " +
              "<code>### სათაური</code> — ქვესათაური · ცარიელი სტრიქონი — ახალი აბზაცი · <code>---</code> — გამყოფი ხაზი · " +
              "<code>===</code> — ახალი გვერდი · <code>&gt;&gt; ხელმოწერა</code> — ავტორის ხელმოწერა · <code>**მსხვილი**</code>, <code>*დახრილი*</code>" +
            "</div>" +
          "</div>" +
          '<div data-pane="preview" class="preview-wrap" hidden></div>' +
        "</div>" +
      "</form>" +
      '<div class="ed-actions">' +
        (drafts[d.did] ? '<button type="button" data-act="discard" class="quiet">მონახაზის წაშლა</button>' : "") +
        '<button type="button" data-act="save">მონახაზად შენახვა</button>' +
        '<button type="button" class="primary" data-act="download">ჩამოტვირთვა .txt</button>' +
      "</div>" +
      '<div id="publish-note"></div>');

    const form = document.getElementById("ed");
    const textArea = document.getElementById("ed-text");
    const drop = document.getElementById("drop");
    const fileIn = document.getElementById("file");
    const textPane = form.querySelector('[data-pane="text"]');
    const prevPane = form.querySelector('[data-pane="preview"]');

    function collect() {
      const f = new FormData(form);
      const o = Object.assign({}, d);
      for (const [k] of FIELDS.concat([["text"]])) o[k] = (f.get(k) || "").toString();
      o.number = o.number.replace(/^№\s*/, "").trim();
      return o;
    }

    function fill(o) {
      for (const [k] of FIELDS) if (o[k] != null && form[k]) form[k].value = o[k];
    }

    function valid(o) {
      if (!o.number) return "შეავსეთ ნომერი";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.isoDate)) return "შეავსეთ თარიღი";
      if (!o.text.trim()) return "ტექსტი ცარიელია";
      return "";
    }

    function store(o) {
      o.savedAt = new Date().toISOString();
      const all = loadDrafts();
      all[o.did] = o;
      return saveDrafts(all);
    }

    form.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
      form.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
      const showPrev = b.dataset.tab === "preview";
      textPane.hidden = showPrev;
      prevPane.hidden = !showPrev;
      if (showPrev) prevPane.innerHTML = issueSheets(collect());
    });

    function readFile(file) {
      if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        const parsed = fromSource(r.result);
        fill(parsed);
        textArea.value = textArea.value.trim() && !parsed.number
          ? textArea.value.replace(/\s*$/, "\n\n") + parsed.text : parsed.text;
        toast("ფაილი ჩაიტვირთა: " + file.name);
      };
      r.readAsText(file, "utf-8");
    }
    drop.onclick = () => fileIn.click();
    fileIn.onchange = () => { readFile(fileIn.files[0]); fileIn.value = ""; };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); readFile(e.dataTransfer.files[0]); };

    app.querySelector('[data-act="save"]').onclick = () => {
      const o = collect();
      if (!o.number && !o.text.trim()) { toast("ჯერ ცარიელია"); return; }
      if (store(o)) {
        toast("მონახაზი შენახულია ამ ბრაუზერში");
        if (location.hash !== "#/draft/" + o.did) history.replaceState(null, "", "#/draft/" + encodeURIComponent(o.did));
        d = o;
      }
    };

    app.querySelector('[data-act="download"]').onclick = () => {
      const o = collect();
      const err = valid(o);
      if (err) { toast(err); return; }
      store(o);
      d = o;
      const name = sourceFileName(o);
      download(name, toSource(o));
      const year = o.isoDate.slice(0, 4);
      document.getElementById("publish-note").innerHTML =
        '<div class="publish-note"><b>როგორ გამოვაქვეყნო:</b><ol>' +
        "<li>ფაილი <code>" + esc(name) + "</code> ჩადეთ საიტის საქაღალდეში: <code>issues/" + esc(year) + "/</code>" +
        (d.editOf ? " (ძველი ფაილი ჩაანაცვლეთ)" : "") + "</li>" +
        "<li>ორჯერ დააწკაპუნეთ <code>build.command</code>-ზე (Mac) ან <code>build.bat</code>-ზე (Windows)</li>" +
        "<li>განაახლეთ გვერდი — ნომერი არქივში გამოჩნდება. შემდეგ შეგიძლიათ მონახაზი წაშალოთ.</li></ol></div>";
    };

    const discard = app.querySelector('[data-act="discard"]');
    if (discard) discard.onclick = () => {
      if (!confirm("წავშალო ეს მონახაზი? გამოქვეყნებული ნომერი არ წაიშლება.")) return;
      const all = loadDrafts();
      delete all[d.did];
      saveDrafts(all);
      location.hash = "#/";
    };
  }

  function field(name, label, value, ph, type, cls) {
    return '<label class="field ' + (cls || "") + '">' + label +
      '<input name="' + name + '" type="' + (type || "text") + '" value="' + esc(value || "") + '" placeholder="' + esc(ph || "") + '"></label>';
  }

  function download(name, content) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function viewHelp() {
    const tpl = document.getElementById("help-template");
    app.innerHTML = sheet(smallMasthead(cfgFor("")) + tpl.innerHTML);
  }

  // ---------- router ----------

  function route() {
    const token = ++renderToken;
    if (flipCtl) { flipCtl.destroy(); flipCtl = null; }
    const h = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = h.split("?");
    const params = new URLSearchParams(qs || "");
    const q = params.get("q") || "";
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    document.title = "ივერია — გაზეთის არქივი";
    document.querySelectorAll(".nav-links a").forEach((a) =>
      a.classList.toggle("on", a.getAttribute("href") === "#/" + (parts[0] || "")));
    window.scrollTo(0, 0);
    if (!CAN_EDIT && ["new", "draft", "edit", "help"].includes(parts[0])) {
      location.replace("#/");
      return;
    }
    switch (parts[0]) {
      case "year": return viewYear(parts[1]);
      case "issue": return viewIssue(parts[1], q, token);
      case "search": return viewSearch(q, parseInt(params.get("p"), 10) || 1, token);
      case "new": return viewEditor({});
      case "draft": return viewEditor({ draft: parts[1] });
      case "edit": return viewEditor({ edit: parts[1] });
      case "help": return viewHelp();
      default: return viewHome();
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
