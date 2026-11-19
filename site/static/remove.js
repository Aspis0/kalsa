/* The removal confirmation page. /api/page answers on a fresh load, including for a removed page
   the signed-in owner may undo, so Undo does not depend on the tab that made the removal. */
(function () {
  var params = new URLSearchParams(location.search);
  var kind = params.get('kind');
  var id = params.get('id');
  var status = document.getElementById('remove-status');
  var title = document.getElementById('remove-title');
  var signIn = document.getElementById('remove-signin');
  var confirm = document.getElementById('remove-confirm');
  var undo = document.getElementById('remove-undo');
  var help = document.getElementById('remove-help');
  var org = document.getElementById('remove-org');
  var label = '';

  function say(text) { status.textContent = text; }

  function show(element, on) { element.hidden = !on; }

  function send(path, body) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (answer) {
        return { ok: response.ok, status: response.status, answer: answer };
      });
    });
  }

  function askGitHub(message) {
    say(message);
    signIn.setAttribute('href', '/auth/github/start?next=' + encodeURIComponent(location.pathname + location.search));
    show(signIn, true);
    show(confirm, false);
    show(undo, false);
  }

  function offerUndo(message) {
    say(message);
    show(signIn, false);
    show(confirm, false);
    show(undo, true);
  }

  function refused(result) {
    var error = result.answer && result.answer.error;
    if (result.status === 401) { askGitHub('Sign in with GitHub to manage this page.'); return; }
    if (result.status === 429) { say('Too many attempts. Try again in an hour.'); return; }
    if (result.status === 404 && error === 'not_removed') { say('This page is not removed.'); return; }
    if (result.status === 404) { say('No page matches that address.'); return; }
    if (result.status === 502) { say('GitHub could not be reached. Try again in a moment.'); return; }
    if (result.status === 403 && error === 'github_missing') {
      say('No repository or account matches on GitHub.');
      show(help, true);
      show(confirm, false);
      return;
    }
    if (result.status === 403 && error === 'organisation') {
      say('This page belongs to an organisation.');
      show(org, true);
      show(confirm, false);
      return;
    }
    if (result.status === 403 && error === 'not_remover') { say('Only the account that removed this page can put it back.'); return; }
    if (result.status === 403) {
      say('This account does not own that page.');
      show(help, true);
      show(confirm, false);
      return;
    }
    say('That did not complete. Try again.');
  }

  function decide(path, done) {
    confirm.disabled = true;
    undo.disabled = true;
    send(path, { kind: kind, id: id }).then(function (result) {
      confirm.disabled = false;
      undo.disabled = false;
      if (!result.ok) { refused(result); return; }
      show(help, false);
      show(org, false);
      done();
    }, function () {
      confirm.disabled = false;
      undo.disabled = false;
      say('That did not complete. Try again.');
    });
  }

  confirm.addEventListener('click', function () {
    decide('/api/remove', function () { offerUndo('This page was removed. It is off the site now.'); });
  });

  undo.addEventListener('click', function () {
    decide('/api/undo', function () {
      say('This page is back.');
      show(undo, false);
      show(confirm, true);
    });
  });

  function loaded(entry) {
    label = entry.name;
    if (entry.removed) {
      title.textContent = label + ' was removed';
      offerUndo('This page was removed at its owner’s request. You can put it back.');
      return;
    }
    title.textContent = 'Remove ' + label + '?';
    fetch('/api/me', { credentials: 'same-origin' }).then(function (response) {
      return response.ok ? response.json() : null;
    }).then(function (account) {
      if (!account || account.provider !== 'github') {
        askGitHub(account ? 'This needs GitHub. You are signed in with ' + account.provider + '.' : 'Sign in with GitHub to remove this page.');
        return;
      }
      say('You are signed in as ' + account.username + '. Removing ' + label + ' takes it off the site at once.');
      show(confirm, true);
    }).catch(function () { askGitHub('Sign in with GitHub to remove this page.'); });
  }

  if ((kind !== 'engine' && kind !== 'developer') || !id) { say('That address names no page.'); return; }

  fetch('/api/page?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(id), { credentials: 'same-origin' })
    .then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (answer) {
        return { ok: response.ok, status: response.status, answer: answer };
      });
    })
    .then(function (result) {
      if (result.ok) { loaded(result.answer); return; }
      if (result.status === 401) { askGitHub('This page was removed at its owner’s request. Sign in with GitHub to put it back.'); return; }
      refused(result);
    })
    .catch(function () { say('The page could not be read. Try again.'); });
})();
