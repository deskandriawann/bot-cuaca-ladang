// Perilaku kecil halaman pengelola. Dimuat sebagai berkas di <head>, tanpa skrip sisipan, agar kebijakan
// keamanan (Content-Security-Policy) bisa melarang semua skrip sisipan di halaman.
(function () {
  var root = document.documentElement;

  // Layar memuat: tampil sampai halaman siap, dan lagi saat pindah halaman atau menekan tombol.
  // Halaman yang memuat ulang sendiri (QR penautan) bertanda data-no-loader agar QR tidak tertutup.
  if (!root.hasAttribute('data-no-loader')) {
    root.classList.add('loading');
    var done = function () { root.classList.remove('loading'); };
    var cap = setTimeout(done, 4000);
    addEventListener('load', function () { clearTimeout(cap); done(); });
    addEventListener('pageshow', function (e) { if (e.persisted) done(); });
  }
  document.addEventListener('submit', function (e) {
    if (!e.defaultPrevented) root.classList.add('loading');
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target || a.origin !== location.origin || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (a.hash && a.pathname === location.pathname && a.search === location.search) return;
    root.classList.add('loading');
  });

  // Tombol salin: data-copy = id teks yang disalin, data-copied = id tempat tanda "Tersalin"
  document.addEventListener('click', function (e) {
    var button = e.target.closest && e.target.closest('[data-copy]');
    if (!button) return;
    var text = document.getElementById(button.getAttribute('data-copy'));
    var mark = function () {
      var target = document.getElementById(button.getAttribute('data-copied'));
      if (target) target.textContent = 'Tersalin';
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text.textContent).then(mark);
      return;
    }
    // Lewat HTTP biasa clipboard modern tidak tersedia: pilih teksnya lalu salin cara lama
    var range = document.createRange();
    range.selectNodeContents(text);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (document.execCommand('copy')) mark();
    selection.removeAllRanges();
  });

  // Centang "Tampilkan kata sandi": data-show-password = id kotak kata sandi
  document.addEventListener('change', function (e) {
    var box = e.target.closest && e.target.closest('[data-show-password]');
    if (!box) return;
    var input = document.getElementById(box.getAttribute('data-show-password'));
    if (input) input.type = box.checked ? 'text' : 'password';
  });

  // Video spanduk: hanya di layar lebar, tidak saat hemat data atau gerak dikurangi; beberapa video diputar bergantian
  document.addEventListener('DOMContentLoaded', function () {
    var video = document.querySelector('.hero-video');
    var list = video ? JSON.parse(video.dataset.videos) : [];
    if (!list.length || (navigator.connection && navigator.connection.saveData)) return;
    if (!matchMedia('(min-width: 860px)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var i = 0;
    video.muted = true;
    video.loop = list.length === 1;
    video.addEventListener('ended', function () {
      i = (i + 1) % list.length;
      video.src = list[i];
      video.play().catch(function () {});
    });
    video.src = list[0];
    video.play().catch(function () {});
  });
})();
