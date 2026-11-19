/* Copy buttons and the home page chip picker. */
document.addEventListener('click', function (event) {
  var copy = event.target.closest('[data-copy]');
  if (copy) {
    var original = copy.textContent;
    try { navigator.clipboard.writeText(copy.getAttribute('data-copy')); } catch (error) { /* no clipboard here */ }
    copy.textContent = 'Copied';
    setTimeout(function () { copy.textContent = original; }, 1300);
    return;
  }
  var pick = event.target.closest('[data-pk]');
  if (pick) {
    document.querySelectorAll('[data-pk]').forEach(function (b) { b.setAttribute('aria-pressed', b === pick); });
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== pick.getAttribute('data-pk'); });
    return;
  }
});
