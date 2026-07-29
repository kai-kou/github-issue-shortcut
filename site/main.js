/* GitHub Issue Shortcut — ランディングページの挙動
   - 言語切替（日本語 / English）: html[data-lang] を切り替えるだけ。JS 無効時は日本語が表示される
   - スクロール表示アニメーション: 表示状態は CSS 側の 3 系統（is-visible / no-js / reveal-fallback）が担う
   依存ライブラリなし。 */

(function () {
  "use strict";

  var STORAGE_KEY = "gis-lp-lang";
  var SUPPORTED = ["ja", "en"];
  var root = document.documentElement;

  // main.js が動いた時点で、head が仕掛けた「本文が透明のまま残る」保険は不要になる。
  clearTimeout(window.__lpRevealFallback);

  /* ---------------- 言語切替 ---------------- */

  // 本文は data-l 付きの span を CSS で出し分けるが、属性値（alt / aria-label）と
  // <head> のメタ情報は DOM を書き換えないと切り替わらないためここで面倒を見る。
  var META = {
    ja: {
      title: "GitHub Issue Shortcut — 思いついた瞬間を、数秒で GitHub Issue に",
      description:
        "Android のホーム画面をタップして数秒で GitHub Issue を立てる PWA。PAT の発行も管理も不要で、GitHub でログインするだけ。サーバーはデータを保存しません。MIT ライセンスのオープンソース。",
    },
    en: {
      title: "GitHub Issue Shortcut — capture the idea before it's gone",
      description:
        "An Android PWA that turns a home-screen tap into a GitHub issue in seconds. No personal access token — just sign in with GitHub. The server stores none of your data. Open source (MIT).",
    },
  };

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
    var langs =
      navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
    for (var i = 0; i < langs.length; i += 1) {
      var hit = normalize(langs[i]);
      if (hit) return hit;
    }
    return "ja";
  }

  /** 日本語の初期値を data-{attr}-ja へ退避しておき、切替のたびに両方向へ戻せるようにする。 */
  function swapAttr(attr, enKey, jaKey) {
    var nodes = document.querySelectorAll("[" + enKey + "]");
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!node.hasAttribute(jaKey)) node.setAttribute(jaKey, node.getAttribute(attr) || "");
      var next = root.getAttribute("data-lang") === "en" ? enKey : jaKey;
      node.setAttribute(attr, node.getAttribute(next) || "");
    }
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

    swapAttr("alt", "data-alt-en", "data-alt-ja");
    swapAttr("aria-label", "data-label-en", "data-label-ja");

    document.title = META[lang].title;
    var description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", META[lang].description);
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

  /* ---------------- スクロール表示 ----------------
     prefers-reduced-motion は CSS 側（.reveal を無条件に可視化）で完結しているため、
     ここでは IntersectionObserver の有無だけを見る。 */

  var targets = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window)) {
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
