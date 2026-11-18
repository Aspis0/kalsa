/* The nav account item: /api/me decides whether it stays "Sign in" or becomes the avatar, the username and Sign out. */
(function () {
  var slot = document.querySelector('[data-account]');
  if (!slot) return;

  function signOut() {
    fetch('/auth/signout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function () { location.reload(); }, function () { location.reload(); });
  }

  /* An avatar is set as a src only when it is https, and only through setAttribute: no markup is built from the answer. */
  function avatar(account) {
    if (typeof account.avatar !== 'string' || account.avatar.indexOf('https://') !== 0) return null;
    var span = document.createElement('span');
    span.className = 'av sm';
    span.setAttribute('data-i', account.username.charAt(0).toUpperCase());
    var img = document.createElement('img');
    img.setAttribute('src', account.avatar);
    img.setAttribute('alt', '');
    span.appendChild(img);
    return span;
  }

  fetch('/api/me', { credentials: 'same-origin' }).then(function (response) {
    return response.ok ? response.json() : null;
  }).then(function (account) {
    if (!account || !account.username) return;
    slot.textContent = account.username;
    slot.removeAttribute('href');
    slot.setAttribute('title', 'Signed in with ' + account.provider);
    var picture = avatar(account);
    if (picture) slot.parentNode.insertBefore(picture, slot);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn two sm2';
    button.textContent = 'Sign out';
    button.addEventListener('click', signOut);
    slot.parentNode.insertBefore(button, slot.nextSibling);
  }).catch(function () { /* signed out, or the endpoint is unreachable: the link stays as it is */ });
})();
