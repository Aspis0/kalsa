/* Filters for the engines page. Cards are in the HTML; engines.json says which ones match. */
(function () {
  var list = document.getElementById('list');
  var cards = [].slice.call(list.children);
  /* A new object every time: "Clear filters" must not share the hardware chips with the state it replaces. */
  function fresh() { return { hw: {}, kind: 'all', lic: 'all', imp: 'all', q: '', sort: 'name', listing: 'listed', badge: 'any' }; }
  var state = fresh();
  var rows = {};
  var params = new URLSearchParams(location.search);
  if (params.get('hw')) state.hw[params.get('hw')] = 1;

  function matches(row) {
    var chosen = Object.keys(state.hw);
    if (state.listing !== 'listed') return false;
    if (state.badge !== 'any' && row.badge !== state.badge) return false;
    if (chosen.length && !chosen.some(function (tag) { return row.hardware.indexOf(tag) > -1; })) return false;
    if (state.kind !== 'all' && row.kind !== state.kind) return false;
    if (state.lic !== 'all' && row.license !== state.lic) return false;
    if (state.imp !== 'all' && row.improvements.indexOf(state.imp) < 0) return false;
    return !state.q || row.text.indexOf(state.q) > -1;
  }

  function order(a, b) {
    var x = rows[a.dataset.id], y = rows[b.dataset.id];
    return state.sort === 'recent' ? y.index - x.index : x.name.localeCompare(y.name);
  }

  function run() {
    var shown = 0;
    cards.forEach(function (card) { var ok = matches(rows[card.dataset.id]); card.hidden = !ok; if (ok) shown += 1; });
    cards.slice().sort(order).forEach(function (card) { list.appendChild(card); });
    document.getElementById('count').textContent = shown + ' engines shown';
    document.getElementById('empty').hidden = shown > 0;
    document.querySelectorAll('.pillb').forEach(function (b) { b.setAttribute('aria-pressed', !!state.hw[b.dataset.hw]); });
    ['listing', 'badge', 'kind'].forEach(function (id) {
      document.querySelectorAll('#' + id + ' button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === state[id]); });
    });
  }

  function listen() {
    document.getElementById('hw').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (state.hw[b.dataset.hw]) delete state.hw[b.dataset.hw]; else state.hw[b.dataset.hw] = 1;
      run();
    });
    ['listing', 'badge', 'kind'].forEach(function (id) {
      document.getElementById(id).addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b || b.disabled) return; state[id] = b.dataset.v; run();
      });
    });
    document.getElementById('imp').addEventListener('change', function (e) { state.imp = e.target.value; run(); });
    document.getElementById('lic').addEventListener('change', function (e) { state.lic = e.target.value; run(); });
    document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; run(); });
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); run(); });
    document.getElementById('clear').addEventListener('click', function () {
      var sort = state.sort;
      state = fresh();
      state.sort = sort;
      document.getElementById('q').value = ''; document.getElementById('lic').value = 'all'; document.getElementById('imp').value = 'all'; run();
    });
  }

  fetch('engines.json').then(function (r) { return r.json(); }).then(function (data) {
    data.forEach(function (row) { rows[row.id] = row; });
    listen();
    run();
  }).catch(function () { /* opened from a file: every card stays visible */ });
})();
