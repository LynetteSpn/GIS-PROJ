// const tooltipElement = document.getElementById('road-tooltip');
// const tooltip = new ol.Overlay({
//     element: tooltipElement,
//     offset: [10, 0],
//     positioning: 'bottom-left'
// });
// map.addOverlay(tooltip);
// map.on('pointermove', function (evt){
//     if (evt.dragging){
//         tooltipElement.style.display = 'none';
//         return;
//     }
// const pixel = map.getEventPixel(evt.originalEvent);
// const feature = map.forEachFeatureAtPixel(pixel, function (feature, layer){
//     if(layer && layer.get('name')==='roadLayer'){
//         return feature;
//     }
// });

// const { act } = require("react");

// if (feature){
//     const roadName = feature.get('road_name') || feature.get('name') || 'Unknown Road';
//     tooltipElement.innerHTML = roadName;
//     tooltip.setPosition(evt.coordinate);
//     tooltipElement.style.display = 'block';
// } else {
//     tooltipElement.style.display = 'none';
// }
// });

// Sidebar minimize/maximize toggle
const sidebar = document.getElementById('side-toolbar');
const minimizeSidebarBtn = document.getElementById('minimize-sidebar');

minimizeSidebarBtn.addEventListener('click', () => {
  sidebar.classList.toggle('minimized');

  // Change button symbol for clarity
  if (sidebar.classList.contains('minimized')) {
    minimizeSidebarBtn.textContent = '+';
    minimizeSidebarBtn.title = 'Show Sidebar';
  } else {
    minimizeSidebarBtn.textContent = '-';
    minimizeSidebarBtn.title = 'Hide Sidebar';
  }
});


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

function showRoadInfo(feature, coordinate) {
  const props = feature.getProperties();

  // Only show popup for road layer
  if (props.layer && props.layer.toLowerCase().includes('district')) {
    return; // Skip district layers
  }

  const allowedKeys = ['road_name', 'district_code', 'layer'];
  let html = '<b>Road Information</b><hr>';

  allowedKeys.forEach(key => {
    if (props[key]) {
      const displayKey = key.replace('_', ' ').toUpperCase();
      let value = props[key];

      if (key === 'layer' && value === 'UNID') {
        value = 'Unregistered Road';
      }

      html += `<b>${displayKey}:</b> ${props[key]}<br>`;
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

// 🖱️ Desktop hover — only show when not locked
map.on('pointermove', function (evt) {
  if (evt.dragging || lockedPopup) return;

  const feature = map.forEachFeatureAtPixel(evt.pixel, f => f);
  if (feature !== activeFeature) {
    activeFeature = feature;
    if (feature) {
      const coordinate = evt.coordinate;
      showRoadInfo(feature, coordinate);
    } else {
      hideRoadInfo();
    }
  }
});

// 📱 Mobile & click — lock popup
map.on('singleclick', function (evt) {
  const feature = map.forEachFeatureAtPixel(evt.pixel, f => f);

  if (feature) {
    const coordinate = evt.coordinate;
    showRoadInfo(feature, coordinate);
    activeFeature = feature;
    lockedPopup = true; // Lock popup after click
  } else {
    hideRoadInfo();
  }
});

// Locate me feature
let locationLayer = null;
let locateActive = false; // track toggle state

const locateBtn = document.getElementById('locate-btn');

locateBtn.addEventListener('click', () => {
  locateActive = !locateActive; // toggle

  if (locateActive) {
    locateBtn.classList.add('active'); // add visual highlight

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
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
            stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 })
          }),
        });
        marker.setStyle(markerStyle);

        // Add marker to layer
        locationLayer = new ol.layer.Vector({
          source: new ol.source.Vector({
            features: [marker],
          }),
        });
        map.addLayer(locationLayer);

        // Zoom to location
        map.getView().animate({
          center: transformed,
          zoom: 16,
          duration: 1000
        });
      });
    } else {
      alert("Geolocation not supported by your browser.");
    }

  } else {
    locateBtn.classList.remove('active');
    // Remove marker if toggled off
    if (locationLayer) {
      map.removeLayer(locationLayer);
      locationLayer = null;
    }
  }
});

