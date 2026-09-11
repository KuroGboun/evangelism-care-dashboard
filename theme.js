/**
 * Light or dark, chosen by a button and remembered in this browser.
 *
 * A classic script, loaded in <head> on purpose: it runs before the first
 * paint, so a reader who chose dark never sees a flash of light. Light is the
 * default; the OS setting is not consulted. Flipping the theme dispatches
 * 'ec:theme' on the document so the charts can redraw in the new colours.
 */
(function () {
  var KEY = 'ec-pastor-dashboard:theme';
  var root = document.documentElement;

  function read() {
    try {
      return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  function apply(theme) {
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    document.querySelectorAll('.theme-btn').forEach(function (button) {
      var dark = theme === 'dark';
      button.textContent = dark ? 'Light mode' : 'Dark mode';
      button.setAttribute('aria-pressed', dark ? 'true' : 'false');
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  function set(theme) {
    apply(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      // Storage blocked: the choice lasts for this page only.
    }
    document.dispatchEvent(new CustomEvent('ec:theme', { detail: theme }));
  }

  apply(read());

  document.addEventListener('DOMContentLoaded', function () {
    apply(read());
    document.querySelectorAll('.theme-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        set(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      });
    });
  });
})();
