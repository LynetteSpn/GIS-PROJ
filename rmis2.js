// =========================================================================
// 11. SIDEBAR MINIMIZE/EXPAND
// =========================================================================
const sidebar = document.getElementById('side-toolbar');
const minimizeSidebarBtn = document.getElementById('minimize-sidebar');

minimizeSidebarBtn.addEventListener('click', () => { // Toggle sidebar class
  sidebar.classList.toggle('minimized');

  // Change button symbol for clarity, toggle the -/+ sign to indicate action
  if (sidebar.classList.contains('minimized')) { 
    minimizeSidebarBtn.textContent = '+';
    minimizeSidebarBtn.title = 'Show Sidebar';
  } else {
    minimizeSidebarBtn.textContent = '-';
    minimizeSidebarBtn.title = 'Hide Sidebar';
  }
});

// =========================================================================
// 12. TOOLTIP POPUP FOR ROAD INFO
// =========================================================================
// DESKTOP: hover to show popup, click to lock popup
// MOBILE: tap to show and lock popup

// --- Popup setup ---
const popupElement = document.getElementById('road-popup');
const popupContent = document.getElementById('road-popup-content');
const popupCloser = document.getElementById('road-popup-closer');

const popup = new ol.Overlay({
  element: popupElement,
  offset: [10, -10],
  positioning: 'bottom-left',
  stopEvent: true
});
map.addOverlay(popup);

let lockedPopup = false;
let activeFeature = null;

// --- Road info popup function ---
function showRoadInfo(feature, coordinate) {
  const props = feature.getProperties();

  // Skip if it's a district feature
  if (feature.get('layerName') === 'district') {
    return;
  }

  // Build HTML content
  const allowedKeys = ['road_name', 'district_code', 'layer']; // attributes to show
  let html = '<b>Road Information</b><hr>';

  allowedKeys.forEach(key => {
    if (props[key]) {
      const displayKey = key.replace('_', ' ').toUpperCase();
      let value = props[key];

      if (key === 'layer' && value === 'UNID') {
        value = 'Unregistered Road';
      }

      html += `<b>${displayKey}:</b> ${value}<br>`;
    }
  });

  popupContent.innerHTML = html;
  popup.setPosition(coordinate);
  popupElement.style.display = 'block';
}

function hideRoadInfo() {
  popupElement.style.display = 'none';
  popup.setPosition(undefined);
  lockedPopup = false;
  activeFeature = null;
}

popupCloser.onclick = function (evt) {
  evt.preventDefault();
  hideRoadInfo();
};

// --- Hover popup (desktop) ---
map.on('pointermove', function (evt) {
  if (evt.dragging || lockedPopup) return;

  const feature = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
    // Ignore district layer
    if (layer && layer.get('name') === 'DistrictLayer') return null;
    return f;
  });

  if (feature !== activeFeature) {
    activeFeature = feature;
    if (feature) {
      showRoadInfo(feature, evt.coordinate);
    } else {
      hideRoadInfo();
    }
  }
});

// --- Click popup (mobile / locked) ---
map.on('singleclick', function (evt) {
  const feature = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
    // Ignore district layer
    if (layer && layer.get('name') === 'DistrictLayer') return null;
    return f;
  });

  if (feature) {
    showRoadInfo(feature, evt.coordinate);
    activeFeature = feature;
    lockedPopup = true;
  } else {
    hideRoadInfo();
  }
});


// =========================================================================
// 13. LOCATE ME BUTTON 
// =========================================================================

let locationLayer = null;
let locateActive = false; // toggle state

const locateBtn = document.getElementById('locate-btn');

locateBtn.addEventListener('click', () => {
  // Toggle state
  locateActive = !locateActive;

  if (locateActive) {
    locateBtn.classList.add('active');

    // Check if geolocation available
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = [pos.coords.longitude, pos.coords.latitude];
          const transformed = ol.proj.fromLonLat(coords);

          // Remove old layer if exists
          if (locationLayer) {
            map.removeLayer(locationLayer);
          }

          // Create new marker
          const marker = new ol.Feature({
            geometry: new ol.geom.Point(transformed),
          });

          const markerStyle = new ol.style.Style({
            image: new ol.style.Circle({
              radius: 6,
              fill: new ol.style.Fill({ color: 'rgba(0, 150, 255, 0.9)' }),
              stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 }),
            }),
          });
          marker.setStyle(markerStyle);

          // Create new vector layer for marker
          locationLayer = new ol.layer.Vector({
            source: new ol.source.Vector({
              features: [marker],
            }),
          });
          map.addLayer(locationLayer);

          // Animate zoom to user position
          map.getView().animate({
            center: transformed,
            zoom: 16,
            duration: 1000,
          });
        },
        (error) => {
          // Handle error properly
          let msg = '';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              msg = 'Location permission denied.';
              break;
            case error.POSITION_UNAVAILABLE:
              msg = 'Location unavailable.';
              break;
            case error.TIMEOUT:
              msg = 'Location request timed out.';
              break;
            default:
              msg = 'Unable to retrieve location.';
          }
          alert(msg);
          locateBtn.classList.remove('active');
          locateActive = false;
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    } else {
      alert('Geolocation not supported on this device.');
      locateBtn.classList.remove('active');
      locateActive = false;
    }
  } else {
    // If toggled off, remove marker and layer
    locateBtn.classList.remove('active');
    if (locationLayer) {
      map.removeLayer(locationLayer);
      locationLayer = null;
    }
  }
});


