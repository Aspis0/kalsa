/* Filters for the engines page: the tier, the chip, and a text search. Cards are in the HTML; engines.json says which match. */
(function () {
  var list = document.getElementById('list');
  var cards = [].slice.call(list.children);
  /* A new object every time: "Clear filters" must not share the hardware chips with the state it replaces. */
  function fresh() { return { hw: {}, listing: 'all', q: '' }; }
  var state = fresh();
  var rows = {};
  var params = new URLSearchParams(location.search);
  if (params.get('hw')) state.hw[params.get('hw')] = 1;
  if (params.get('listing')) state.listing = params.get('listing');

  function matches(row) {
    var chosen = Object.keys(state.hw);
    if (state.listing !== 'all' && row.listing !== state.listing) return false;
    if (chosen.length && !chosen.some(function (tag) { return row.hardware.indexOf(tag) > -1; })) return false;
    return !state.q || row.text.indexOf(state.q) > -1;
  }

  function run() {
    var shown = 0;
    cards.forEach(function (card) { var ok = matches(rows[card.dataset.id]); card.hidden = !ok; if (ok) shown += 1; });
    document.getElementById('count').textContent = shown + ' engines shown';
    document.getElementById('empty').hidden = shown > 0 || state.listing === 'community';
    document.getElementById('empty-community').hidden = shown > 0 || state.listing !== 'community';
    document.querySelectorAll('.pillb').forEach(function (b) { b.setAttribute('aria-pressed', !!state.hw[b.dataset.hw]); });
    document.querySelectorAll('#listing button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === state.listing); });
  }

  function listen() {
    document.getElementById('hw').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (state.hw[b.dataset.hw]) delete state.hw[b.dataset.hw]; else state.hw[b.dataset.hw] = 1;
      run();
    });
    document.getElementById('listing').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; state.listing = b.dataset.v; run();
    });
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); run(); });
    document.getElementById('clear').addEventListener('click', function () {
      state = fresh();
      document.getElementById('q').value = '';
      run();
    });
  }

  fetch('engines.json').then(function (r) { return r.json(); }).then(function (data) {
    data.forEach(function (row) { rows[row.id] = row; });
    listen();
    run();
  }).catch(function () { /* opened from a file: every card stays visible */ });
})();
