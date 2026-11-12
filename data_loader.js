/* Turns the data files (models.js, manifest.js ...) into the <script id="models"> ... elements that app.js reads. */
(function () {
  var types = { models: 'application/json', manifest: 'application/json', static: 'application/json', refc: 'application/json', blob: 'text/plain' };
  Object.keys(types).forEach(function (id) {
    var el = document.createElement('script');
    el.id = id; el.type = types[id]; el.textContent = window.FM_DATA[id];
    document.head.appendChild(el);
  });
})();
