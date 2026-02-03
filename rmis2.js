/* * =========================================================================
 * RMIS 2.0 - Map Interactions & Popups
 * =========================================================================
 * * CORE FEATURES:
 * 1. MOUSE INTERACTIONS:
 * - Latitude/Longitude display on pointer move.
 * 
 * 2. POPUP SYSTEM:
 * - "Road Info" Popup: Detailed table view of WFS attributes.
 * - "Drill-down" Navigation: Road -> Asset List -> Asset Details.
 * - Action Buttons: Copy info, Route to location.
 * 
 * 3. GEOLOCATION TOOLS:
 * - "Locate Me" button with accuracy circle.
 * - Share current GPS coordinates via WhatsApp/Clipboard.
 * =========================================================================
 */

// 1. GLOBAL VARIABLES
window.multiSelectFeatures = []; 
let popupState = {
    currentIndex: 0, 
    pages: [], // Stores the "Page Objects" (Road, BridgeGroup, CulvertGroup)
    roadCopyText: ''
};


// =========================================================
// SELECTION MODE TOGGLE (Area vs Single)
// =========================================================
window.currentSelectionMode = 'radius'; 

const selectModeToggle = document.getElementById('select-mode-toggle');
if (selectModeToggle) {
    selectModeToggle.addEventListener('change', function() {
        if (this.checked) {
            window.currentSelectionMode = 'precise';
            if (typeof highlightLayer !== 'undefined') highlightLayer.getSource().clear();
            if (typeof hideRoadInfo === 'function') hideRoadInfo();
        } else {
            window.currentSelectionMode = 'radius';
        }
    });
}

// =========================================================================
// 10. MOUSE INTERACTIONS
// =========================================================================
map.on('pointermove', function (evt) {
    const coord = ol.proj.toLonLat(evt.coordinate);
    const lon = coord[0].toFixed(5);
    const lat = coord[1].toFixed(5);
    document.getElementById('coords').innerHTML = `Lat: ${lat}, Lng: ${lon}`;
});

if (typeof initTooltipLogic === 'function') {
    initTooltipLogic();
}

// =========================================================================
// 11. SHARE LOCATION & OVERLAYS
// =========================================================================
let sharePopup = new ol.Overlay({ 
    element: document.createElement('div'), 
    positioning: 'bottom-center',
    offset: [0, -15] 
});
map.addOverlay(sharePopup);

function copyCoordsToClipboard(lat, lon) {
    const textToCopy = `Lat: ${lat}, Lng: ${lon}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert(`Copied: ${textToCopy}`);
    }).catch(err => console.error('Copy failed', err));
}

// =========================================================================
// 12. ROAD POPUP LOGIC
// =========================================================================
const popupElement = document.getElementById('road-popup');
const popupContent = document.getElementById('road-popup-content');
// Note: We don't use getElementById for closer anymore because it's dynamic

const popup = new ol.Overlay({
    element: popupElement,
    offset: [10, -10],
    positioning: 'bottom-left',
    stopEvent: true
});
map.addOverlay(popup);

let lockedPopup = false;

// EVENT DELEGATION FOR CLOSE BUTTON (Fixes "null" error)
if (popupElement) {
    popupElement.addEventListener('click', function(evt) {
        if (evt.target.matches('.ol-popup-closer') || evt.target.closest('.ol-popup-closer')) {
            evt.preventDefault();
            evt.stopPropagation();
            hideRoadInfo();
        }
    });
}

function hideRoadInfo() {
    popupElement.style.display = 'none';
    popup.setPosition(undefined);
    lockedPopup = false;

    // --- NEW: Clear the cyan highlight line ---
    if (typeof highlightLayer !== 'undefined') {
        highlightLayer.getSource().clear();
    }
    
    // Optional: Also clear the red click circle if it's still there
    if (typeof clickRadiusSource !== 'undefined') {
        clickRadiusSource.clear();
    }
}
// =========================================================================
// 13. MULTI-SELECT LIST LOGIC (The List View) 
// =========================================================================
// this is actually to overcome the scope issue when user click and selection of road
// is not the one that being selected

// 3. THE SELECTION HANDLER (Attached to Window)
window.selectSpecificRoad = function(index, coordinate) {
    // Safety check
    if (!window.multiSelectFeatures || !window.multiSelectFeatures[index]) {
        console.error("Feature not found in memory. Index:", index);
        return;
    }

    const selectedFeature = window.multiSelectFeatures[index];
    
    if (selectedFeature) {
        // 1. HIGHLIGHT & ZOOM LOGIC
        if (typeof highlightLayer !== 'undefined') {
            highlightLayer.getSource().clear();
            
            // Clone feature so we don't mess up the original
            const clone = selectedFeature.clone();
            const geom = clone.getGeometry();
            
            if (geom) {
                // Transform to map projection (EPSG:3857) if needed
                geom.transform('EPSG:4326', map.getView().getProjection());
                
                // Add to highlight layer
                highlightLayer.getSource().addFeature(clone);
                
                // ZOOM TO FEATURE ---
                const extent = geom.getExtent();
                map.getView().fit(extent, {
                    padding: [100, 100, 100, 100], // Padding so popup doesn't cover the road
                    duration: 1000,                
                    maxZoom: 17                   
                });
            }
        }
        
        // 2. Call the main processor (Show Popup Details)
        if (typeof window.processSingleFeature === 'function') {
            window.processSingleFeature(selectedFeature, coordinate);
        } else if (typeof processSingleFeature === 'function') {
            processSingleFeature(selectedFeature, coordinate);
        } else {
            console.error("processSingleFeature function missing! Ensure rmis.js is loaded.");
        }
    }
};

// STEP B: The Function to Render the List
function showMultiRoadList(features, coordinate) {
    window.multiSelectFeatures = features; 
    
    // NEW: Save the coordinate so we can come back here later
    popupState.lastListCoordinate = coordinate; 

    let html = `
        <div class="popup-header">
            Found ${features.length} Roads
            <a href="#" class="ol-popup-closer" onclick="hideRoadInfo(); return false;">&times;</a>
        </div>
        <div class="popup-table-container" style="max-height:300px; overflow-y:auto;">
            <table class="popup-table asset-list-table">
                <thead>
                    <tr style="background:#f5f5f5; font-size:11px;">
                        <th style="padding:8px;">Type</th>
                        <th style="padding:8px;">Road Name / ID</th>
                        <th style="padding:8px;">Action</th>
                    </tr>
                </thead>
                <tbody>`;

    features.forEach((f, index) => {
        const props = f.getProperties();
        const type = props.layer || 'UNK';
        const name = props.road_name || props.pkm_road_id || 'Unnamed Road';
        const typeMap = {'UNID':'unid','FEDERAL':'federal','JKR':'jkr','MCDC':'mcdc','PLANTATION':'plantation','JLN KAMPUNG':'kampung','OTHER':'other'};
        const cssClass = typeMap[type] || 'other';

        const coordStr = JSON.stringify(coordinate).replace(/"/g, '&quot;');

        html += `
            <tr onclick='window.selectSpecificRoad(${index}, ${coordStr})' style="cursor:pointer; border-bottom:1px solid #eee;">
                <td style="padding:8px;"><span class="road-type-badge road-type-${cssClass}" style="font-size:10px;">${type}</span></td>
                <td style="padding:8px; font-weight:bold; color:#333;">${name}</td>
                <td style="padding:8px; text-align:center; color:#007bff;">&rarr;</td>
            </tr>`;
    });

    html += `</tbody></table></div>`;
    
    const popupContent = document.getElementById('road-popup-content');
    const popupElement = document.getElementById('road-popup');
    const popupOverlay = map.getOverlays().getArray().find(o => o.getElement() === popupElement);
    
    popupContent.innerHTML = html;
    if(popupOverlay) popupOverlay.setPosition(coordinate);
    popupElement.style.display = 'block';
    lockedPopup = true;
}

// =========================================================================
// 14. SINGLE ROAD DETAIL VIEW (Carousel Logic)
// =========================================================================

function showRoadInfo(feature, coordinate, nearbyAssets = []) {
    const props = feature.getProperties();
    if (props['NAME_2']) return; 

    // --- 1. PREPARE PAGES ---
    popupState.pages = [];
    popupState.currentIndex = 0;

    // Page 0: The Road Itself (Always exists)
    popupState.pages.push({ type: 'ROAD', data: props, coords: coordinate });

    // Filter Assets by Type
    const bridges = nearbyAssets.filter(a => a.properties._assetType === 'Bridge');
    const culverts = nearbyAssets.filter(a => a.properties._assetType === 'Culvert');
    const potholes = nearbyAssets.filter(a => a.properties._assetType === 'Pothole');

    // Page 1: Bridges (If any)
    if (bridges.length > 0) {
        popupState.pages.push({ type: 'BRIDGES', data: bridges });
    }

    // Page 2: Culverts (If any)
    if (culverts.length > 0) {
        popupState.pages.push({ type: 'CULVERTS', data: culverts });
    }

    if (potholes.length > 0) {
        popupState.pages.push({ type: 'POTHOLES', data: potholes });
    }

    // --- 2. PREPARE ROAD DISPLAY ---
    const clickedLonLat = ol.proj.toLonLat(coordinate);
    const clickedLat = clickedLonLat[1].toFixed(6);
    const clickedLon = clickedLonLat[0].toFixed(6);
    
    let copyText = '';
    let tableRows = '';

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

    fields.forEach(field => {
        let val = props[field.key];
        if (!val && field.fallbackKey) val = props[field.fallbackKey];
        if (!val || val === 'null') val = '-';

        let displayValue = val;
        if (field.key === 'layer' && val !== '-') {
             const typeMap = {'UNID':'unid','FEDERAL':'federal','JKR':'jkr','MCDC':'mcdc','PLANTATION':'plantation','JLN KAMPUNG':'kampung','OTHER':'other'};
             displayValue = `<span class="road-type-badge road-type-${typeMap[val] || 'other'}">${val}</span>`;
        }
        
        tableRows += `<tr><td class="popup-label">${field.label}</td><td class="popup-value">${displayValue}</td></tr>`;
        copyText += `${field.label}: ${val}\n`;
    });

    popupState.roadCopyText = copyText;
    popupContent.dataset.copyText = copyText;

    // --- 3. RENDER INITIAL VIEW (ROAD) ---
    renderPopupPage(0);
    
    popup.setPosition(coordinate);
    popupElement.style.display = 'block';
    lockedPopup = true;
}

window.restoreMultiList = function() {
    // Safety check
    if (window.multiSelectFeatures && window.multiSelectFeatures.length > 0 && popupState.lastListCoordinate) {
        
        // Clear specific highlight (from single select)
        if (typeof highlightLayer !== 'undefined') highlightLayer.getSource().clear();
        
        // Re-highlight ALL
        window.multiSelectFeatures.forEach(f => {
            const clone = f.clone();
            const geom = clone.getGeometry();
            if(geom) geom.transform('EPSG:4326', map.getView().getProjection());
            highlightLayer.getSource().addFeature(clone);
        });

        // Re-render the list
        showMultiRoadList(window.multiSelectFeatures, popupState.lastListCoordinate);
    }
};

// NAVIGATION & ASSET RENDERING
window.navigatePopup = function(direction) {
    let newIndex = popupState.currentIndex + direction;

    // Boundary checks (Prevent going below 0 or above max pages)
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= popupState.pages.length) newIndex = popupState.pages.length - 1;

    popupState.currentIndex = newIndex;
    
    // Call the renderer
    renderPopupPage(newIndex);
};

window.showAssetDirectly = function(feature, coordinate) {
    const p = feature.getProperties();
    const isBridge = p.structure_no !== undefined && p.structure_no !== null;
    let html = `<div class="popup-header">
        ${isBridge ? "Bridge Details" : "Culvert Details"}
        <a href="#" class="ol-popup-closer" onclick="hideRoadInfo(); return false;">&times;</a>
    </div>
    <div class="popup-table-container">
      <table class="popup-table" style="width:100%">
    `;

    // Define fields and label/text mapping for loop below
    const fields = isBridge
        ? [
            {key:'structure_no', label: 'Bridge ID', style: 'id'},
            {key:'br_general_condition', label: 'Condition', style: 'condition'},
            {key:'br_type_code', label: 'Type'},
            {key:'br_chn_start', label: 'Start Ch.'},
            {key:'br_chn_end', label: 'End Ch.'}
          ]
        : [
            {key:'cv_structure_no', label: 'Culvert ID', style: 'id'},
            {key:'cv_general_condition', label: 'Condition', style: 'condition'},
            {key:'cv_type_code', label: 'Type'},
            {key:'cv_chn_start', label: 'Start Ch.'},
            {key:'cv_chn_end', label: 'End Ch.'}
          ];

    // Loop fields for table
    fields.forEach(f => {
        let content = p[f.key] || '-';
        let tdStyle = '';
        // Style for ID field
        if (f.style === 'id') {
            content = `<span style="color:#1976d2;font-weight:bold;font-size:15px;">${content}</span>`;
        }
        // Style for CONDITION field
        else if (f.style === 'condition') {
            const c = (content || '').toString().toLowerCase();
            let color = '#1976d2', bg = '';
            if (c === 'poor') {
                color = '#d62222'; bg = 'background:#ffeaea;';
            }
            else if (c === 'fair') {
                color = '#f0ad4e'; bg = 'background:#fff7e0;';
            }
            else if (c === 'good') {
                color = '#28a745'; bg = 'background:#eaffea;';
            }
            content = `<span style="color:${color}; font-weight:bold; ${bg} border-radius:4px; padding:2px 10px;">${p[f.key] || '-'}</span>`;
        }
        html += `<tr>
            <td class="popup-label" style="width:48%">${f.label}</td>
            <td class="popup-value" style="width:52%">${content}</td>
        </tr>`;
    });

    html += `</table></div>`;
    popupContent.innerHTML = html;
    popup.setPosition(coordinate);
    popupElement.style.display = 'block';
    lockedPopup = true;
};

// 2. The Renderer (Builds the HTML for Road OR Grouped Assets)
function renderPopupPage(pageIndex) {
    const page = popupState.pages[pageIndex];
    const totalPages = popupState.pages.length;
    let html = '';

    // --- HEADER & CLOSE BUTTON ---
    const pageCounter = totalPages > 1 ? `<span style="font-size:12px; opacity:0.8; margin-left:5px;">(Layer ${pageIndex + 1} of ${totalPages})</span>` : '';
    
    let title = 'Road Info';
    if (page.type === 'BRIDGES') title = `Bridges Found (${page.data.length})`;
    if (page.type === 'CULVERTS') title = `Culverts Found (${page.data.length})`;
    if (page.type === 'POTHOLES') title = `Potholes Found (${page.data.length})`;

    html += `
        <div class="popup-header">
            ${title} ${pageCounter}
            <a href="#" class="ol-popup-closer" onclick="hideRoadInfo(); return false;">&times;</a>
        </div>`;

    // --- CONTENT BODY ---
    html += `<div class="popup-table-container">`;

    if (page.type === 'ROAD') {
        html += buildRoadTableHTML(page.data);
        
    } else {
        // Render GROUPED ASSETS
        page.data.forEach((asset, idx) => {
            
            // --- THE FIX IS HERE ---
            // Check if it's an OpenLayers Feature (.getProperties) or simple JSON (.properties)
            const p = asset.getProperties ? asset.getProperties() : asset.properties;
            // -----------------------

            if (!p) return; // Skip if data is bad

            // Separator line 
            if (idx > 0) html += `<hr style="border:0; border-top:2px dashed #ccc; margin:15px 0;">`;

            // =========================================================
            // A. POTHOLE RENDERER
            // =========================================================
            if (page.type === 'POTHOLES') {
                html += `<div style="font-weight:bold; color:#d62222; margin-bottom:5px; font-size:13px;">Pothole ID: ${p.id || 'N/A'}</div>`;
                
                html += `<table class="popup-table">`;
                html += `<tr><td class="popup-label">Description</td><td class="popup-value">${p.name || '-'}</td></tr>`;
                html += `<tr><td class="popup-label">Status</td><td class="popup-value" style="font-weight:bold;">${p.status || '-'}</td></tr>`;
                html += `</table>`;

                html += `<div style="display:flex; gap:10px; margin-top:10px;">`;
                
                // Before Photo
                if (p.photo_before && p.photo_before !== 'null') {
                    html += `
                        <div style="flex:1;">
                            <div style="font-size:10px; color:#666; margin-bottom:2px;">Before</div>
                            <img src="${p.photo_before}" style="width:100%; border:1px solid #ccc; cursor:pointer;" onclick="window.open(this.src)">
                        </div>`;
                } else {
                     html += `<div style="flex:1; font-size:10px; color:#999; font-style:italic;">No Before Photo</div>`;
                }

                // After Photo
                if (p.photo_after && p.photo_after !== 'null') {
                    html += `
                        <div style="flex:1;">
                            <div style="font-size:10px; color:#666; margin-bottom:2px;">After</div>
                            <img src="${p.photo_after}" style="width:100%; border:1px solid #ccc; cursor:pointer;" onclick="window.open(this.src)">
                        </div>`;
                } else {
                     html += `<div style="flex:1; font-size:10px; color:#999; font-style:italic;">No After Photo</div>`;
                }
                html += `</div>`; 

            } 
            // =========================================================
            // B. EXISTING BRIDGE/CULVERT RENDERER
            // =========================================================
            else {
                const isBridge = (page.type === 'BRIDGES');
                const idValue = isBridge ? p.structure_no : p.cv_structure_no;
                const typeLabel = isBridge ? "Bridge ID" : "Culvert ID";
                
                html += `<div style="font-weight:bold; color:#007bff; margin-bottom:5px; font-size:13px;">${typeLabel}: ${idValue || 'Unnamed'}</div>`;
                html += `<table class="popup-table">`;
                
                const fields = isBridge ? 
                    [{k:'br_type_code', l:'Type'}, {k:'br_general_condition', l:'Condition'}, {k:'br_chn_start', l:'Start Ch.'}, {k:'br_chn_end', l:'End Ch.'}, {k:'br_length', l:'Length (m)'}] :
                    [{k:'cv_type_code', l:'Type'}, {k:'cv_general_condition', l:'Condition'}, {k:'cv_chn_start', l:'Start Ch.'}, {k:'cv_chn_end', l:'End Ch.'}, {k:'cv_length', l:'Length (m)'}];

                fields.forEach(f => {
                    let val = p[f.k];
                    if (val === null || val === undefined || val === 'null') val = '-';
                    if (f.l === 'Condition') {
                        const c = val.toString().toLowerCase();
                        const color = c === 'poor' ? '#d62222' : (c === 'fair' ? '#f0ad4e' : '#28a745');
                        val = `<span style="color:${color}; font-weight:bold;">${val}</span>`;
                    }
                    html += `<tr><td class="popup-label" style="width:40%">${f.l}</td><td class="popup-value">${val}</td></tr>`;
                });
                html += `</table>`;
            }
        });
    }

    html += `</div>`; // End Container

    // --- FOOTER NAVIGATION ---
    const hasBackList = (window.multiSelectFeatures && window.multiSelectFeatures.length > 1 && pageIndex === 0);
    let backListBtn = hasBackList ? `<button class="popup-action-btn" onclick="restoreMultiList();" style="background:#666; margin-right:5px;">&larr; List</button>` : '';

    let navButtons = '';
    if (totalPages > 1) {
        navButtons = `
            <div style="display:flex; gap:5px;">
                <button class="popup-action-btn" onclick="navigatePopup(-1);" ${pageIndex === 0 ? 'disabled style="opacity:0.5"' : ''}>&larr; Prev</button>
                <button class="popup-action-btn btn-next" onclick="navigatePopup(1);" ${pageIndex === totalPages - 1 ? 'disabled style="opacity:0.5"' : ''}>Next &rarr;</button>
            </div>`;
    }

    html += `
        <div class="popup-footer" style="justify-content:space-between;">
            <div style="display:flex; gap:5px;">
                ${backListBtn}
                <button class="popup-action-btn" onclick="copyRoadInfoToClipboard(this);"><i class="fas fa-copy"></i> Copy</button>
            </div>
            ${navButtons}
        </div>`;

    const popupContent = document.getElementById('road-popup-content');
    if(popupContent) popupContent.innerHTML = html;
}

// Helper to rebuild Road Table (To keep renderPopupPage clean)
function buildRoadTableHTML(props) {
    const fields = [
        { key: 'district_name', label: 'District', fallbackKey: 'district_code' },
        { key: 'layer', label: 'Road Type' },
        { key: 'road_name', label: 'Road Name' },
        { key: 'pkm_road_id', label: 'PKM ID' },
        { key: 'marris_id', label: 'Marris ID' },
        { key: 'gis_length', label: 'Length' },
        { key: 'total_pv_length', label: 'Maint. Length' },
        { key: 'start_node_coord', label: 'Start Ch.' },
        { key: 'end_node_coord', label: 'End Ch.' }
    ];

    let html = `<table class="popup-table">`;
    fields.forEach(field => {
        let val = props[field.key];
        if (!val && field.fallbackKey) val = props[field.fallbackKey];
        if (!val || val === 'null') val = '-';
        
        let displayValue = val;
         if (field.key === 'layer' && val !== '-') {
             const typeMap = {'UNID':'unid','FEDERAL':'federal','JKR':'jkr','MCDC':'mcdc','PLANTATION':'plantation','JLN KAMPUNG':'kampung','OTHER':'other'};
             displayValue = `<span class="road-type-badge road-type-${typeMap[val] || 'other'}">${val}</span>`;
        }

        html += `<tr><td class="popup-label">${field.label}</td><td class="popup-value">${displayValue}</td></tr>`;
    });
    html += `</table>`;
    return html;
}

// =========================================================================
// CLICK HANDLER (Upgraded for Multi-Select + Smart Single Select)
// =========================================================================
async function handleRoadInfoClick(evt) {
    const targetElement = evt.originalEvent ? evt.originalEvent.target : null;
    if (targetElement && targetElement.closest('#road-popup')) return;

    // 1. Clear previous state (Consolidated into one block)
    if (lockedPopup) hideRoadInfo();
    if (typeof highlightLayer !== 'undefined') highlightLayer.getSource().clear();

    // =========================================================
    // 2. CHECK FOR PRIORITY ASSETS (Bridges, Culverts, POTHOLES)
    // =========================================================
    let assetFeature = null;

    map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        const props = feature.getProperties();
        const layerName = layer ? layer.get('name') : '';

        // Check for specific layers OR unique properties
        if (
            layerName === 'BridgeLayer' || 
            layerName === 'CulvertLayer' || 
            layerName === 'PotholeLayer' || // Check Layer Name
            props.type === 'Pothole' ||     // Check Property
            props.structure_no ||           // Check Bridge ID
            props.cv_structure_no           // Check Culvert ID
        ) {
            assetFeature = feature;
            return true; // Stop searching, we found the top item
        }
    }, { hitTolerance: 5 });

    // 3. HANDLE ASSET CLICK (Stop processing if found)
    if (assetFeature) {
        const p = assetFeature.getProperties();

        // SCENARIO A: It is a Pothole -> Use your new Carousel Renderer
        if (p.type === 'Pothole' || (assetFeature.getLayer() && assetFeature.getLayer().get('name') === 'PotholeLayer')) {
             
             // Trick the popup into showing just this pothole as a "Page"
             // This ensures we use the correct Photo Renderer
             popupState.pages = [{ type: 'POTHOLES', data: [assetFeature] }];
             popupState.currentIndex = 0;
             
             if (typeof renderPopupPage === 'function') {
                renderPopupPage(0);
             }
             
             // Position and Show Popup
             const popupElement = document.getElementById('road-popup');
             const popupOverlay = map.getOverlays().getArray().find(o => o.getElement() === popupElement);
             if(popupOverlay) popupOverlay.setPosition(evt.coordinate);
             popupElement.style.display = 'block';
             lockedPopup = true;

        } 
        // SCENARIO B: It is a Bridge/Culvert -> Use the existing direct view
        else {
             if (typeof window.showAssetDirectly === 'function') {
                 window.showAssetDirectly(assetFeature, evt.coordinate);
             }
        }
        
        return; // <--- CRITICAL: Do not proceed to Road Logic!
    }

    // =========================================================
    // 4. PREPARE FOR ROAD SEARCH
    // =========================================================
    const mode = window.currentSelectionMode || 'radius';
    let bufferDegrees = (mode === 'precise') ? 0.00003 : 0.0003;
    let visualRadiusMeters = (mode === 'precise') ? 5 : 200;

    // Visual Feedback (Red Circle)
    if (typeof clickRadiusSource !== 'undefined') {
        clickRadiusSource.clear();
        clickRadiusSource.addFeature(new ol.Feature({
            geometry: new ol.geom.Circle(evt.coordinate, visualRadiusMeters)
        }));
        setTimeout(() => { if (clickRadiusSource) clickRadiusSource.clear(); }, 1000);
    }

    // 5. FIND ROAD FEATURES
    let foundFeatures = [];

    // Strategy A: Check Local Vector Features
    map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
        // Ignore Reference Layers
        if (layer && (layer.get('name') === 'DistrictLayer' || layer.get('name') === 'MeasureLayer')) return null;

        // CRITICAL FIX: Ignore Potholes if they slip into this loop
        const p = f.getProperties();
        if (p.type === 'Pothole' || (layer && layer.get('name') === 'PotholeLayer')) return null;

        foundFeatures.push(f);
    });

    // Strategy B: If Local failed, try WFS Radius Search
    if (foundFeatures.length === 0) {
        const [lon, lat] = ol.proj.toLonLat(evt.coordinate);
        const cql = `BBOX(geom, ${lon - bufferDegrees}, ${lat - bufferDegrees}, ${lon + bufferDegrees}, ${lat + bufferDegrees}, 'EPSG:4326')`;
        
        const wfsFeatures = await queryWFS('gis_sabah_road_map', cql);
        
        // Filter active types
        foundFeatures = wfsFeatures.filter(f => activeRoadTypes.has(f.get('layer')) || activeRoadTypes.size === 0);
    }

    // 6. PROCESS ROAD RESULTS
    if (foundFeatures.length > 0) {
        if (mode === 'precise') foundFeatures = [foundFeatures[0]];

        // Highlight
        foundFeatures.forEach(f => {
            const clone = f.clone();
            const geom = clone.getGeometry();
            if (geom) geom.transform('EPSG:4326', map.getView().getProjection());
            highlightLayer.getSource().addFeature(clone);
        });

        // Show Popup
        if (foundFeatures.length === 1) {
            processSingleFeature(foundFeatures[0], evt.coordinate);
        } else {
            showMultiRoadList(foundFeatures, evt.coordinate);
        }

    } else {
        hideRoadInfo();
    }
}

// Helper to process a single feature (Ensure it is attached to window!)
window.processSingleFeature = async function(feature, coordinate) {
    const roadId = feature.get('pkm_road_id');

    // ... (Rest of your existing logic from your pasted code) ...
    if (roadId) {
       document.body.style.cursor = 'wait';
       const extendedProps = await fetchExtendedAttributes(roadId);
       document.body.style.cursor = 'default';
       if (extendedProps) feature.setProperties(extendedProps);
    }

    // Chainage Logic
    let startDisplay = feature.get('start_chainage'); 
    let endDisplay = feature.get('end_chainage');
    if (!startDisplay || !endDisplay) {
       const geometry = feature.getGeometry();
       if(geometry) {
           const geomClone = geometry.clone().transform(map.getView().getProjection(), 'EPSG:4326');
           const coords = geomClone.getCoordinates();
           if(coords.length >= 2) {
               const flatCoords = geometry.getType() === 'MultiLineString' ? coords[0] : coords;
               startDisplay = `${flatCoords[0][1].toFixed(6)} ${flatCoords[0][0].toFixed(6)}`;
               endDisplay = `${flatCoords[flatCoords.length - 1][1].toFixed(6)} ${flatCoords[flatCoords.length - 1][0].toFixed(6)}`;
           }
       }
    }
    feature.set('start_node_coord', startDisplay || 'N/A');
    feature.set('end_node_coord', endDisplay || 'N/A');

    // Fetch Assets
    const [clickLon, clickLat] = ol.proj.toLonLat(coordinate);
    const nearbyAssets = await fetchNearbyAssets(clickLon, clickLat);

    // Use existing global function
    showRoadInfo(feature, coordinate, nearbyAssets);
};

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