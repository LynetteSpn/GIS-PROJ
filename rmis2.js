// =========================================================================
// 10. LATITUDE AND LONGITUDE DISPLAY
// =========================================================================
//Latitude and Longitude display on mouse move
map.on('pointermove', function (evt) {
    const coord = ol.proj.toLonLat(evt.coordinate);
    const lon = coord[0].toFixed(5);
    const lat = coord[1].toFixed(5);

    document.getElementById('coords').innerHTML = `Lat: ${lat}, Lng: ${lon}`;
});

// At the absolute bottom of rmis.js
if (typeof initTooltipLogic === 'function') {
    initTooltipLogic();
}

// =========================================================================
//  SHARE LOCATION FUNCTION & OVERLAY
// =========================================================================
// New overlay for the share info popup
let sharePopup = new ol.Overlay({ 
    element: document.createElement('div'), 
    positioning: 'bottom-center',
    offset: [0, -15] 
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
// ===========================================================================
// showRoadInfo with "Next" Button Logic (for Bridge and Culvert detail info)
// ===========================================================================
function showRoadInfo(feature, coordinate, nearbyAssets = []) {
    const props = feature.getProperties();
    if (props['NAME_2']) return;

    // 1. Prepare Click Coordinates
    const clickedLonLat = ol.proj.toLonLat(coordinate);
    const clickedLat = clickedLonLat[1].toFixed(6);
    const clickedLon = clickedLonLat[0].toFixed(6);
    
    let copyText = '';
    let tableRows = '';

    // 2. Define Fields (Same as before)
    const fields = [
        { key: 'district_name', label: 'District', fallbackKey: 'district_code' },
        { key: 'layer', label: 'Road Type' },
        { key: 'road_name', label: 'Road Name' },
        { key: 'pkm_road_id', label: 'PKM ID' },
        { key: 'marris_id', label: 'Marris ID' },
        { key: 'gis_length', label: 'Actual On-site Length' },
        { key: 'marris_length', label: 'MARRIS Length' },
        { key: 'total_pv_length', label: 'Maintenance Length' },
        { key: 'reg_srt', label: 'SRT' },
        { key: 'start_node_coord', label: 'Start Chainage' },
        { key: 'end_node_coord', label: 'End Chainage' }
    ];

    let html = '<div class="popup-header">Road Information</div>';
    
    // --- FOOTER BUTTONS SETUP ---
    
    // Button 1: Copy (Left side)
    let copyBtnHtml = `
        <button class="popup-action-btn" onclick="copyRoadInfoToClipboard(this); return false;">
            <i class="fas fa-copy"></i> Copy Info
        </button>`;

    // Button 2: Next (Right side - Only if assets exist)
    let nextBtnHtml = '';

    if (nearbyAssets && nearbyAssets.length > 0) {
        popupContent.dataset.assets = JSON.stringify(nearbyAssets);
        
        // Styled as a "Next" navigation button
        nextBtnHtml = `
            <button class="popup-action-btn btn-next" onclick="showAssetList(); return false;">
                Next (${nearbyAssets.length}) &rarr;
            </button>`;
    }

    // 4. Add Clicked Location
    html += `
        <div class="popup-location-section">
            <span class="location-label">Clicked Location:</span>
            <span class="location-value">${clickedLat}, ${clickedLon}</span>
        </div>`;
    
    copyText += `CLICKED: ${clickedLat}, ${clickedLon}\n\n`;

    // 5. Loop through fields (Standard Table Logic)
    fields.forEach(field => {
        let val = props[field.key];
        if ((val === null || val === undefined || val === '') && field.fallbackKey) val = props[field.fallbackKey];
        if (val === null || val === undefined || val === 'null') val = '-';

        let displayValue = val;

        if (['gis_length', 'marris_length', 'total_pv_length'].includes(field.key) && val !== '-') displayValue = `${val} KM`;
        
        if (field.key === 'layer' && val !== '-') {
            const typeMap = {'UNID':'unid','FEDERAL':'federal','JKR':'jkr','MCDC':'mcdc','PLANTATION':'plantation','JLN KAMPUNG':'kampung','OTHER':'other'};
            const cssClass = typeMap[val] || 'other';
            displayValue = `<span class="road-type-badge road-type-${cssClass}">${val}</span>`;
        }

        if (field.key === 'road_name' && val !== '-') {
             displayValue = `<span class="road-name-clickable" onclick="copyRoadNameOnly(this, '${val.replace(/'/g, "\\'")}')" title="Click to copy">${val}</span>`;
        }
        if (['start_node_coord', 'end_node_coord'].includes(field.key) && val !== '-') {
             displayValue = `<span class="coord-value">${val}</span>`;
        }

        tableRows += `<tr><td class="popup-label">${field.label}</td><td class="popup-value">${displayValue}</td></tr>`;
        
        let cleanVal = val.toString().replace(/<[^>]*>?/gm, ''); 
        if (['gis_length', 'marris_length', 'total_pv_length'].includes(field.key) && val !== '-') cleanVal += ' KM';
        copyText += `${field.label}: ${cleanVal}\n`;
    });

    // 6. Final Assembly
    html += `
        <div class="popup-table-container">
            <table class="popup-table">${tableRows}</table>
        </div>
        
        <div class="popup-footer">
            ${copyBtnHtml}
            ${nextBtnHtml}
        </div>`;

    popupContent.dataset.copyText = copyText;
    popupContent.dataset.roadHtml = html; 
    popupContent.innerHTML = html;
    popup.setPosition(coordinate);
    popupElement.style.display = 'block';
    lockedPopup = true; 
}

// Function to switch the popup view to the Asset List
window.showAssetList = function() {
    const assetsStr = document.getElementById('road-popup-content').dataset.assets;
    if (!assetsStr) return;

    const assets = JSON.parse(assetsStr);
    let html = '<div class="popup-header">Nearby Bridge/Culvert</div>';

    // Create a clickable list of assets
    html += '<div class="popup-table-container"><table class="popup-table asset-list-table">';
    
    assets.forEach((asset, index) => {
        const p = asset.properties;
        const type = p._assetType; // 'Bridge' or 'Culvert'
        
        // Determine a display ID based on type
        let displayId = type === 'Bridge' ? (p.structure_no || p.bridge_name) : (p.cv_structure_no || 'Unknown ID');
        if(!displayId) displayId = "Unnamed Asset";

        html += `
            <tr onclick="showAssetDetail(${index})" style="cursor:pointer;">
                <td class="popup-label"><span class="road-type-badge road-type-${type === 'Bridge' ? 'jkr' : 'mcdc'}">${type}</span></td>
                <td class="popup-value" style="text-decoration:underline; color:blue;">${displayId}</td>
            </tr>`;
    });

    html += '</table></div>';

    // Footer with Back Button
    html += `
        <div class="popup-footer">
            <button class="popup-action-btn" onclick="restoreRoadView(); return false;">
                &larr; Back to Road
            </button>
        </div>`;

    document.getElementById('road-popup-content').innerHTML = html;
};

// Function to show details of a specific asset
window.showAssetDetail = function(index) {
    const assetsStr = document.getElementById('road-popup-content').dataset.assets;
    const assets = JSON.parse(assetsStr);
    const asset = assets[index];
    const p = asset.properties;
    const type = p._assetType;

    let html = `<div class="popup-header">${type} Details</div>`;
    let tableRows = '';

    // Define fields to show based on type
    // You can adjust these keys based on your actual DB columns
    let fields = [];
    if (type === 'Bridge') {
        fields = [
            { k: 'structure_no', l: 'Structure ID' },
            { k: 'br_type_code', l: 'Type' },
            { k: 'br_chn_start', l: 'Start Chainage' },
            { k: 'br_chn_end', l: 'End Chainage' },
            { k: 'br_length', l: 'Length (m)' }
        ];
    } else {
        fields = [
            { k: 'cv_structure_no', l: 'Structure ID' },
            { k: 'cv_type_code', l: 'Type' },
            { k: 'cv_chn_start', l: 'Start Chainage' },
            { k: 'cv_chn_end', l: 'End Chainage' },
            { k: 'cv_length', l: 'Length (m)' }
        ];
    }

    fields.forEach(f => {
        if(p[f.k]) {
            tableRows += `<tr><td class="popup-label">${f.l}</td><td class="popup-value">${p[f.k]}</td></tr>`;
        }
    });

    html += `<div class="popup-table-container"><table class="popup-table">${tableRows}</table></div>`;

    // Footer controls
    html += `
        <div class="popup-footer" style="display:flex; justify-content:space-between;">
            <button class="popup-action-btn" onclick="showAssetList(); return false;">
                &larr; List
            </button>
            <button class="popup-action-btn" onclick="restoreRoadView(); return false;">
                Road Info
            </button>
        </div>`;

    document.getElementById('road-popup-content').innerHTML = html;
};

// Function to go back to the main Road Info
window.restoreRoadView = function() {
    const roadHtml = document.getElementById('road-popup-content').dataset.roadHtml;
    if (roadHtml) {
        document.getElementById('road-popup-content').innerHTML = roadHtml;
    }
};

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
            linkElement.style.color = originalColor;
            linkElement.style.textDecoration = 'underline';
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

// =========================================================================
// CLICK HANDLER (Ensures Asset Button Always Appears)
// =========================================================================
async function handleRoadInfoClick(evt) {
    // 1. Clear existing popup/highlights if locked
    if (lockedPopup) hideRoadInfo();
    highlightLayer.getSource().clear();

    let feature = null;

    // 2. STRATEGY A: Check if we clicked an existing feature (District or Highlight)
    const localFeature = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
       // Ignore the district layer, we only care about roads
       if (layer && layer.get('name') === 'DistrictLayer') return null;
       return f;
    });

    if (localFeature) {
        feature = localFeature; // Found it locally!
    } 
    else {
        // 3. STRATEGY B: WFS Spatial Query (If nothing clicked locally)
        const [lon, lat] = ol.proj.toLonLat(evt.coordinate);
        const bufferDegrees = 0.0001;
        const cql = `BBOX(geom, ${lon - bufferDegrees}, ${lat - bufferDegrees}, ${lon + bufferDegrees}, ${lat + bufferDegrees}, 'EPSG:4326')`;

        // Query the Light Layer for geometry
        const features = await queryWFS('gis_sabah_road_map', cql);
        
        // Filter by active types
        const activeFeatures = features.filter(f => activeRoadTypes.has(f.get('layer')) || activeRoadTypes.size === 0);

        if (activeFeatures && activeFeatures.length > 0) {
            feature = activeFeatures[0];
        }
    }

    // 4. PROCESS THE FEATURE (Unified Logic)
    if (feature) {
        const roadId = feature.get('pkm_road_id');

        // A. Fetch Heavy Attributes (The Pivot)
        if (roadId) {
            document.body.style.cursor = 'wait';
            const extendedProps = await fetchExtendedAttributes(roadId);
            document.body.style.cursor = 'default';

            if (extendedProps) {
                feature.setProperties(extendedProps);
            }
        }

        // B. Calculate Chainage Coordinates (Fallback logic)
        let startDisplay = feature.get('start_chainage'); 
        let endDisplay = feature.get('end_chainage');

        if (!startDisplay || !endDisplay) {
            const geometry = feature.getGeometry();
            if(geometry && geometry.getType() === 'LineString') {
                // Ensure we clone and transform safely
                const geometryClone = geometry.clone();
                geometryClone.transform(map.getView().getProjection(), 'EPSG:4326'); 
                
                const coords = geometryClone.getCoordinates();
                if(Array.isArray(coords) && coords.length >= 2) {
                    startDisplay = `${coords[0][1].toFixed(6)} ${coords[0][0].toFixed(6)}`;
                    endDisplay = `${coords[coords.length - 1][1].toFixed(6)} ${coords[coords.length - 1][0].toFixed(6)}`;
                } 
            }
        }
        feature.set('start_node_coord', startDisplay || 'N/A');
        feature.set('end_node_coord', endDisplay || 'N/A');

        // C. CRITICAL FIX: ALWAYS FETCH ASSETS
        // Get click coordinates in Lat/Lon for the asset query
        const [clickLon, clickLat] = ol.proj.toLonLat(evt.coordinate);
        const nearbyAssets = await fetchNearbyAssets(clickLon, clickLat);

        // D. Show Popup (Passing the Assets!)
        showRoadInfo(feature, evt.coordinate, nearbyAssets);

        // E. Highlight the feature
        const roadClone = feature.clone();
        // Ensure highlight geometry is in map projection (EPSG:3857)
        const geom = roadClone.getGeometry();
        if (geom) {

             geom.transform('EPSG:4326', map.getView().getProjection());
        }
        highlightLayer.getSource().addFeature(roadClone);

    } else {
        hideRoadInfo();
    }
}

// --- Control Functions to manage activation ---

// function disableRoadInfoClick() {
//     if (roadInfoListener) {
//         ol.Observable.unByKey(roadInfoListener);
//         roadInfoListener = null; 
//     }
// }

// function enableRoadInfoClick() {
//     if (!roadInfoListener) {
//         // Re-attach the click listener, linking it to the handler function
//         roadInfoListener = map.on('singleclick', handleRoadInfoClick);
//     }
// }
// enableRoadInfoClick();

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