(function () {
  "use strict";

  const LAST_YEAR = 1906;
  const MIN_WORD = 3;   // must match app.js and build.py
  const MAX_WORD = 16;
  const BIG = "აბგდეილმნრს";  // common letters get a double compartment
  const LETTERS = "აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    document.querySelector(".owner-only").hidden = false;
  }

  // ---------- the press drive turns as the page scrolls ----------

  if (!reduce) {
    let queued = false;
    const turn = () => {
      queued = false;
      document.documentElement.style.setProperty("--spin", (window.scrollY * .35).toFixed(1));
    };
    window.addEventListener("scroll", () => {
      if (!queued) { queued = true; requestAnimationFrame(turn); }
    }, { passive: true });
  }

  // ---------- type case: compose a word and search the archive with it ----------

  const stick = document.getElementById("stick");
  const stickEmpty = document.getElementById("stick-empty");
  const pull = document.getElementById("pull");
  const printBtn = document.getElementById("print");
  const caseEl = document.getElementById("type-case");
  const section = document.getElementById("case");
  let word = "";
  let setting = 0;

  function refresh() {
    stickEmpty.hidden = word.length > 0;
    pull.classList.toggle("hint", word.length < MIN_WORD);
    pull.textContent = word.length >= MIN_WORD ? word
      : word ? word + " · კიდევ " + (MIN_WORD - word.length) + " ასო" : "აკრიფეთ მინიმუმ " + MIN_WORD + " ასო";
    printBtn.disabled = word.length < MIN_WORD;
  }

  function add(ch) {
    if (word.length >= MAX_WORD) return;
    word += ch;
    const s = document.createElement("span");
    s.className = "sort";
    s.textContent = ch;
    stick.appendChild(s);
    refresh();
  }

  function removeLast() {
    if (!word) return;
    word = word.slice(0, -1);
    stick.lastElementChild.remove();
    refresh();
  }

  function clearStick() {
    setting++;
    word = "";
    stick.textContent = "";
    refresh();
  }

  function setWord(w) {
    clearStick();
    const run = setting;
    [...w].forEach((ch, i) => {
      if (reduce) add(ch);
      else setTimeout(() => { if (run === setting) add(ch); }, i * 70);
    });
  }

  function printAndSearch() {
    if (word.length < MIN_WORD) return;
    const go = () => { location.href = "archive.html#/search?q=" + encodeURIComponent(word); };
    if (reduce) { go(); return; }
    pull.classList.add("stamp");
    setTimeout(go, 280);
  }

  caseEl.innerHTML = [...LETTERS].map((ch) =>
    '<button type="button" class="cell' + (BIG.includes(ch) ? " big" : "") + '" data-ch="' + ch +
    '" aria-label="' + ch + '"><span>' + ch + "</span></button>").join("");
  caseEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ch]");
    if (b) { setting++; add(b.dataset.ch); }
  });
  document.getElementById("back").onclick = () => { setting++; removeLast(); };
  document.getElementById("clear").onclick = clearStick;
  printBtn.onclick = printAndSearch;
  document.querySelectorAll("[data-word]").forEach((b) => { b.onclick = () => setWord(b.dataset.word); });

  // a Georgian keyboard works too, while the case is on screen
  let caseVisible = false;
  new IntersectionObserver((es) => { caseVisible = es[0].isIntersecting; }).observe(section);
  document.addEventListener("keydown", (e) => {
    if (!caseVisible || e.ctrlKey || e.metaKey || e.altKey) return;
    if (LETTERS.includes(e.key)) { setting++; add(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); setting++; removeLast(); }
    else if (e.key === "Enter" && !(e.target.closest && e.target.closest("a, button"))) printAndSearch();
  });
  refresh();

  // ---------- live data from the archive build ----------

  const store = { years: null, catalog: {} };
  window.IVERIA = {
    years(o) { store.years = o; },
    catalog(y, list) { store.catalog[y] = list; }
  };

  function load(path) {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = path;
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function drawers(years) {
    const counts = new Map(years.map(([y, n]) => [+y, n]));
    const first = years.length ? Math.min(+years[0][0], 1877) : 1877;
    const last = years.length ? Math.max(+years[years.length - 1][0], LAST_YEAR) : LAST_YEAR;
    let html = "";
    for (let y = first; y <= last; y++) {
      const n = counts.get(y);
      html += n
        ? '<a class="drawer" href="archive.html#/year/' + y + '"><b>' + y + "</b><small>" + n + " ნომერი</small></a>"
        : '<span class="drawer empty"><b>' + y + "</b><small>ჯერ ცარიელია</small></span>";
    }
    document.getElementById("drawers").innerHTML = html;
  }

  async function init() {
    drawers([]);
    await load("data/years.js?t=" + Date.now());
    if (!store.years || !store.years.years.length) return;
    const { build, years, total } = store.years;
    drawers(years);
    document.getElementById("cabinet-lead").textContent =
      "ყოველ უჯრაში ერთი წლის ნომრებია. ახლა არქივში " + total + " ნომერია, უჯრები თანდათან ივსება.";

    const firstYear = years[0][0], lastYear = years[years.length - 1][0];
    await load("data/catalog/" + firstYear + ".js?v=" + build);
    if (lastYear !== firstYear) await load("data/catalog/" + lastYear + ".js?v=" + build);

    const firstIssue = (store.catalog[firstYear] || [])[0];
    if (firstIssue) document.getElementById("first-issue").href = "archive.html#/issue/" + encodeURIComponent(firstIssue.id);

    const list = store.catalog[lastYear] || [];
    const latest = list[list.length - 1];
    if (latest) {
      const a = document.getElementById("latest");
      a.href = "archive.html#/issue/" + encodeURIComponent(latest.id);
      a.innerHTML = "<strong>ბოლოს დამატებული: № " + esc(latest.n) + ", " + esc(latest.date) + "</strong><span>" +
        esc(latest.h.join(" · ")) + "</span>";
      a.hidden = false;
    }
  }

  init();
})();
