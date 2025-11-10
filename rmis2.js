// =========================================================================
//  SHARE LOCATION FUNCTION & OVERLAY
// =========================================================================

// New overlay for the share info popup
let sharePopup = new ol.Overlay({ 
    // We create the element dynamically later, but here we just need a placeholder div
    element: document.createElement('div'), 
    positioning: 'bottom-center',
    offset: [0, -15] // Position it just above the location marker
});
map.addOverlay(sharePopup); // Add the overlay to the map

function copyCoordsToClipboard(lat, lon) {
    const textToCopy = `Lat: ${lat}, Lng: ${lon}`;
    
    // Use the modern clipboard API
    navigator.clipboard.writeText(textToCopy).then(() => {
        // Simple alert for confirmation
        alert(`Copied coordinates to clipboard: ${textToCopy}`);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        alert('Failed to copy coordinates. Please check browser permissions.');
    });
}

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

    const allowedKeys = ['road_name', 'pkm_road_id', 'marris_id', 'district_code', 'layer', 'road_length','start_node_coord','end_node_coord']; 
    let copyText = '';
    let html = '<b>Road Information</b><hr>';
    let roadNameForCopy = '';

    allowedKeys.forEach(key => {
        // Check if the property is defined AND not null/empty
        const rawValue = props[key];
        let value;
        
        const isCoordKey = key === 'start_node_coord' || key === 'end_node_coord';

        if (rawValue !== null && rawValue !== undefined && rawValue !== ''|| isCoordKey ) {
      

            if (isCoordKey && (rawValue === null || rawValue === undefined)) {
                value = "N/A";
            } else {
                value = rawValue;
            }
            
            // Apply special formatting if needed
            if (key === 'layer' && value === 'UNID') {
                value = 'Unregistered Road';
            }
            
            let displayKey = key.replace('_', ' ').toUpperCase();

            if (key === 'start_node_coord') {
                displayKey = 'START CHAINAGE (LAT, LON)';
            } else if (key === 'end_node_coord') {
                displayKey = 'END CHAINAGE (LAT, LON)';
            }

            if (key === 'road_name') {
                roadNameForCopy = value;

                html += `<b>${displayKey}:</b> ` +
                        `<span id="roadNameClickable" ` + // Added ID for easier targeting
                        `onclick="copyRoadNameOnly(this, '${roadNameForCopy.replace(/'/g, "\\'")}')" ` +
                        `onmouseover="styleRoadName(this)" ` + // New hover handler
                        `onmouseout="unstyleRoadName(this)" ` +  // New unhover handler
                        `style="cursor: pointer;" ` + // Keep cursor pointer style
                        `title="Copy road name">${value}</span><br>`;
            } else {
            html += `<b>${displayKey}:</b> ${value}<br>`;
            }
            copyText += `${displayKey}: ${value}\n`;
        }
    });

    if(copyText.length > 0){
         html += '<hr><a href="#" onclick="copyRoadInfoToClipboard(this); return false;" ' +
            'style="color: blue; cursor: pointer; text-decoration: underline; font-size: 0.9em;">Copy Road Info</a>';
    }else {
        html += '<hr>No detailed attribute data found for this road.';
    }

   
    popupContent.dataset.copyText = copyText;
    
    popupContent.innerHTML = html;
    popup.setPosition(coordinate);
    popupElement.style.display = 'block';
    lockedPopup = true; 
}

function styleRoadName(spanElement) {
    spanElement.style.color = 'blue';
    spanElement.style.textDecoration = 'underline';
}
function unstyleRoadName(spanElement) {
    spanElement.style.color = '';
    spanElement.style.textDecoration = '';
}

function copyRoadInfoToClipboard(linkElement) { // Changed parameter name to linkElement
    const textToCopy = popupContent.dataset.copyText;
    
    if (!textToCopy) {
        alert('No road information to copy.');
        return;
    }

    navigator.clipboard.writeText(textToCopy).then(() => {
        // Provide visual feedback for a link
        const originalText = linkElement.textContent;
        const originalColor = linkElement.style.color;

        linkElement.textContent = 'Copied';

        // Reset the link after a short delay
        setTimeout(() => {
            linkElement.textContent = originalText;
            linkElement.style.color = originalColor; // Revert to original color (blue)
            linkElement.style.textDecoration = 'underline'; // Restore underline
        }, 1500);
        
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        alert('Failed to copy road information. Please check browser permissions.');
    });
}

function copyRoadNameOnly(spanElement, roadName) {
    if (!roadName) {
        alert('No road name to copy.');
        return;
    }

    navigator.clipboard.writeText(roadName).then(() => {
        const originalText = spanElement.textContent;
        const originalColor = spanElement.style.color;

        // Reset the element after a short delay
        setTimeout(() => {
            spanElement.textContent = originalText;
            spanElement.style.color = originalColor;
            spanElement.style.textDecoration = 'underline';
        }, 1500);
        
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        alert('Failed to copy road name. Please check browser permissions.');
    });
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

// --- Control Variable (Defined here, accessible globally) ---
let roadInfoListener = null; 


// --- Function to handle the actual road info logic (MOVED from inside map.on) ---
async function handleRoadInfoClick(evt) {
    // Use the global 'lockedPopup' variable defined above this section.
    if (lockedPopup) {
        hideRoadInfo(); 
    }

    highlightLayer.getSource().clear();

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
    const bufferDegrees = 0.00027; 
    const minLon = lon - bufferDegrees;
    const minLat = lat - bufferDegrees;
    const maxLon = lon + bufferDegrees;
    const maxLat = lat + bufferDegrees;

    const cql = `BBOX(geom, ${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 'EPSG:4326')`;

    const features = await queryWFS(cql);

    const activeFeatures = features.filter(f => activeRoadTypes.has(f.get('layer')) || activeRoadTypes.size === 0);

    if (activeFeatures && activeFeatures.length > 0) {
    const feature = activeFeatures[0];

    const geometry = feature.getGeometry();

    let startDisplay = 'N/A';
    let endDisplay = 'N/A';

    if(geometry && geometry.getType() === 'LineString') {

            // 1. CLONE the geometry to avoid modifying the original feature's geometry
            const geometryClone = geometry.clone(); 
            
            // 2. EXPLICITLY transform the cloned geometry to EPSG:4326
            // The original geometry is assumed to be in the map's view projection (e.g., 3857) 
            // after the WFS reader parsed it, so we transform it back to 4326.
            geometryClone.transform(map.getView().getProjection(), 'EPSG:4326');
            
 const coords = geometryClone.getCoordinates();

            // Use a stronger check for the coords array
 if(Array.isArray(coords) && coords.length >= 2) {
 const startCoord = coords[0];
 const endCoord = coords[coords.length - 1];

                // Since we explicitly transformed to 4326, the format is [LON, LAT]
 startDisplay = `${startCoord[1].toFixed(6)} ${startCoord[0].toFixed(6)}`; // LAT, LON
 endDisplay = `${endCoord[1].toFixed(6)} ${endCoord[0].toFixed(6)}`; // LAT, LON

 } else if (Array.isArray(coords) && coords.length === 1) {
                // Handle the rare case where the LineString is only a single point
                const singleCoord = coords[0];
                startDisplay = `${singleCoord[1].toFixed(6)} ${singleCoord[0].toFixed(6)}`;
                endDisplay = 'N/A (Single Point)';
            }
 }

 feature.set('start_node_coord', startDisplay);
 feature.set('end_node_coord', endDisplay);

  // Show the popup using the newly fetched WFS feature
 showRoadInfo(feature, evt.coordinate);

 // Highlight the feature
const roadClone = feature.clone();
 // The geometry for HIGHLIGHTING must remain transformed to the map's projection (3857)
 roadClone.getGeometry().transform('EPSG:4326', map.getView().getProjection());
 highlightLayer.getSource().addFeature(roadClone);

 } else {
hideRoadInfo();
 }
}


// --- Control Functions to manage activation ---

function disableRoadInfoClick() {
    if (roadInfoListener) {
        ol.Observable.unByKey(roadInfoListener);
        roadInfoListener = null; 
    }
}

function enableRoadInfoClick() {
    if (!roadInfoListener) {
        // Re-attach the click listener, linking it to the handler function
        roadInfoListener = map.on('singleclick', handleRoadInfoClick);
    }
}

// **Initial Setup**: Start the listener active by default
enableRoadInfoClick();



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
                    const accuracy = pos.coords.accuracy;
                    const coords = [pos.coords.longitude, pos.coords.latitude];
                    const transformed = ol.proj.fromLonLat(coords);

                    if (locationLayer) {
                        map.removeLayer(locationLayer);
                    }

                    const accuracyCircle = new ol.Feature({
                        geometry: new ol.geom.Circle(transformed, accuracy),
                    });

                    const accuracyStyle = new ol.style.Style({
                        fill: new ol.style.Fill({ color: 'rgba(0, 150, 255, 0.2)' }),
                        stroke: new ol.style.Stroke({ color: 'rgba(0, 150, 255, 0.8)', width: 1 }),
                    });
                    accuracyCircle.setStyle(accuracyStyle);

                    const marker = new ol.Feature({
                        geometry: new ol.geom.Point(transformed),
                    });

                    const markerStyle = new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 3,
                            fill: new ol.style.Fill({ color: 'rgba(0, 150, 255, 0.9)' }),
                            stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 }),
                        }),
                    });
                    marker.setStyle(markerStyle);

                    locationLayer = new ol.layer.Vector({
                        source: new ol.source.Vector({
                            features: [accuracyCircle, marker],
                        }),
                    });
                    map.addLayer(locationLayer);

                    // --- 3. Share Popup Overlay ---
                    const lon = coords[0].toFixed(6);
                    const lat = coords[1].toFixed(6);
                    const shareText = `Lat: ${lat}, Lng: ${lon} (±${accuracy.toFixed(1)}m)`;
                    
                        const popupElement = sharePopup.getElement();

                            // --- UPDATED HTML FOR SHARING ---
                            const shareLink = `
            <a href="https://wa.me/?text=${encodeURIComponent(shareText)}" 
            target="_blank" 
            class="share-popup-link whatsapp-link"
            title="Share location via WhatsApp">
            <i class="fab fa-whatsapp"></i> WhatsApp
            </a>`;

        const copyLink = `<a href="#" onclick="copyCoordsToClipboard('${lat}', '${lon}'); return false;" 
                        class="share-popup-link copy-link"
                        title="Copy Lat/Lon coordinates">
                        <i class="fas fa-copy"></i> Copy Coords
                        </a>`;


        popupElement.innerHTML = `
            <div class="share-popup-box">
                <span class="share-popup-text">${shareText}</span>
                <div class="share-popup-actions">
                    ${shareLink}
                    ${copyLink}
                </div>
            </div>`;

        sharePopup.setPosition(transformed);
        popupElement.style.display = 'block';

                    map.getView().animate({
                        center: transformed,
                        zoom: 13,
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
            sharePopup.getElement().style.display = 'none'; // Hide popup if geolocation not supported
        }
    } else {
        locateBtn.classList.remove('active');
        sharePopup.getElement().style.display = 'none'; // Hide popup
        if (locationLayer) {
            map.removeLayer(locationLayer);
            locationLayer = null;
        }
    }
});