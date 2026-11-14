/* AMK Digital Agency: Website Comparison Engine
   Runs side-by-side comparative analysis of two domains using verified
   crawl, Open PageRank, SSL, and registry data. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function cleanDomain(input) {
    return (input || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '');
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function formatRank(rank) {
    if (!rank || rank.rank_decimal == null) return 'N/A';
    return rank.rank_decimal + ' / 10' + (rank.rank_integer ? ' (Rank #' + Number(rank.rank_integer).toLocaleString('en-US') + ')' : '');
  }

  function formatAge(reg) {
    if (!reg || !reg.created) return 'Unknown';
    var parts = [];
    if (reg.age_years) parts.push(reg.age_years + ' yr' + (reg.age_years === 1 ? '' : 's'));
    parts.push('(' + reg.created.slice(0, 10) + ')');
    return parts.join(' ');
  }

  function formatSSL(sec) {
    if (!sec || !sec.ssl) return 'Not configured';
    var ssl = sec.ssl;
    return (ssl.valid ? '✓ Valid TLS' : '✗ Invalid') + (ssl.days_remaining ? ' (' + ssl.days_remaining + ' days left)' : '');
  }

  function formatTech(sec) {
    if (!sec || !sec.tech_stack || !sec.tech_stack.items) return 'Standard Web Server';
    var items = sec.tech_stack.items;
    return items.length > 0 ? items.slice(0, 3).join(', ') : 'Standard Web Server';
  }

  function renderComparison(d1Name, data1, d2Name, data2) {
    $('cmp-meta').textContent = 'Comparison: ' + d1Name + ' vs ' + d2Name + ' · Generated in real time';

    var site1 = data1.site || {}, site2 = data2.site || {};
    var rank1 = data1.rank || {}, rank2 = data2.rank || {};
    var reg1 = data1.registration || {}, reg2 = data2.registration || {};
    var sec1 = (site1.available && site1.sections) || {};
    var sec2 = (site2.available && site2.sections) || {};

    var score1 = site1.score != null ? site1.score : 0;
    var score2 = site2.score != null ? site2.score : 0;
    var opr1 = (rank1.rank_decimal != null) ? rank1.rank_decimal : 0;
    var opr2 = (rank2.rank_decimal != null) ? rank2.rank_decimal : 0;

    // Summary Cards
    var summaryCards = $('cmp-summary-cards');
    summaryCards.textContent = '';

    // Overall SEO Health card
    var cardHealth = node('div', 'card');
    cardHealth.appendChild(node('div', 'label', 'SEO Health Score Leader'));
    var healthWinner = score1 > score2 ? d1Name : (score2 > score1 ? d2Name : 'Tied');
    var healthVal = score1 + ' vs ' + score2;
    cardHealth.appendChild(node('div', 'value good', healthWinner));
    cardHealth.appendChild(node('div', 'note', healthVal + ' points (On-page health)'));
    summaryCards.appendChild(cardHealth);

    // Authority Leader card
    var cardAuth = node('div', 'card');
    cardAuth.appendChild(node('div', 'label', 'Authority Rank Leader'));
    var authWinner = opr1 > opr2 ? d1Name : (opr2 > opr1 ? d2Name : (opr1 > 0 ? 'Tied' : 'Pending verification'));
    cardAuth.appendChild(node('div', 'value ' + (opr1 || opr2 ? 'good' : ''), authWinner));
    cardAuth.appendChild(node('div', 'note', (opr1 || 'N/A') + ' vs ' + (opr2 || 'N/A') + ' (Open PageRank)'));
    summaryCards.appendChild(cardAuth);

    // Grid Side-by-side Columns
    var grid = $('cmp-grid');
    grid.textContent = '';

    function buildColumn(dName, site, rank, reg, sec, isScoreWinner, isRankWinner) {
      var col = node('div', 'compare-col');
      var head = node('div', 'compare-col-header');
      var h3 = node('h3', '', dName);
      head.appendChild(h3);
      col.appendChild(head);

      function addRow(label, value, isWin) {
        var r = node('div', 'compare-stat-row');
        r.appendChild(node('span', 'compare-stat-key', label));
        var valSpan = node('span', 'compare-stat-val', value);
        if (isWin) {
          valSpan.appendChild(node('span', 'winner-badge', 'LEADER'));
        }
        r.appendChild(valSpan);
        col.appendChild(r);
      }

      addRow('SEO Health Score', (site.score != null ? site.score + ' / 100 (Grade ' + (site.grade || 'C') + ')' : 'Unavailable'), isScoreWinner);
      addRow('Open PageRank', formatRank(rank), isRankWinner);
      addRow('Domain Age', formatAge(reg), reg.age_years && ((reg.age_years > ((reg1.age_years === reg.age_years ? reg2.age_years : reg1.age_years) || 0))));
      addRow('SSL & Security', formatSSL(sec), false);
      addRow('Technology Stack', formatTech(sec), false);
      addRow('Total Issues Found', site.total_issues != null ? site.total_issues + ' issue(s)' : 'N/A', false);
      addRow('H1 Heading Outline', (sec.on_page && sec.on_page.h1_count != null ? sec.on_page.h1_count + ' H1 tag(s)' : 'Checked'), false);
      addRow('Structured Data', (sec.structured_data && sec.structured_data.found ? 'Declared' : 'None detected'), false);

      return col;
    }

    var col1 = buildColumn(d1Name, site1, rank1, reg1, sec1, score1 > score2, opr1 > opr2);
    var col2 = buildColumn(d2Name, site2, rank2, reg2, sec2, score2 > score1, opr2 > opr1);

    grid.appendChild(col1);
    grid.appendChild(col2);

    $('cmp-result').hidden = false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = $('cmp-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var d1 = cleanDomain($('cmp-d1').value);
      var d2 = cleanDomain($('cmp-d2').value);

      var errEl = $('cmp-error');
      errEl.hidden = true;
      $('cmp-result').hidden = true;

      if (!d1 || !d2) {
        errEl.textContent = 'Please enter both domain names to compare.';
        errEl.hidden = false;
        return;
      }
      if (d1 === d2) {
        errEl.textContent = 'Please enter two distinct domains to run a comparison.';
        errEl.hidden = false;
        return;
      }

      var loadingEl = $('cmp-loading');
      var runBtn = $('cmp-run');
      loadingEl.hidden = false;
      runBtn.disabled = true;

      try {
        if (!window.toolsClient || typeof window.toolsClient.runTool !== 'function') {
          throw new Error('Comparison service client is loading. Please try again.');
        }

        var results = await Promise.all([
          window.toolsClient.runTool('domain-overview', { domain: d1 }),
          window.toolsClient.runTool('domain-overview', { domain: d2 })
        ]);

        loadingEl.hidden = true;
        runBtn.disabled = false;
        renderComparison(d1, results[0], d2, results[1]);
      } catch (err) {
        loadingEl.hidden = true;
        runBtn.disabled = false;
        errEl.textContent = err.message || 'Could not complete website comparison. Please try again.';
        errEl.hidden = false;
      }
    });
  });
})();
