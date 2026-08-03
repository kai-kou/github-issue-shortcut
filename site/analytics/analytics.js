/* 利用状況ダッシュボード（Issue #239）
 *
 * データはテレメトリ専用データブランチに置いた集計 JSON を取得するだけ。
 * site/ にデータを焼き込まないので、このページは 1 回コミットすれば以後は
 * ルーティンのデータ push だけで最新化される（議論 D-3）。
 * Cloudflare の API はクライアントから叩かない（トークンを露出させないため）。
 */
(function () {
  "use strict";

  var FEED_URL =
    "https://raw.githubusercontent.com/kai-kou/github-issue-shortcut/" +
    "refs/heads/telemetry/worker-usage/content/analytics/worker_usage/dashboard.json";

  var PANELS = [
    { key: "daily", id: "panel-daily", unit: "日", label: "日" },
    { key: "weekly", id: "panel-weekly", unit: "週", label: "週（月曜始まり）" },
    { key: "monthly", id: "panel-monthly", unit: "月", label: "月" },
  ];

  var SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  function num(value) {
    return (Number(value) || 0).toLocaleString("ja-JP");
  }

  /** ISO 8601（JST オフセット付き）を「2026-08-03 11:24 JST」表記にする。 */
  function formatJst(iso) {
    if (!iso) return "不明";
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    if (!m) return iso;
    return m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] + " JST";
  }

  /** ラベルを軸表示用に短くする（2026-08-02 → 8/2、2026-08 → 2026-08）。 */
  function shortLabel(label) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
    return m ? Number(m[2]) + "/" + Number(m[3]) : label;
  }

  function kpis(points) {
    var known = points.filter(function (p) {
      return !p.missing;
    });
    var requests = 0;
    var errors = 0;
    var peak = { label: "", requests: 0 };
    known.forEach(function (p) {
      requests += Number(p.requests) || 0;
      errors += Number(p.errors) || 0;
      if ((Number(p.requests) || 0) >= peak.requests) {
        peak = { label: p.label, requests: Number(p.requests) || 0 };
      }
    });
    return {
      requests: requests,
      errors: errors,
      errorRate: requests > 0 ? (errors / requests) * 100 : 0,
      peak: peak,
      known: known.length,
      missing: points.length - known.length,
    };
  }

  function renderKpis(stats, unit, freeTierDaily) {
    var list = el("ul", { class: "kpis" });
    var cards = [
      {
        label: "リクエスト数（合計）",
        value: num(stats.requests),
        note: stats.known + " " + unit + "分の実測値",
      },
      { label: "エラー数", value: num(stats.errors), note: "5xx / 例外を含む" },
      {
        label: "エラー率",
        value: stats.requests > 0 ? stats.errorRate.toFixed(2) + "%" : "—",
        note: stats.requests > 0 ? "" : "リクエストなし",
      },
      {
        label: "ピーク（1 " + unit + "あたり）",
        value: num(stats.peak.requests),
        note: stats.peak.label
          ? stats.peak.label +
            "・無料枠の " +
            ((stats.peak.requests / freeTierDaily) * 100).toFixed(2) +
            "%"
          : "データなし",
      },
    ];
    cards.forEach(function (card) {
      var li = el("li", { class: "kpi" });
      li.appendChild(el("p", { class: "kpi__label" }, card.label));
      li.appendChild(el("p", { class: "kpi__value" }, card.value));
      if (card.note) li.appendChild(el("p", { class: "kpi__note" }, card.note));
      list.appendChild(li);
    });
    return list;
  }

  /**
   * 棒グラフ（自前 SVG・ライブラリ非依存）。
   * - Y 軸は必ずゼロ始点（切り詰めによる誇張を避ける）
   * - 「収集したが 0 件」は極小バー、「データなし」は斜線ハッチングで区別する（ゼロ埋めで嘘をつかない）
   */
  function renderChart(points, unitLabel, idSuffix) {
    var W = 720;
    var H = 220;
    var padL = 40;
    var padR = 8;
    var padT = 8;
    var padB = 28;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;
    var max = points.reduce(function (acc, p) {
      return Math.max(acc, Number(p.requests) || 0);
    }, 0);
    var scaleMax = max > 0 ? max : 1;
    var slot = innerW / points.length;
    var barW = Math.max(2, slot * 0.68);

    var svg = svgEl("svg", {
      class: "chart",
      viewBox: "0 0 " + W + " " + H,
      role: "img",
      "aria-label":
        unitLabel +
        "ごとのリクエスト数の推移。最大 " +
        max +
        " 件。詳細な数値は下の表を参照してください。",
    });

    var defs = svgEl("defs", {});
    // パターンの id はパネルごとに変える。同じ id を 3 パネルで使うと、文書順で最初の
    // （＝非表示パネル側の）定義が参照され、Chrome では塗りが出ない（実機で確認）。
    var hatchId = "hatch-" + idSuffix;
    var pattern = svgEl("pattern", {
      id: hatchId,
      width: "6",
      height: "6",
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    });
    pattern.appendChild(
      svgEl("line", { class: "chart__hatch", x1: "0", y1: "0", x2: "0", y2: "6" })
    );
    defs.appendChild(pattern);
    svg.appendChild(defs);

    // Y 軸の目盛り（0 と最大値のみ。データインク比を上げる）
    [0, scaleMax].forEach(function (value) {
      var y = padT + innerH - (value / scaleMax) * innerH;
      svg.appendChild(
        svgEl("line", { class: "chart__axis", x1: padL, y1: y, x2: W - padR, y2: y })
      );
      var text = svgEl("text", { class: "chart__tick", x: padL - 6, y: y + 3, "text-anchor": "end" });
      text.textContent = String(value);
      svg.appendChild(text);
    });

    points.forEach(function (p, i) {
      var value = Number(p.requests) || 0;
      var x = padL + slot * i + (slot - barW) / 2;
      var h = p.missing ? innerH : Math.max(value > 0 ? 2 : 1.5, (value / scaleMax) * innerH);
      var y = padT + innerH - h;
      var rect = svgEl("rect", {
        class: p.missing ? "chart__bar chart__bar--missing" : "chart__bar",
        x: x.toFixed(1),
        y: p.missing ? padT : y.toFixed(1),
        width: barW.toFixed(1),
        height: (p.missing ? innerH : h).toFixed(1),
        rx: "1",
      });
      // CSS のクラス指定（.chart__bar { fill: ... }）は presentation attribute より強いので、
      // パターン参照はインライン style で当てる（属性 fill だと上書きされ、欠測が
      // 「満杯の棒」に見えるという実害があった）。
      if (p.missing) rect.style.fill = "url(#" + hatchId + ")";
      var title = svgEl("title", {});
      title.textContent = p.missing
        ? p.label + ": データなし（計測していない期間）"
        : p.label + ": " + value + " requests / " + (Number(p.errors) || 0) + " errors";
      rect.appendChild(title);
      svg.appendChild(rect);

      // エラーは同じ棒の上に重ねず、下端の細い帯で示す（0 件の日と混同させない）
      if (!p.missing && Number(p.errors) > 0) {
        svg.appendChild(
          svgEl("rect", {
            class: "chart__bar chart__bar--error",
            x: x.toFixed(1),
            y: (padT + innerH - 3).toFixed(1),
            width: barW.toFixed(1),
            height: "3",
          })
        );
      }

      // X 軸ラベルは端と中央のみ（密集を避ける）
      if (i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) {
        var tick = svgEl("text", {
          class: "chart__tick",
          x: (x + barW / 2).toFixed(1),
          y: H - 10,
          "text-anchor": "middle",
        });
        tick.textContent = shortLabel(p.label);
        svg.appendChild(tick);
      }
    });

    return svg;
  }

  function renderLegend(hasMissing) {
    var list = el("ul", { class: "legend" });
    var items = [
      { cls: "legend__swatch", text: "リクエスト数" },
      { cls: "legend__swatch legend__swatch--error", text: "エラーのあった期間（下端の帯）" },
    ];
    if (hasMissing) {
      items.push({ cls: "legend__swatch legend__swatch--missing", text: "データなし（計測していない期間）" });
    }
    items.forEach(function (item) {
      var li = el("li");
      li.appendChild(el("span", { class: item.cls, "aria-hidden": "true" }));
      li.appendChild(document.createTextNode(item.text));
      list.appendChild(li);
    });
    return list;
  }

  function renderTable(points, unitLabel) {
    var details = el("details", { class: "data-table" });
    details.appendChild(el("summary", {}, "数値を表で見る"));
    var table = el("table");
    var thead = el("thead");
    var headRow = el("tr");
    [unitLabel, "リクエスト", "エラー", "サブリクエスト"].forEach(function (label) {
      headRow.appendChild(el("th", { scope: "col" }, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el("tbody");
    points
      .slice()
      .reverse()
      .forEach(function (p) {
        var tr = el("tr");
        tr.appendChild(el("th", { scope: "row" }, p.label));
        if (p.missing) {
          var td = el("td", { colspan: "3" }, "データなし");
          tr.appendChild(td);
        } else {
          tr.appendChild(el("td", {}, num(p.requests)));
          tr.appendChild(el("td", {}, num(p.errors)));
          tr.appendChild(el("td", {}, num(p.subrequests)));
        }
        tbody.appendChild(tr);
      });
    table.appendChild(tbody);
    details.appendChild(table);
    return details;
  }

  function renderPanel(panel, feed) {
    var node = document.getElementById(panel.id);
    if (!node) return;
    var series = (feed.series || {})[panel.key];
    node.textContent = "";

    if (!series || !series.points || !series.points.length) {
      node.appendChild(
        el("p", { class: "panel__status" }, "この粒度のデータがまだありません。")
      );
      return;
    }

    var points = series.points;
    var stats = kpis(points);
    var meta =
      "データ最終更新: " +
      formatJst(series.last_updated) +
      "（静的スナップショット・自動更新なし）";
    if (stats.missing > 0) {
      meta += " ／ " + stats.missing + " " + panel.unit + "分は未計測（斜線で表示）";
    }
    node.appendChild(el("p", { class: "panel__meta" }, meta));
    node.appendChild(renderKpis(stats, panel.unit, feed.free_tier_daily_requests || 100000));
    node.appendChild(renderChart(points, panel.label, panel.key));
    node.appendChild(renderLegend(stats.missing > 0));
    node.appendChild(renderTable(points, panel.label));
  }

  function fail(message) {
    PANELS.forEach(function (panel) {
      var node = document.getElementById(panel.id);
      if (!node) return;
      node.textContent = "";
      node.appendChild(el("p", { class: "panel__status" }, message));
    });
  }

  fetch(FEED_URL, { cache: "no-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (feed) {
      PANELS.forEach(function (panel) {
        renderPanel(panel, feed);
      });
    })
    .catch(function () {
      fail("データを取得できませんでした。時間をおいて再読み込みしてください。");
    });
})();
