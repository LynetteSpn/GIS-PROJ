// =========================================================================
// 11. SIDEBAR MINIMIZE/EXPAND
// =========================================================================
const sidebar = document.getElementById('side-toolbar');
const minimizeSidebarBtn = document.getElementById('minimize-sidebar');

minimizeSidebarBtn.addEventListener('click', () => { 
    sidebar.classList.toggle('minimized');

    if (sidebar.classList.contains('minimized')) { 
        minimizeSidebarBtn.textContent = '+';
        minimizeSidebarBtn.title = 'Show Sidebar';
    } else {
        minimizeSidebarBtn.textContent = '-';
        minimizeSidebarBtn.title = 'Hide Sidebar';
    }
});

// =========================================================================
// 12. TOOLTIP POPUP FOR ROAD INFO (WFS-on-Demand Click)
// =========================================================================
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

// In popup.js

function showRoadInfo(feature, coordinate) {
    const props = feature.getProperties();

    if (props['NAME_2']) { 
        // Skip district features
        return;
    }

    const allowedKeys = ['road_name', 'pkm_road_id', 'marris_id', 'district_code', 'layer', 'road_length']; 
    let html = '<b>Road Information</b><hr>';

    allowedKeys.forEach(key => {
        // Check if the property is defined AND not null/empty
        const rawValue = props[key];
        let value;
        
        if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
            value = rawValue;
            
            // Apply special formatting if needed
            if (key === 'layer' && value === 'UNID') {
                value = 'Unregistered Road';
            }
            
            const displayKey = key.replace('_', ' ').toUpperCase();
            html += `<b>${displayKey}:</b> ${value}<br>`;
        }
        // } else {
        //     // Display 'N/A' or 'MISSING' for missing data
        //     const displayKey = key.replace('_', ' ').toUpperCase();
        //     html += `<b>${displayKey}:</b> <span style="color: red;">N/A</span><br>`;
        // }
    });

    popupContent.innerHTML = html;
    popup.setPosition(coordinate);
    popupElement.style.display = 'block';
    lockedPopup = true; 
}

function hideRoadInfo() {
    popupElement.style.display = 'none';
    popup.setPosition(undefined);
    lockedPopup = false;
}

popupCloser.onclick = function (evt) {
    evt.preventDefault();
    hideRoadInfo();
};

// --- Click popup (WFS-on-Demand) ---
map.on('singleclick', async function (evt) {
    // If we click again, unlock the previous one before checking for a new feature
    if (lockedPopup) {
        hideRoadInfo(); 
        // We return here to prevent double WFS call on rapid clicking
        // If the user clicks again, the function will run again without this return.
        // For simplicity, we process the new click immediately below:
    }

    // 1. Check for District or Highlight clicks first (local features)
    let localFeature = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
        if (layer && layer.get('name') === 'DistrictLayer') return null;
        return f;
    });

    if (localFeature) {
        showRoadInfo(localFeature, evt.coordinate);
        return;
    }

    // 2. WFS-on-Demand: If no local feature, query GeoServer for a road feature at the click point
    const [lon, lat] = ol.proj.toLonLat(evt.coordinate);
   // const bufferdistance = 30; // in meters
    // CRITICAL FIX: Unit changed to 'meters' and distance adjusted to avoid GeoServer CQL error.

    const bufferDegrees = 0.00027; 
    const minLon = lon - bufferDegrees;
    const minLat = lat - bufferDegrees;
    const maxLon = lon + bufferDegrees;
    const maxLat = lat + bufferDegrees;

    const cql = `BBOX(geom, ${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 'EPSG:4326')`;

    const features = await queryWFS(cql);

    highlightLayer.getSource().clear(); 

    if (features && features.length > 0) {
        const feature = features[0];
        
        // Show the popup using the newly fetched WFS feature
        showRoadInfo(feature, evt.coordinate);
        
        // Highlight the feature
        const originalColor = roadColors[feature.get('layer')] || 'black';
        const roadClone = feature.clone();
        roadClone.set('highlight_color', originalColor);
        roadClone.set('road_name', feature.get('road_name')); 

        highlightLayer.getSource().addFeature(roadClone);

    } else {
        hideRoadInfo();
    }
});


// =========================================================================
// 13. LOCATE ME BUTTON 
// =========================================================================
let locationLayer = null;
let locateActive = false; 

const locateBtn = document.getElementById('locate-btn');

locateBtn.addEventListener('click', () => {
    locateActive = !locateActive;

    if (locateActive) {
        locateBtn.classList.add('active');

        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const coords = [pos.coords.longitude, pos.coords.latitude];
                    const transformed = ol.proj.fromLonLat(coords);

                    if (locationLayer) {
                        map.removeLayer(locationLayer);
                    }

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

                    locationLayer = new ol.layer.Vector({
                        source: new ol.source.Vector({
                            features: [marker],
                        }),
                    });
                    map.addLayer(locationLayer);

                    map.getView().animate({
                        center: transformed,
                        zoom: 16,
                        duration: 1000,
                    });
                },
                (error) => {
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
        locateBtn.classList.remove('active');
        if (locationLayer) {
            map.removeLayer(locationLayer);
            locationLayer = null;
        }
    }
});