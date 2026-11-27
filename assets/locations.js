// Cabinet cards: a small swipeable carousel of photos and a map for each café.
//
// Each card's media looks like:
//   <div class="location-media">
//     <div class="location-slides">
//       <img class="location-slide" src="…" alt="…">                      (one per photo)
//       <div class="location-slide location-map" data-lat="…" data-lon="…" data-name="…"></div>
//     </div>
//   </div>
// This adds the arrows and dots, and loads the map (OpenStreetMap: free, no account or key)
// once the card is near the screen.
(function () {
  'use strict';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function addMap(box) {
    var lat = parseFloat(box.getAttribute('data-lat'));
    var lon = parseFloat(box.getAttribute('data-lon'));
    if (isNaN(lat) || isNaN(lon) || box.querySelector('iframe')) return;
    var dLon = 0.0022, dLat = 0.0008; // a few streets around the pin
    var bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(function (n) { return n.toFixed(5); }).join(',');
    var frame = document.createElement('iframe');
    frame.src = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox +
      '&layer=mapnik&marker=' + lat.toFixed(5) + ',' + lon.toFixed(5);
    frame.title = 'Map showing ' + (box.getAttribute('data-name') || 'the café');
    box.appendChild(frame);
  }

  function button(cls, label, path) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'location-media-btn ' + cls;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return b;
  }

  document.querySelectorAll('.location-media').forEach(function (media) {
    var track = media.querySelector('.location-slides');
    var slides = track ? track.querySelectorAll('.location-slide') : [];
    var maps = media.querySelectorAll('.location-map');

    // Load maps only when the card comes near the screen
    if (maps.length) {
      var load = function () { maps.forEach(addMap); };
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          if (entries.some(function (e) { return e.isIntersecting; })) { load(); io.disconnect(); }
        }, { rootMargin: '300px' });
        io.observe(media);
      } else {
        load();
      }
    }

    if (slides.length < 2) return;

    var prev = button('location-media-prev', 'Previous', 'M15 5l-7 7 7 7');
    var next = button('location-media-next', 'Next', 'M9 5l7 7-7 7');
    var dots = document.createElement('div');
    dots.className = 'location-dots';
    var dotButtons = Array.prototype.map.call(slides, function (slide, i) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'location-dot' + (slide.classList.contains('location-map') ? ' is-map' : '');
      d.setAttribute('aria-label', slide.classList.contains('location-map') ? 'Show map' : 'Show photo ' + (i + 1));
      d.addEventListener('click', function () { go(i); });
      dots.appendChild(d);
      return d;
    });
    media.appendChild(prev);
    media.appendChild(next);
    media.insertAdjacentElement('afterend', dots);

    // Where the track has to scroll to for each slide (slides are narrower than the card)
    function target(i) {
      var pad = parseFloat(getComputedStyle(track).paddingLeft) || 0;
      return Math.min(slides[i].offsetLeft - pad, track.scrollWidth - track.clientWidth);
    }
    function current() {
      var best = 0;
      for (var i = 1; i < slides.length; i++) {
        if (Math.abs(target(i) - track.scrollLeft) < Math.abs(target(best) - track.scrollLeft)) best = i;
      }
      return best;
    }
    function go(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      track.scrollTo({ left: target(i), behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    function update() {
      var i = current();
      prev.hidden = i === 0;
      next.hidden = i === slides.length - 1;
      dotButtons.forEach(function (d, j) { d.setAttribute('aria-current', j === i ? 'true' : 'false'); });
      // The half-visible slides at the sides: tapping one brings it into view
      Array.prototype.forEach.call(slides, function (slide, j) { slide.classList.toggle('is-peek', j !== i); });
    }
    Array.prototype.forEach.call(slides, function (slide, j) {
      slide.addEventListener('click', function () { if (slide.classList.contains('is-peek')) go(j); });
    });
    prev.addEventListener('click', function () { go(current() - 1); });
    next.addEventListener('click', function () { go(current() + 1); });
    track.addEventListener('scroll', function () { window.requestAnimationFrame(update); }, { passive: true });
    window.addEventListener('resize', update);
    update();
  });
})();
