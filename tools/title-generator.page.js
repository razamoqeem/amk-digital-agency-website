/* Moved out of title-generator.html so the page works under the strict security policy. */

    function runTitleGenerator() {
      var kw = document.getElementById('focusKeyword').value.trim();
      var container = document.getElementById('title-results-container');
      var resultsDiv = document.getElementById('title-results');
      if (!kw) {
        alert('Please enter a focus keyword first.');
        return;
      }
      container.style.display = 'block';
      var secondaryVal = document.getElementById('secondaryKeywords').value.trim();
      var results = window.AMKTitleGenerator.generateTitles({
        keyword: kw,
        audience: document.getElementById('audience').value,
        contentType: document.getElementById('contentType').value,
        secondary: secondaryVal ? secondaryVal.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : []
      });
      window.AMKTitleGenerator.renderTitles(resultsDiv, results);
      container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  

/* Buttons that used onclick="fn()" now carry data-run="fn". */
document.querySelectorAll('[data-run]').forEach(function (el) {
  el.addEventListener('click', function (e) { var fn = window[el.getAttribute('data-run')]; if (typeof fn === 'function') fn(e); });
});
