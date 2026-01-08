/* * =========================================================================
 * RMIS 3.0 - Unified Map Interactions & Optimization Engine
 * =========================================================================
 * * FEATURES IMPLEMENTED:
 * 1. MEASUREMENT TOOL: Interactive length measurement (Draw LineString on map).
 * 
 * 2. ROUTE PLANNER (PGROUTING):
 * - Standard A to B routing (Select on map or GPS).
 * - Route to Popup: Direct navigation from asset info popup.
 * 
 * 3. OPTIMIZATION MODULE (TSP):
 * - Multi-stop Route Optimization using Nearest Neighbor logic.
 * - Modes: Manual Selection, Critical Bridges Scan, Critical Culverts Scan.
 * - Job List Management: Add, Remove, and Reorder (visual) stops.
 * 
 * 4. UI STATE MANAGEMENT:
 * - Unified Panel System (Main Menu -> Workspace).
 * - Floating Action Bar for adding points.
 * - Mode switching (Standard vs. Optimization).
 * 
 * 5. GPS INTEGRATION: Real-time geolocation for start points.
 * * DEPENDENCIES: OpenLayers (ol), Backend API (Port 3000), rmis.js (Base map).
 * =========================================================================
 */

// =========================================================================
// GLOBAL STATE VARIABLES
// =========================================================================
let isMeasuring = false;
let routeWizardState = 'idle'; // Standard Routing State 
let startPoint = null; 
let currentUserLocation = null; 

// Optimization (Job Planner) State
let isAddingJobs = false;
let jobList = []; // Stores: [{lon, lat}, {lon, lat}...]
let currentOptMode = 'manual'; //'manual,'bridge','culvert'

// --- DOM ELEMENTS ---
const plannerBtn = document.getElementById('planner-btn');
const optimizePanel = document.getElementById('optimization-panel');
const btnCloseOpt = document.getElementById('btn-close-opt');
const btnBackMenu = document.getElementById('btn-back-menu');
const optTitle = document.getElementById('opt-title');


// Main Menu Choices
const optMainMenu = document.getElementById('opt-main-menu');
const optWorkspace = document.getElementById('opt-workspace');
const btnModeGps = document.getElementById('btn-mode-gps');
const btnModeManualStart = document.getElementById('btn-mode-manualstart');
const btnModeMultiStop = document.getElementById('btn-mode-multistop');
const btnModeBridge = document.getElementById('btn-mode-bridge');
const btnModeCulvert = document.getElementById('btn-mode-culvert');


// Workspace Buttons
const btnAddJobs = document.getElementById('btn-add-jobs');
const btnRunTsp = document.getElementById('btn-run-tsp');
const btnClearJobs = document.getElementById('btn-clear-jobs');
const jobListDiv = document.getElementById('job-list');

const addingModeBar = document.getElementById('adding-mode-bar');
const addingCountSpan = document.getElementById('adding-count');
const btnFinishAdding = document.getElementById('btn-finish-adding');
const routeBanner = document.getElementById('route-banner');

let measureDraw;
let measureTooltipElement = null;
let measureTooltip;

// Create Layer for Measurement Lines
const measureSource = new ol.source.Vector();
const measureLayer = new ol.layer.Vector({
    source: measureSource,
    style: new ol.style.Style({
        fill: new ol.style.Fill({color: 'rgba(255, 255, 255, 0.2)'}),
        stroke: new ol.style.Stroke({ color: '#ffcc33', width: 2 }),
        image: new ol.style.Circle({
            radius: 5,
            fill: new ol.style.Fill({color: '#ffcc33'})
        })
    })
});
measureLayer.set('name', 'MeasureLayer');
// Ensure 'map' is defined globally from rmis.js
if (typeof map !== 'undefined') map.addLayer(measureLayer);

const measureBtn = document.getElementById('measure-btn');

// --- Helper: Format Length ---
const formatLength = function (line) {
    const transformedLine = line.clone().transform(map.getView().getProjection(), 'EPSG:4326');
    const length = ol.sphere.getLength(transformedLine, { projection: 'EPSG:4326' });
    return (length > 100) ? (Math.round((length / 1000) * 100) / 100 + ' km') : (Math.round(length * 100) / 100 + ' m');
};

// --- Helper: Create Tooltip ---
function createMeasureTooltip() {
    if (measureTooltipElement) {
        measureTooltipElement.parentNode.removeChild(measureTooltipElement);
    }
    measureTooltipElement = document.createElement('div');
    measureTooltipElement.className = 'ol-tooltip ol-tooltip-measure';
    
    // CSS for tooltip (Injecting dynamically just in case)
    measureTooltipElement.style.background = "rgba(0,0,0,0.7)";
    measureTooltipElement.style.color = "white";
    measureTooltipElement.style.padding = "4px 8px";
    measureTooltipElement.style.borderRadius = "4px";
    measureTooltipElement.style.fontSize = "12px";
    measureTooltipElement.style.whiteSpace = "nowrap";

    measureTooltip = new ol.Overlay({
        element: measureTooltipElement,
        offset: [0, -15],
        positioning: 'bottom-center'
    });
    map.addOverlay(measureTooltip);
}

// --- Main: Add Interaction ---
function addMeasureInteraction() {
    measureDraw = new ol.interaction.Draw({
        source: measureSource,
        type: 'LineString',
        style: new ol.style.Style({
            fill: new ol.style.Fill({ color: 'rgba(255, 255, 255, 0.2)' }),
            stroke: new ol.style.Stroke({ color: 'rgba(0, 0, 0, 0.5)', lineDash: [10, 10], width: 2 }),
            image: new ol.style.Circle({ radius: 5, stroke: new ol.style.Stroke({ color: 'rgba(0, 0, 0, 0.7)' }), fill: new ol.style.Fill({ color: 'rgba(255, 255, 255, 0.2)' }) })
        })
    });

    map.addInteraction(measureDraw);
    createMeasureTooltip();

    let listener;
    measureDraw.on('drawstart', function (evt) {
        // measureSource.clear(); // Uncomment if you want to clear previous line on new draw
        let sketch = evt.feature;
        let tooltipCoord = evt.coordinate;

        listener = sketch.getGeometry().on('change', function (evt) {
            const geom = evt.target;
            const output = formatLength(geom);
            tooltipCoord = geom.getLastCoordinate();
            measureTooltipElement.innerHTML = output;
            measureTooltip.setPosition(tooltipCoord);
        });
    });

    measureDraw.on('drawend', function () {
        measureTooltipElement.className = 'ol-tooltip ol-tooltip-static';
        measureTooltip.setOffset([0, -7]);
        // Unset listener
        ol.Observable.unByKey(listener);
        // Create new tooltip for next segment
        createMeasureTooltip(); 
    });
}

// --- Toggle Function ---
function toggleMeasurement() {
    isMeasuring = !isMeasuring;
    
    if (measureBtn) measureBtn.classList.toggle('active', isMeasuring);

    if (isMeasuring) {
        // CLOSE ROUTE PLANNER IF OPEN
        if(document.getElementById('optimization-panel')) {
            document.getElementById('optimization-panel').style.display = 'none';
        }
        
        measureSource.clear();
        addMeasureInteraction();
        map.getTargetElement().style.cursor = 'crosshair';
    } else {
        // Turn off
        map.removeInteraction(measureDraw);
        map.removeOverlay(measureTooltip);
        if(measureTooltipElement) measureTooltipElement.style.display = 'none';
        map.getTargetElement().style.cursor = '';
    }
}

// --- Event Listener ---
if (measureBtn) {
    measureBtn.addEventListener('click', toggleMeasurement);
}

// =========================================================================
// ROUTE TO POPUP FUNCTION
// ========================================================================

window.routeToPopupLocation = function(destLon, destLat) {
    // 1. Check for Geolocation support
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by this browser.");
        return;
    }

    // 2. Visual Feedback (Change cursor)
    document.body.style.cursor = 'wait';
    const btn = document.querySelector('.popup-footer button[onclick*="routeToPopupLocation"]');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Locating...';

    // 3. Get Current Position
    navigator.geolocation.getCurrentPosition(
        (position) => {
            document.body.style.cursor = 'default';
            
            // Define Start (My Location) and End (Popup Location)
            const startNode = {
                lat: position.coords.latitude,
                lon: position.coords.longitude
            };
            
            const endNode = {
                lat: destLat,
                lon: destLon
            };

            // 4. Update Global State (Optional, keeps your Unified Panel in sync)
            if (typeof currentUserLocation !== 'undefined') currentUserLocation = startNode;
            if (typeof startPoint !== 'undefined') startPoint = startNode;

            // 5. Call your existing Routing Engine
            // Assuming getRoute(start, end) exists from your previous code
            if (typeof getRoute === 'function') {
                getRoute(startNode, endNode);
                
                // Close the popup so the user can see the route
                if (typeof hideRoadInfo === 'function') hideRoadInfo(); 
            } else {
                alert("Routing function (getRoute) is missing!");
            }
        },
        (error) => {
            document.body.style.cursor = 'default';
            alert("Unable to retrieve your location. Check permissions.");
            // Reset button text
            if (btn) btn.innerHTML = originalText;
        },
        { enableHighAccuracy: true }
    );
};

// =========================================================================
// 2. STANDARD ROUTING (Single Start/End)
// =========================================================================
async function getRoute(start, end) {
    if (typeof routeSource !== 'undefined') routeSource.clear();
    const apiUrl = `http://10.1.4.18:3000/route?start_lon=${start.lon}&start_lat=${start.lat}&end_lon=${end.lon}&end_lat=${end.lat}`;
    try {
        const response = await fetch(apiUrl);
        const routeData = await response.json(); 

        if (!routeData || !routeData.route_geometry) {
            alert('No route found between these points.');
            resetRouteWizard(); 
            return;
        }
        drawRouteOnMap(routeData.route_geometry);
        console.table(routeData.steps);
    } catch (err) { console.error('Error fetching route:', err); }
}

function drawRouteOnMap(geojson) {
    const routeFeature = new ol.format.GeoJSON().readFeature(geojson, {
        dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' 
    });
    if (typeof routeSource !== 'undefined') routeSource.addFeature(routeFeature);
    map.getView().fit(routeFeature.getGeometry().getExtent(), { padding: [50, 50, 50, 50], duration: 1000 });
}

/**
 * =========================================================================
 * RMIS 3.0 - UNIFIED ROUTE PLANNER & ASSET INTEGRATION
 * =========================================================================
 */

// --- GLOBAL STATE ---
let routeStops = []; // Stores the inputs: [{id, type, lat, lon, value}]
let stopCounter = 0; 

// --- DOM ELEMENTS ---
const panelContainer = document.getElementById('route-inputs-container');
const statusMsg = document.getElementById('routeStatus');


// =========================================================================
// 1. INITIALIZATION & MODES
// =========================================================================

async function startMode(mode) {
    if(optimizePanel) optimizePanel.style.display = 'block';
    
    // Reset Views
    const inputSection = document.getElementById('route-inputs-container');
    const addBtnDiv = document.getElementById('btnAddStopRow')?.parentElement;
    const calcBtnDiv = document.getElementById('btn-calculate-route')?.parentElement;
    const legacyActions = document.getElementById('legacy-actions');
    const scanMenu = document.getElementById('scan-tools-menu');

    // Hide everything initially
    if(inputSection) inputSection.style.display = 'none';
    if(addBtnDiv) addBtnDiv.style.display = 'none';
    if(calcBtnDiv) calcBtnDiv.style.display = 'none';
    if(legacyActions) legacyActions.style.display = 'none';
    if(scanMenu) scanMenu.style.display = 'none';
    if(statusMsg) statusMsg.innerText = "";

    // --- MODE: PLANNER (Manual Entry) ---
    if (mode === 'planner') {
        document.getElementById('opt-title').innerText = "Route Planner";
        if(inputSection) inputSection.style.display = 'block';
        if(addBtnDiv) addBtnDiv.style.display = 'block';
        if(calcBtnDiv) calcBtnDiv.style.display = 'block';
        if(scanMenu) scanMenu.style.display = 'block';

        if(routeStops.length === 0) resetRoutePanel();
    } 
    
    // --- MODE: ASSET SCANNER ---
    else if (mode === 'bridge' || mode === 'culvert') {
        document.getElementById('opt-title').innerText = (mode === 'bridge') ? "Bridge Scanner" : "Culvert Scanner";
        
        // Show Inputs (So we can see added assets) + Actions
        if(inputSection) inputSection.style.display = 'block';
        if(calcBtnDiv) calcBtnDiv.style.display = 'block'; 
        
        // Ensure we have a "Start" point ready
        if(routeStops.length === 0) resetRoutePanel();

        await scanAssets(mode);
    }
}

function resetRoutePanel() {
    if(!panelContainer) return;
    panelContainer.innerHTML = "";
    routeStops = [];
    stopCounter = 0;
    
    addRouteInput('start');
    addRouteInput('end');
    
    if(typeof routeSource !== 'undefined') routeSource.clear();
    if(typeof routeMarkerSource !== 'undefined') routeMarkerSource.clear();
}

// =========================================================================
// 2. DYNAMIC INPUT BUILDER (Updated to support Pre-filling)
// =========================================================================

// Now accepts 'prefillData' (SMART FILL):
function addRouteInput(type = 'stop', prefillData = null) {
    stopCounter++;
    const uniqueId = `stop_${stopCounter}`;
    
    let iconClass = 'icon-stop'; 
    let placeholder = 'Add destination';
    let isRemovable = true;

    if (type === 'start') {
        iconClass = 'icon-circle';
        placeholder = 'Choose starting point';
        isRemovable = false;
    } else if (type === 'end') {
        iconClass = 'icon-pin';
        placeholder = 'Choose destination';
        isRemovable = false; // Only non-removable if it's the *initial* end point
    }

    // If adding a clicked asset, treat it as a stop (unless we are replacing an empty End)
    if(prefillData && type === 'stop') {
        // If the "End" input is currently empty, let's fill THAT instead of making a new row
        const emptyEnd = routeStops.find(s => s.type === 'end' && !s.value);
        if(emptyEnd) {
            fillExistingInput(emptyEnd.id, prefillData);
            return; // Exit, don't create new row
        }
    }

    // Create Row HTML
    const row = document.createElement('div');
    row.className = 'route-input-row';
    row.id = `row_${uniqueId}`;
    
    const valueStr = prefillData ? prefillData.name : "";

    const gpsButtonHtml = (type === 'start')
        ? `<button class="btn-locate-inside" title="Use current Location"><i class="fas fa-crosshairs"></i></
        button>`
        : '';

    row.innerHTML = `
        <div class="route-icon-wrapper">
            <div class="${iconClass}">
                ${type === 'end' ? '<i class="fas fa-map-marker-alt" style="color:white; font-size:8px;"></i>' : ''}
            </div>
        </div>
        <div class="route-input-wrapper">
            <input type="text" id="${uniqueId}" value="${valueStr}" placeholder="${placeholder}" autocomplete="off">

            <div id="list_${uniqueId}" class="autocomplete-items"></div>

           ${gpsButtonHtml}
        </div>
        ${isRemovable ? `<button class="btn-delete-stop" onclick="removeRouteInput('${uniqueId}')">&times;</button>` : ''}
    `;

    panelContainer.appendChild(row);

    // Save State
    const stopObj = { 
        id: uniqueId, 
        type: type, 
        value: valueStr, 
        lat: prefillData ? prefillData.lat : null, 
        lon: prefillData ? prefillData.lon : null 
    };
    routeStops.push(stopObj);

    // Visual Feedback if prefilled
    if(prefillData) {
        document.getElementById(uniqueId).style.borderLeft = "3px solid #28a745";
    }

    if(type === 'start') {
        const gpsBtn = row.querySelector('.btn-locate-inside');
        if(gpsBtn) {
            gpsBtn.addEventListener('click',() => handleGpsLocate(uniqueId));
        }
    }

    // Activate Autocomplete
    setTimeout(() => setupAutocomplete(uniqueId), 50);
}

function handleGpsLocate(id) {
    const input = document.getElementById(id);
    if (!input) return;

    // 1. UI Feedback: Show loading state
    input.value = "Locating...";
    input.style.color = "#999";
    document.body.style.cursor = "wait";

    // 2. Check for Browser Support
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        input.value = "";
        return;
    }

    // 3. Request Position
    navigator.geolocation.getCurrentPosition(
        (position) => {
            document.body.style.cursor = "default";
            const { latitude, longitude } = position.coords;

            // 4. Update Input UI
            input.value = "My Location"; // Or "Current Location"
            input.style.color = "#000";
            input.style.borderLeft = "3px solid #28a745"; // Success Green

            // 5. Update Internal State
            const stop = routeStops.find(s => s.id === id);
            if (stop) {
                stop.lat = latitude;
                stop.lon = longitude;
                stop.value = "My Location";
            }

            // 6. Update Map Visuals (Green Dot)
            if (typeof updateMapIndicators === 'function') {
                updateMapIndicators();
            }

            // Zoom map to user
            // map.getView().animate({ 
            //     center: ol.proj.fromLonLat([longitude, latitude]), 
            //     zoom: 15, duration: 1000 
            // });
        },
        (error) => {
            document.body.style.cursor = "default";
            console.error(error);
            input.value = ""; // Clear on error
            input.style.borderLeft = "3px solid red"; // Error Red
            alert("Unable to retrieve location. Please check permissions.");
        },
        { enableHighAccuracy: true, timeout: 50000 }
    );
}

// Helper to fill an existing empty box (like the default "To" box)
function fillExistingInput(id, data) {
    const input = document.getElementById(id);
    if(input) {
        input.value = data.name;
        input.style.borderLeft = "3px solid #28a745";
        
        // Update State
        const stop = routeStops.find(s => s.id === id);
        if(stop) {
            stop.value = data.name;
            stop.lat = data.lat;
            stop.lon = data.lon;
        }
    }
}

function removeRouteInput(id) {
    const row = document.getElementById(`row_${id}`);
    if(row) row.remove();
    routeStops = routeStops.filter(s => s.id !== id);
}

// =========================================================================
// 3. MAP INTERACTION
// =========================================================================


map.on('click', function(evt) {
    // 🛑 PRIORITY 1: MEASUREMENT TOOL
    // If measuring, do nothing else.
    if (typeof isMeasuring !== 'undefined' && isMeasuring) return;

    // 🛑 PRIORITY 2: CHECK FOR CLICKS ON MARKERS (Red Dots / Assets)
    // We check if the pixel contains a feature (dot/pin)
    const feature = map.forEachFeatureAtPixel(evt.pixel, function(feat) { return feat; });

    if (feature) {
        const props = feature.getProperties();

        // A. Is it a Scanned Asset (Red Dot)?
        if (props.isAsset === true) {
            // Add it to our unified input list
            addRouteInput('stop', {
                name: props.name,
                lat: props.lat,
                lon: props.lon
            });
            
            // Visual Flash Effect (Feedback)
            const originalStyle = feature.getStyle();
            feature.setStyle(new ol.style.Style({
                image: new ol.style.Circle({ 
                    radius: 8, fill: new ol.style.Fill({color: '#007bff'}), stroke: new ol.style.Stroke({color:'white', width:2}) 
                })
            }));
            
            // Restore style after 300ms
            //setTimeout(() => { if(feature) feature.setStyle(originalStyle); }, 300);

            return; // ⛔ STOP HERE! Do not show road info.
        }

        // B. Is it an existing Job Marker (Legacy Job List)?
        if (feature.get('index') !== undefined) {
            // Your old logic for toggling selection (if using legacy list)
            const idx = feature.get('index');
            if (jobList[idx]) {
                jobList[idx].selected = !jobList[idx].selected;
                updateMapMarkers();
                renderJobList();
            }
            return; // ⛔ STOP HERE.
        }
    }

    // 🛑 PRIORITY 3: MANUAL "ADD LOCATION" MODE
    // If user clicked the "Add Destination" button and is now picking a spot
    if (typeof isAddingJobs !== 'undefined' && isAddingJobs) {
        const coords = ol.proj.toLonLat(evt.coordinate);
        
        // Add to the new unified panel logic
        // (We assume this mode might be triggered by a "Pick on Map" button)
        // If using the new panel, we likely want to fill the *empty* input
        // For now, let's just add a new input:
        addRouteInput('stop', {
            name: "Pinned Location", 
            lat: coords[1], 
            lon: coords[0]
        });
        
        return; // ⛔ STOP HERE.
    }

    // 🛑 PRIORITY 4: ROUTE WIZARD (Legacy GPS Start/End Selection)
    if (routeWizardState !== 'idle') {
        switch (routeWizardState) {
            case 'selectStart':
                const startCoords = ol.proj.toLonLat(evt.coordinate);
                startPoint = { lon: startCoords[0], lat: startCoords[1] };
                addMarker(evt.coordinate, 'Start');
                showMessage('Now select DESTINATION point');
                routeWizardState = 'selectDest';
                break;

            case 'selectDest':
                const endCoords = ol.proj.toLonLat(evt.coordinate);
                const endPoint = { lon: endCoords[0], lat: endCoords[1] };
                addMarker(evt.coordinate, 'End');
                showMessage(null);
                getRoute(startPoint, endPoint);
                routeWizardState = 'idle';
                map.getTargetElement().style.cursor = '';
                break;
        }
        return; // ⛔ STOP HERE.
    }

    // 🟢 PRIORITY 5: DEFAULT BEHAVIOR (ROAD INFO)
    // Only runs if we didn't hit ANY of the returns above.
    if (typeof handleRoadInfoClick === 'function') {
        handleRoadInfoClick(evt);
    }
});

// =========================================================================
// 4. ASSET SCANNER LOGIC
// =========================================================================

async function scanAssets(type) {
    // Clear old markers
    if(typeof routeMarkerSource !== 'undefined') routeMarkerSource.clear();
    if(typeof routeSource !== 'undefined') routeSource.clear();

    statusMsg.innerText = "Scanning...";

    try {
        const r = await fetch(`http://10.1.4.18:3000/assets/critical?type=${type}`);
        const assets = await r.json();
        
        if(assets && assets.length > 0) {
            statusMsg.innerText = `Found ${assets.length} assets. Click red dots to add to route.`;
            statusMsg.style.color = "blue";

            // Add dots to map
            assets.slice(0, 50).forEach(a => {
                if(a.lon && a.lat) addAssetMarker(a.lon, a.lat, a.name);
            });
        } else {
            statusMsg.innerText = "No assets found.";
        }
    } catch(e) { 
        console.error(e);
        statusMsg.innerText = "Scan Error";
    }
}

// Draws the Red Dot AND attaches data to it
function addAssetMarker(lon, lat, name) {
    const marker = new ol.Feature({ 
        geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])) 
    });

    // IMPORTANT: Attach data to the feature so the click listener can read it
    marker.setProperties({
        isAsset: true,
        name: name || "Unknown Asset",
        lon: lon,
        lat: lat
    });

    marker.setStyle(new ol.style.Style({
        image: new ol.style.Circle({ 
            radius: 6, 
            fill: new ol.style.Fill({color: '#dc3545'}), // Red
            stroke: new ol.style.Stroke({color:'white', width:2}) 
        })
    }));

    if(typeof routeMarkerSource !== 'undefined') routeMarkerSource.addFeature(marker);
}

// =========================================================================
// 5. REMAINING HELPERS (Autocomplete, Calc, etc)
// =========================================================================

const btnCalculate = document.getElementById('btn-calculate-route');
if(btnCalculate) {
    btnCalculate.addEventListener('click', () => {
        const validStops = routeStops.filter(s => s.lat !== null && s.lon !== null);

        if (validStops.length < 2) {
            statusMsg.innerText = "Need at least 2 locations.";
            return;
        }
        statusMsg.innerText = "Optimizing...";
        
        // Always use Optimization for unified logic (it handles 2 points too if backend supports it, 
        // otherwise stick to simple branching)
        if (validStops.length === 2) {
             getRoute({ lat: validStops[0].lat, lon: validStops[0].lon }, { lat: validStops[1].lat, lon: validStops[1].lon });
        } else {
             runUnifiedOptimization(validStops);
        }
    });
}

async function runUnifiedOptimization(stops) {
    const coordsArray = stops.map(s => [s.lon, s.lat]);
    const apiUrl = `http://10.1.4.18:3000/route/optimize?locations=${JSON.stringify(coordsArray)}`;
    
    try {
        const resp = await fetch(apiUrl);
        const data = await resp.json();
        
        if(data && data.route_geometry) {
            drawRouteOnMap(data.route_geometry);
            statusMsg.innerText = "Route Optimized!";
            statusMsg.style.color = "green";
        } else {
            statusMsg.innerText = "No route found.";
        }
    } catch(e) { console.error(e); }
}

// Autocomplete Setup
function setupAutocomplete(id) {
    const input = document.getElementById(id);
    const list = document.getElementById(`list_${id}`);
    if(!input) return;

    input.addEventListener('input', function() {
        const val = this.value;
        const stop = routeStops.find(s => s.id === id);
        if(stop) stop.value = val;

        if(val.length > 2) fetchRoadSuggestions(val, list, input, (selectedName) => {
            resolveLocation(selectedName, id);
        });
    });
}

async function resolveLocation(roadName, id) {
    const stop = routeStops.find(s => s.id === id);
    if(!stop) return;
    const coords = await fetchRoadGeometry(roadName); 
    if(coords) {
        stop.lat = coords.lat;
        stop.lon = coords.lon;
        document.getElementById(id).style.borderLeft = "3px solid #28a745"; 
    }
}

// --- STANDARD LISTENERS ---
if(plannerBtn) plannerBtn.addEventListener('click', () => startMode('planner'));
const btnAdd = document.getElementById('btnAddStopRow');
if(btnAdd) btnAdd.addEventListener('click', () => addRouteInput('stop'));
const btnClear = document.getElementById('btn-clear-all');
if(btnClear) btnClear.addEventListener('click', resetRoutePanel);
const btnClose = document.getElementById('btn-close-opt');
if(btnClose) btnClose.addEventListener('click', () => optimizePanel.style.display = 'none');

// Scan Tools
document.getElementById('btn-mode-bridge')?.addEventListener('click', () => startMode('bridge'));
document.getElementById('btn-mode-culvert')?.addEventListener('click', () => startMode('culvert'));

// --- DEPENDENCIES (Existing Functions) ---
// Ensure you have fetchRoadSuggestions, fetchRoadGeometry, getRoute, drawRouteOnMap defined!
// Use the versions from previous steps.

async function fetchRoadSuggestions(searchText, listElement, inputElement, onSelect) {
    if(!listElement) return;
    listElement.innerHTML = "<div style='color:#ccc;font-size:10px;padding:5px'>Searching...</div>";
    
    try {
        const viewName = "rmisv2db_prod:gis_sabah_road_map"; // CHECK THIS NAME!
        const cql = `road_name ILIKE '%${searchText}%'`;
        const url = `https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${viewName}&outputFormat=application/json&propertyName=road_name&cql_filter=${encodeURIComponent(cql)}&maxFeatures=5`;

        const r = await fetch(url);
        const d = await r.json();
        
        // Render
        const names = [...new Set(d.features.map(f => f.properties.road_name).filter(Boolean))];
        listElement.innerHTML = "";
        
        if(names.length === 0) { listElement.innerHTML = "<div style='padding:5px'>No results</div>"; return; }

        names.forEach(name => {
            const div = document.createElement("div");
            div.innerText = name;
            div.style.padding = "8px";
            div.style.cursor = "pointer";
            div.style.borderBottom = "1px solid #eee";
            div.addEventListener('click', () => {
                inputElement.value = name;
                listElement.innerHTML = "";
                if(onSelect) onSelect(name);
            });
            listElement.appendChild(div);
        });

    } catch(e) { console.error(e); }
}

// 2. Fetch Geometry (For Coordinates)
async function fetchRoadGeometry(roadName) {
    const viewName = "rmisv2db_prod:gis_sabah_road_map";
    const cql = `road_name ILIKE '${roadName}'`;
    const url = `https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${viewName}&outputFormat=application/json&cql_filter=${encodeURIComponent(cql)}&maxFeatures=1`;

    try {
        const r = await fetch(url);
        const d = await r.json();
        if(d.features && d.features.length > 0) {
            // Simple center point logic
            const geom = new ol.format.GeoJSON().readGeometry(d.features[0].geometry);
            const center = ol.extent.getCenter(geom.getExtent());
            
            // Check Projection
            if(center[0] > 180) {
                const ll = ol.proj.toLonLat(center);
                return { lon: ll[0], lat: ll[1] };
            }
            return { lon: center[0], lat: center[1] };
        }
    } catch(e) { console.error(e); }
    return null;
}