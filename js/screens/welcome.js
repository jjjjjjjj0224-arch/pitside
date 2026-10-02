// First launch: ask for the user's name (used as the author of each entry).

import { saveSettings } from '../settings.js';
import { go } from '../router.js';

export function renderWelcome(el) {
  el.innerHTML = `
    <main class="page welcome">
      <img class="welcome-logo" src="icons/icon-192.png" alt="" width="96" height="96">
      <h1>Welcome to PitSide</h1>
      <form class="stack" novalidate>
        <label class="label" for="welcome-name">What's your name?</label>
        <input id="welcome-name" class="input" type="text" autocomplete="name"
               autocapitalize="words" maxlength="60" enterkeyhint="go" required>
        <p class="form-error" role="alert" hidden>Type your name to continue.</p>
        <p class="note">Entries are saved only on this phone. Nothing is uploaded.</p>
        <button type="submit" class="btn btn-primary btn-block">Start</button>
      </form>
    </main>`;

  const form = el.querySelector('form');
  const input = el.querySelector('#welcome-name');
  const error = el.querySelector('.form-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) {
      error.hidden = false;
      input.focus();
      return;
    }
    await saveSettings({ author: name });
    go('#/home', { replace: true });
  });
}
