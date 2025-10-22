// Make sure this runs AFTER the 'map' is created in rmis.js
map.on('pointermove', function (evt) {
  const coord = ol.proj.toLonLat(evt.coordinate);
  const lon = coord[0].toFixed(5);
  const lat = coord[1].toFixed(5);

  document.getElementById('coords').innerHTML = `Lat: ${lat}, Lng: ${lon}`;
});
