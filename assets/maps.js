// Small location maps on the cabinet cards, from OpenStreetMap (free, no account or key).
// Each card has <div class="location-map" data-lat="…" data-lon="…" data-name="…"></div>,
// which this turns into a map with a pin on the café.
(function () {
  'use strict';
  document.querySelectorAll('.location-map[data-lat][data-lon]').forEach(function (box) {
    var lat = parseFloat(box.getAttribute('data-lat'));
    var lon = parseFloat(box.getAttribute('data-lon'));
    if (isNaN(lat) || isNaN(lon)) return;
    var dLon = 0.0022, dLat = 0.0008; // a few streets around the pin
    var bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(function (n) { return n.toFixed(5); }).join(',');

    var frame = document.createElement('iframe');
    frame.src = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox +
      '&layer=mapnik&marker=' + lat.toFixed(5) + ',' + lon.toFixed(5);
    frame.title = 'Map showing ' + (box.getAttribute('data-name') || 'the café');
    frame.loading = 'lazy';
    box.appendChild(frame);
  });
})();
