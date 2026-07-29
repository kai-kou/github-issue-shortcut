/* GitHub Issue Shortcut — ランディングページの挙動
   - 言語切替（日本語 / English）: html[data-lang] を切り替えるだけ。JS 無効時は日本語が表示される
   - スクロール表示アニメーション: prefers-reduced-motion では実行しない（design-guidelines D-9）
   依存ライブラリなし。 */

(function () {
  "use strict";

  var STORAGE_KEY = "gis-lp-lang";
  var SUPPORTED = ["ja", "en"];
  var root = document.documentElement;

  /* ---------------- 言語切替 ---------------- */

  function normalize(value) {
    if (!value) return null;
    var primary = String(value).split("-")[0].toLowerCase();
    return SUPPORTED.indexOf(primary) === -1 ? null : primary;
  }

  function readStoredLang() {
    try {
      return normalize(localStorage.getItem(STORAGE_KEY));
    } catch (_) {
      return null;
    }
  }

  function detectLang() {
    var langs = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
    for (var i = 0; i < langs.length; i += 1) {
      var hit = normalize(langs[i]);
      if (hit) return hit;
    }
    return "ja";
  }

  function applyLang(lang) {
    root.setAttribute("data-lang", lang);
    root.setAttribute("lang", lang);
    var buttons = document.querySelectorAll("[data-set-lang]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute(
        "aria-pressed",
        buttons[i].getAttribute("data-set-lang") === lang ? "true" : "false"
      );
    }
  }

  // 明示的な選択 > ブラウザの言語設定 > 日本語（既定）
  applyLang(readStoredLang() || detectLang());

  document.addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest("[data-set-lang]") : null;
    if (!button) return;
    var lang = normalize(button.getAttribute("data-set-lang"));
    if (!lang) return;
    applyLang(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {
      /* プライベートモード等で保存できなくても切替自体は成立させる */
    }
  });

  /* ---------------- スクロール表示 ---------------- */

  var targets = document.querySelectorAll(".reveal");
  var prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    for (var j = 0; j < targets.length; j += 1) targets[j].classList.add("is-visible");
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
  );

  for (var k = 0; k < targets.length; k += 1) observer.observe(targets[k]);
})();
