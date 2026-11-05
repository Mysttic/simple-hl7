/* simple-hl7 project page: the light and dark theme, and the download buttons filled from the
 * latest release on GitHub. Load it synchronously from <head>: the theme is applied before the
 * first paint, the downloads wait for the document.
 */

/* Theme. The page follows the operating system on its own; the toggle in the header only
   overrides it, and the override is remembered per browser. */
(function () {
  var KEY = 'mysttic-theme';
  var MODES = ['system', 'light', 'dark'];
  var LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' };
  var TITLE = {
    system: 'Theme follows your system, click for light',
    light: 'Light theme, click for dark',
    dark: 'Dark theme, click to follow your system'
  };

  function stored() {
    try {
      var saved = localStorage.getItem(KEY);
      return MODES.indexOf(saved) > -1 ? saved : 'system';
    } catch (e) {
      return 'system'; // private mode, or site data blocked
    }
  }

  function apply(mode) {
    var root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
  }

  var mode = stored();
  apply(mode);

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.querySelector('[data-theme-toggle]');
    if (!button) return;
    function paint() {
      button.textContent = LABEL[mode];
      button.title = TITLE[mode];
      button.setAttribute('aria-label', TITLE[mode]);
    }
    paint();
    button.hidden = false; // the markup hides it, so no dead button without JavaScript
    button.addEventListener('click', function () {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem(KEY, mode); } catch (e) { /* nothing to do */ }
      apply(mode);
      paint();
    });
  });
})();

/* Downloads. Every element with data-download="<id>" gets the link of its file, data-size="<id>"
   its name and size, data-release-version and data-release-date the release itself. The file
   names come from scripts/build-exe.mjs and the release workflow; only their endings are matched.
   When GitHub cannot be asked (offline, or the 60 requests an hour per address are spent), every
   button links to the releases page instead, so there is always a way to download.
   A copy of the page served from elsewhere can read another repository's releases by setting
   window.RELEASES_SOURCE = { repo, tagPrefix } before this script, e.g. the hub's copies
   ({ repo: 'Mysttic/Mysttic', tagPrefix: 'simple-hl7-v' }) while this repository is private. */
(function () {
  var source = Object.assign({ repo: 'Mysttic/simple-hl7', tagPrefix: 'v' }, window.RELEASES_SOURCE || {});
  var FILES = [
    { id: 'win', match: /-windows-amd64\.exe$/ },
    { id: 'linux', match: /-linux-amd64$/ },
    { id: 'sums', match: /-checksums\.txt$/ }
  ];

  function each(selector, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), fn);
  }

  function formatSize(bytes) {
    var mb = bytes / (1024 * 1024);
    return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  function versionOf(release) {
    return release.tag_name.slice(source.tagPrefix.length).replace(/^v/, '');
  }

  /* X.Y.Z as three numbers, or null for any other shape. */
  function semver(version) {
    var m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    return m ? m.slice(1).map(Number) : null;
  }

  /* The highest X.Y.Z among published releases with the prefix; between other tags, the newest. */
  function latest(all) {
    var ours = all.filter(function (r) {
      return r && !r.draft && !r.prerelease && typeof r.tag_name === 'string' &&
        r.tag_name.indexOf(source.tagPrefix) === 0 && /^\d/.test(r.tag_name.slice(source.tagPrefix.length));
    });
    if (!ours.length) return null;
    var when = function (r) { return Date.parse(r.published_at || r.created_at) || 0; };
    return ours.reduce(function (best, r) {
      var a = semver(versionOf(r));
      var b = semver(versionOf(best));
      var i = a && b ? a.findIndex(function (n, k) { return n !== b[k]; }) : -1;
      var newer = i >= 0 ? a[i] > b[i] : when(r) > when(best);
      return newer ? r : best;
    });
  }

  function fill(release) {
    each('[data-release-version]', function (el) { el.textContent = 'v' + versionOf(release); });
    if (release.published_at) {
      var date = new Date(release.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      each('[data-release-date]', function (el) { el.textContent = date; });
    }
    FILES.forEach(function (file) {
      var asset = (release.assets || []).find(function (a) { return file.match.test(a.name); });
      each('[data-download="' + file.id + '"]', function (el) {
        if (!asset) return;
        el.href = asset.browser_download_url;
        el.removeAttribute('aria-disabled');
      });
      each('[data-size="' + file.id + '"]', function (el) {
        el.textContent = asset ? asset.name + ' · ' + formatSize(asset.size) : 'Not in this release';
      });
    });
  }

  function linkToReleasesPage() {
    var page = 'https://github.com/' + source.repo + '/releases/latest';
    each('[data-release-version]', function (el) { el.textContent = 'see GitHub'; });
    each('[data-download]', function (el) {
      el.href = page;
      el.removeAttribute('aria-disabled');
    });
  }

  function run() {
    fetch('https://api.github.com/repos/' + source.repo + '/releases?per_page=30', {
      headers: { Accept: 'application/vnd.github+json' }
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (all) {
        var release = Array.isArray(all) ? latest(all) : null;
        if (!release) throw new Error('no release');
        fill(release);
      })
      .catch(linkToReleasesPage);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
