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
const routeBtn = document.getElementById('route-btn');
const routeOptionsPanel = document.getElementById('route-options-panel');
const btnRouteFromGps = document.getElementById('btn-route-from-gps');
const btnRouteManual = document.getElementById('btn-route-manual');
const routeBanner = document.getElementById('route-banner');

// Optimization Elements
const optimizeBtn = document.getElementById('optimize-btn');
const optimizePanel = document.getElementById('optimization-panel');
const btnCloseOpt = document.getElementById('btn-close-opt');
const btnBackMenu = document.getElementById('btn-back-menu');
const optTitle = document.getElementById('opt-title');

//Menu Views
const optMainMenu = document.getElementById('opt-main-menu');
const optWorkspace = document.getElementById('opt-workspace');

//Mode Buttons
const btnModeManual = document.getElementById('btn-mode-manual');
const btnModeBridge = document.getElementById('btn-mode-bridge');
const btnModeCulvert = document.getElementById('btn-mode-culvert');

//Workspace Buttons
const btnAddJobs = document.getElementById('btn-add-jobs');
const btnRunTsp = document.getElementById('btn-run-tsp');
const btnClearJobs = document.getElementById('btn-clear-jobs');
const jobListDiv = document.getElementById('job-list');

const btnScan = document.getElementById('btn-scan-critical');

// =========================================================================
// 1. MEASUREMENT TOOL CODE
// =========================================================================
const measureSource = new ol.source.Vector();
const measureLayer = new ol.layer.Vector({
    source: measureSource,
    style: new ol.style.Style({
        fill: new ol.style.Fill({color: 'rgba(255, 255, 255, 0.2)'}),
        stroke: new ol.style.Stroke({ color: '#ffcc33', width: 2 })
    })
});
measureLayer.set('name','MeasureLayer');
map.addLayer(measureLayer);

let measureDraw;
const measureBtn = document.getElementById('measure-btn');
const measureTooltipElement = document.createElement('div');
let measureTooltip;

const formatLength = function (line) {
    const transformedLine = line.clone().transform(map.getView().getProjection(), 'EPSG:4326');
    const length = ol.sphere.getLength(transformedLine, { projection: 'EPSG:4326' });
    return (length > 100) ? (Math.round((length / 1000) * 100) / 100 + ' km') : (Math.round(length * 100) / 100 + ' m');
};

function createMeasureTooltip() {
    if (measureTooltip) map.removeOverlay(measureTooltip); 
    measureTooltip = new ol.Overlay({
        element: measureTooltipElement,
        offset: [0, -15],
        positioning: 'bottom-center'
    });
    map.addOverlay(measureTooltip);
    measureTooltipElement.style.display = 'block'; 
}

function addInteraction() {
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

    measureDraw.on('drawstart', function (evt) {
        measureSource.clear();
        measureTooltipElement.innerHTML = '0 m';
        measureTooltip.setPosition(evt.coordinate);
        let sketch = evt.feature;
        let listener = sketch.getGeometry().on('change', function (evt) {
            let geom = evt.target;
            measureTooltipElement.innerHTML = formatLength(geom);
            measureTooltip.setPosition(geom.getLastCoordinate());
        });
        sketch.set('listener', listener);
    });

    measureDraw.on('drawend', function (evt) {
        measureTooltipElement.className = 'ol-tooltip ol-tooltip-static';
        ol.Observable.unByKey(evt.feature.get('listener'));
        toggleMeasurement(); 
    });
}

function toggleMeasurement() {
    isMeasuring = !isMeasuring;
    measureBtn.classList.toggle('active', isMeasuring);

    if (isMeasuring) {
        closeAllTools(); // Close routing/optimization
        measureSource.clear(); 
        if (measureTooltipElement) {
            measureTooltipElement.style.display = 'block'; 
            measureTooltipElement.className = 'ol-tooltip ol-tooltip-measure';
        }
        addInteraction();
        map.getTargetElement().style.cursor = 'crosshair';
    } else {
        map.removeInteraction(measureDraw);
        map.getTargetElement().style.cursor = '';
    }
}

if (measureBtn) measureBtn.addEventListener('click', () => {
     if (!isMeasuring) { measureSource.clear(); if (measureTooltip) map.removeOverlay(measureTooltip); }
     toggleMeasurement();
});

// =========================================================================
// 2. STANDARD ROUTING (Start -> End)
// =========================================================================
async function getRoute(start, end) {
  routeSource.clear();
  // Change localhost to your IP if testing on mobile!
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
    routeSource.addFeature(routeFeature);
    map.getView().fit(routeFeature.getGeometry().getExtent(), { padding: [50, 50, 50, 50], duration: 1000 });
}

// =========================================================================
// 3. OPTIMIZATION MODULE (Multiple Points)
// =========================================================================
const addingModeBar = document.getElementById('adding-mode-bar');
const addingCountSpan = document.getElementById('adding-count');
const btnFinishAdding = document.getElementById('btn-finish-adding');

//PANEL NAVIGATION LOGIC
function showMainMenu() {
    // Reset State
    jobList = [];
    routeMarkerSource.clear();
    routeSource.clear();
    if(isAddingJobs) toggleAddJobsMode(); // Stop adding if active

    // UI Switch
    optMainMenu.style.display = 'block';
    optWorkspace.style.display = 'none';
    btnBackMenu.style.display = 'none';
    optTitle.innerText = "Route Planner";
}

async function startMode(mode) {
    currentOptMode = mode;
    // UI Switch
    optMainMenu.style.display = 'none';
    optWorkspace.style.display = 'flex'; // Show workspace
    btnBackMenu.style.display = 'block'; // Show back button

    // Customize based on mode
    if (mode === 'manual') {
        optTitle.innerText = "Manual Planner";
        btnAddJobs.style.display = 'flex'; // Show "Add" button
        renderJobList(); // Show empty list
    } 
    else if (mode === 'bridge') {
        optTitle.innerText = "Bridge Repair";
        btnAddJobs.style.display = 'none'; // Hide manual add
        await scanAssets('bridge'); // Auto Scan
    } 
    else if (mode === 'culvert') {
        optTitle.innerText = "Culvert Repair";
        btnAddJobs.style.display = 'none'; // Hide manual add
        await scanAssets('culvert'); // Auto Scan
    }
}

// =========================================================================
// FLOATING BAR LOGIC (The "Done" Button System)
// =========================================================================
function enterFloatingMode(manualAdd = false) {
    // 1. Hide the main panel
    if (optimizePanel) optimizePanel.style.display = 'none';
    
    // 2. Show the floating "Done" bar
    if (addingModeBar) addingModeBar.style.display = 'flex';
    
    // 3. Set global state
    isAddingJobs = manualAdd; 
    
    // 4. Set Cursor & Message based on mode
    if (manualAdd) {
        // Manual Mode: Plus cursor, clicking adds points
        map.getTargetElement().style.cursor = 'copy'; 
        showMessage("Tap map to add stops");
        if (btnAddJobs) {
            btnAddJobs.innerText = "Adding...";
            btnAddJobs.classList.add("active");
        }
    } else {
        // Scan Mode: Normal cursor, clicking selects points
        map.getTargetElement().style.cursor = ''; 
        showMessage("Tap dots to Select (Blue) / Unselect (Red)");
    }
    updateAddingCount();
}

function exitFloatingMode() {
    // 1. Show the main panel
    if (optimizePanel) optimizePanel.style.display = 'block';
    
    // 2. Hide the floating bar
    if (addingModeBar) addingModeBar.style.display = 'none';
    
    // 3. Reset state
    isAddingJobs = false;
    map.getTargetElement().style.cursor = '';
    showMessage(null);
    
    // 4. Reset button UI
    if (btnAddJobs) {
        btnAddJobs.innerText = "+ Add Locations";
        btnAddJobs.classList.remove("active");
    }
    
    // 5. Refresh the list
    renderJobList();
}


//ASSET SCANNER (UPDATED FOR TYPE)
async function scanAssets(type) {
    try {
        showMessage(`Scanning for Critical ${type}s...`);
        
        const response = await fetch(`http://10.1.4.18:3000/assets/critical?type=${type}`);
        const assets = await response.json();
        
        if (!assets || assets.length === 0) {
            alert(`No critical ${type}s found.`);
            showMessage(null);
            return;
        }

        // Reset
        jobList = [];
        routeMarkerSource.clear();
        routeSource.clear();

        const limit = 50;
        const assetsToShow = assets.slice(0, limit);

        assetsToShow.forEach((asset) => {
            if (asset.lon === null || asset.lat === null) return;
            // Add as Critical (Red)
            addJobPoint(asset.lon, asset.lat, true, asset.name); 
        });
        
        // Zoom to results
        const extent = routeMarkerSource.getExtent();
        if (!ol.extent.isEmpty(extent)) {
            map.getView().fit(extent, { padding: [50, 50, 50, 50], duration: 1000 });
        }

        // === NEW: Auto-Hide Panel so user can interact with map ===
        optimizePanel.style.display = 'none'; 
        optimizeBtn.classList.remove('active');
        
        // Show helpful banner
        showMessage(`Found ${assets.length} assets. Tap dots to Select (Blue), then open menu to Optimize.`);

        enterFloatingMode();

    } catch (err) {
        console.error(err);
        alert("Scan failed. Check server.");
    }
}

// A. Add a point to the job list
function addJobPoint(lon, lat, isCritical = false, name = 'Manual Location') {
    if (jobList.length >= 50) {
        alert("Max 50 jobs allowed.");
        return;
    }

    jobList.push({ 
        lon: lon, 
        lat: lat, 
        selected: !isCritical, // Manual = Blue(Selected), Critical = Red(Unselected)
        name: name 
    });
    
    updateMapMarkers();
    renderJobList();
}

function updateAddingCount() {
    if (addingCountSpan) {
        addingCountSpan.innerText = `${jobList.length} Location${jobList.length !== 1 ? 's' : ''}`;
    }
}
//done button in adding mode bar event listener

if (btnFinishAdding){
    btnFinishAdding.addEventListener('click', exitFloatingMode);
}

// B. Render the HTML list in the panel
function renderJobList() {
    if (jobList.length === 0) {
        jobListDiv.innerHTML = '<div style="color:#999;text-align:center;margin-top:20px;">No jobs added.<br>Select a mode to begin.</div>';
        return;
    }

    let html = '';
    jobList.forEach((job, index) => {
        // Logic to style list item based on selection
        const isOptimized = job.name.startsWith("Stop #");
        const color = isOptimized ? '#28a745' : '#007bff'; 
        const border = job.selected ? `4px solid ${color}` : '4px solid transparent';
        const bg = job.selected ? (isOptimized ? '#e8f5e9' : '#f0f7ff') : 'white';

        html += `<div class="job-item" onclick="toggleSelection(${index})" 
                      style="border-left: ${border}; background-color: ${bg}; padding: 8px; border-bottom: 1px solid #eee; cursor: pointer;">
            <div style="font-weight:500;">
                <span class="job-number" style="background-color:${job.selected ? color : '#ccc'}">${index + 1}</span> 
                ${job.name} 
            </div>
            <span style="color:#999; font-size:10px; margin-left: 28px;">${job.lat.toFixed(5)}, ${job.lon.toFixed(5)}</span>
        </div>`;
    });
    jobListDiv.innerHTML = html;
}

function highlightJobOnMap(index) {
    const job = jobList[index];
    if (!job) return;

    const coords = ol.proj.fromLonLat([job.lon, job.lat]);

    // 1. Animate the Map View (Zoom In)
    map.getView().animate({
        center: coords,
        zoom: 18, // Close up view
        duration: 1000 // 1 second smooth pan
    });

    // 2. Find the marker feature
    const features = routeMarkerSource.getFeatures();
    // We stored the 'index' in the feature earlier, so we find the match
    const feature = features.find(f => f.get('index') === index);

    if (feature) {
        // 3. "Flash" Effect
        // We temporarily make it huge, then shrink it back
        const originalStyle = feature.getStyle();
        
        // Create a temporary "Big" style
        const flashStyle = new ol.style.Style({
            image: new ol.style.Circle({
                radius: 20, // Huge radius
                fill: new ol.style.Fill({ color: 'rgba(255, 215, 0, 0.7)' }), // Gold color
                stroke: new ol.style.Stroke({ color: 'white', width: 3 })
            }),
            text: originalStyle.getText() // Keep the number
        });

        feature.setStyle(flashStyle);

        // Reset after 500ms (0.5 seconds)
        setTimeout(() => {
            feature.setStyle(originalStyle);
        }, 500);
    }
}

//zooms to specific job and visualize it
function updateMapMarkers() {
    routeMarkerSource.clear();
    jobList.forEach((job, index) => {
        const marker = new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.fromLonLat([job.lon, job.lat])),
            index: index
        });
        const color = job.selected ? '#007bff' : '#d62222';
        const radius = job.selected ? 9 : 7;
        
        marker.setStyle(new ol.style.Style({
            image: new ol.style.Circle({ radius: radius, fill: new ol.style.Fill({ color: color }), stroke: new ol.style.Stroke({ color: 'white', width: 2 }) }),
            text: new ol.style.Text({ text: (index + 1).toString(), offsetY: 1, font: 'bold 11px Arial', fill: new ol.style.Fill({ color: 'white' }) })
        }));
        routeMarkerSource.addFeature(marker);
    });
}

function toggleSelection(index) {
    jobList[index].selected = !jobList[index].selected;
    updateMapMarkers();
    renderJobList();
}

async function runOptimization() {
    const selectedJobs = jobList.filter(job => job.selected);
    if (selectedJobs.length < 2) {
        alert("Please select at least 2 Blue points.");
        return;
    }
    btnRunTsp.innerText = "Calculating...";
    btnRunTsp.disabled = true;

    const coordsArray = selectedJobs.map(j => [j.lon, j.lat]);
    const apiUrl = `http://10.1.4.18:3000/route/optimize?locations=${JSON.stringify(coordsArray)}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!data || !data.route_geometry) {
            alert("Optimization failed.");
        } else {
            handleSuccess(data);
        }
        
    } catch (err) {
        console.error(err);
        alert("Server Error.");
    } finally {
        btnRunTsp.innerText = "⚡ Optimize Route";
        btnRunTsp.disabled = false;
        if (isAddingJobs) toggleAddJobsMode();
    }
}

function handleSuccess(data) {
    routeSource.clear();
    drawRouteOnMap(data.route_geometry);
    // Re-order list based on server response
    jobList = data.stops.map(stop => ({
        lon: stop.lon,
        lat: stop.lat,
        name: `Stop #${stop.seq}`, 
        selected: true
    }));
    
    updateMapMarkers();
    renderJobList();
   optimizePanel.style.display = 'none';
    optimizeBtn.classList.remove('active');
    
    showMessage("Route Optimized! Open panel to review stops.");
}

function toggleAddJobsMode() {
    isAddingJobs = manualAdd;
    if (isAddingJobs) {
        // === ENTERING ADD MODE ===
        // 1. Hide the Big Panel so user can see the map
        optimizePanel.style.display = 'none';
        
        // 2. Show the Small "Done" Bar
        if (addingModeBar) {
            addingModeBar.style.display = 'flex';
            updateAddingCount(); // Update the "0 Selected" text
        }
        
        // 3. Change Cursor / Banner
        map.getTargetElement().style.cursor = 'copy'; // Plus cursor
        showMessage("Tap on map to add stops");
        
        // 4. Visual state for the button (in case panel re-opens)
        btnAddJobs.innerText = "Stop Adding";
        btnAddJobs.classList.add("active");

    } else {
        // === EXITING ADD MODE (Clicked Done) ===
        // 1. Hide the Small Bar
        if (addingModeBar) addingModeBar.style.display = 'none';
        
        // 2. Show the Big Panel again so user can Optimize
        optimizePanel.style.display = 'block';
        
        // 3. Reset Cursor
        map.getTargetElement().style.cursor = '';
        showMessage(null);
        
        // 4. Reset button state
        btnAddJobs.innerText = "+ Add Locations";
        btnAddJobs.classList.remove("active");
        
        // 5. Refresh list
        renderJobList();
    }
}

// =========================================================================
// 3b. ASSET SCANNER (The Button Logic) 
// =========================================================================
async function scanCriticalAssets() {
    try {
        showMessage("Scanning database for 'Poor' conditions...");
        
        // 1. Call the API
        const response = await fetch('https://10.1.4.18:3000/assets/critical');
        const assets = await response.json();
        
        if (!assets || assets.length === 0) {
            alert("Great news! No critical assets found.");
            showMessage(null);
            return;
        }

        // 2. Reset everything to clean state
        jobList = [];
        routeMarkerSource.clear();
        routeSource.clear();

        // 3. Limit items
        const limit = 20;
        const assetsToShow = assets.slice(0, limit);

        // 4. Add them using our helper
        assetsToShow.forEach((asset) => {
            if(asset.lon === null || asset.lat === null) return;

            addJobPoint(asset.lon, asset.lat, true, asset.name); // True = Critical (Red)
        });
        
        // Zoom to show all red dots
        const extent = routeMarkerSource.getExtent();
        map.getView().fit(extent, { padding: [50, 50, 50, 50], duration: 1000 });

        showMessage(`Found ${assets.length} critical assets. Click 'Optimize' to route.`);
        
        if (assets.length > limit) {
            alert(`Found ${assets.length} assets. Showing top ${limit} to avoid lag.`);
        }

    } catch (err) {
        console.error(err);
        alert("Failed to scan assets. Is server.js running?");
    }
}

// 1. MAIN OPTIMIZE BUTTON (Toggle Panel with Memory)
if (optimizeBtn) {
    optimizeBtn.addEventListener('click', () => {
        const isVisible = optimizePanel.style.display === 'block';
        
        // If panel is already open, just close it (toggle behavior)
        if (isVisible) {
            closeAllTools();
            return;
        }

        // If panel is closed, we want to OPEN it.
        // First, close conflicting tools (like Measure)
        if (isMeasuring) toggleMeasurement();
        // Note: We DON'T call resetRouteWizard() here because we want to keep the data!
        
        // Show the panel container
        optimizePanel.style.display = 'block';
        optimizeBtn.classList.add('active');

        // === INTELLIGENT VIEW SWITCHER ===
        if (jobList.length > 0) {
            // SCENARIO A: We have data (a route exists). Go straight to WORKSPACE.
            optMainMenu.style.display = 'none';
            optWorkspace.style.display = 'flex';
            btnBackMenu.style.display = 'block';
            
            // Restore correct title based on mode
            if (currentOptMode === 'manual') optTitle.innerText = "Manual Planner";
            else if (currentOptMode === 'bridge') optTitle.innerText = "Bridge Repair";
            else if (currentOptMode === 'culvert') optTitle.innerText = "Culvert Repair";
            
            // Ensure list is rendered
            renderJobList(); 
        } else {
            // SCENARIO B: New session. Go to MAIN MENU.
            showMainMenu(); 
        }
    });
}

// Menu Buttons
if (btnModeManual) btnModeManual.addEventListener('click', () => startMode('manual'));
if (btnModeBridge) btnModeBridge.addEventListener('click', () => startMode('bridge'));
if (btnModeCulvert) btnModeCulvert.addEventListener('click', () => startMode('culvert'));

// Back Button
if (btnBackMenu) btnBackMenu.addEventListener('click', () => {
    // Clear current work when going back? Or keep it? 
    // Usually better to clear to avoid confusion.
    jobList = [];
    routeMarkerSource.clear();
    routeSource.clear();
    showMainMenu();
});

// Workspace Buttons
if (btnAddJobs) btnAddJobs.addEventListener('click', () => enterFloatingMode(true));
if (btnRunTsp) btnRunTsp.addEventListener('click', runOptimization);
if (btnClearJobs) btnClearJobs.addEventListener('click', () => {
    jobList = [];
    routeMarkerSource.clear();
    routeSource.clear();
    renderJobList();
});
if (btnCloseOpt) btnCloseOpt.addEventListener('click', closeAllTools);

// =========================================================================
// 4. UI HELPERS
// =========================================================================

function showMessage(message) {
    if (routeBanner) {
        if (message) {
            routeBanner.textContent = message;
            routeBanner.style.display = 'block';
        } else {
            routeBanner.style.display = 'none';
        }
    }
}

function addMarker(coordinate, type) {
    const marker = new ol.Feature({ geometry: new ol.geom.Point(coordinate) });
    marker.setStyle(new ol.style.Style({
        image: new ol.style.Circle({
            radius: 8,
            fill: new ol.style.Fill({ color: type === 'Start' ? '#19A942' : '#D62222' }),
            stroke: new ol.style.Stroke({ color: 'white', width: 2 })
        })
    }));
    routeMarkerSource.addFeature(marker);
}

function resetRouteWizard() {
    routeMarkerSource.clear();
    routeSource.clear();
    startPoint = null;
    routeWizardState = 'idle';
    showMessage(null); 
    map.getTargetElement().style.cursor = '';
    routeBtn.classList.remove('active');
    if (routeOptionsPanel) routeOptionsPanel.style.display = 'none';
}

// A Helper to close ALL panels/modes to avoid conflicts
function closeAllTools() {
    // 1. Close Measurement
    if (isMeasuring) toggleMeasurement();
    // 2. Close Standard Routing
    resetRouteWizard();
    // 3. Close Optimization
    if (optimizePanel) optimizePanel.style.display = 'none';
    if (optimizeBtn) optimizeBtn.classList.remove('active');
    isAddingJobs = false;
    if (btnAddJobs) {
        btnAddJobs.innerText = "+ Add Locations";
        btnAddJobs.classList.remove("active");
    }
}

function getGpsForRouting() {
    if ('geolocation' in navigator) {
        showMessage("Finding your location...");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { longitude, latitude } = pos.coords;
                // Clear everything first
                closeAllTools();
                
                currentUserLocation = { lon: longitude, lat: latitude }; 
                startPoint = currentUserLocation; 
                
                // Activate Routing State manually
                routeWizardState = 'selectDest';
                routeBtn.classList.add('active');
                
                const mapCoords = ol.proj.fromLonLat([startPoint.lon, startPoint.lat]);
                addMarker(mapCoords, 'Start'); 
                showMessage("Click on map to set DESTINATION");
                map.getTargetElement().style.cursor = 'crosshair';

                map.getView().animate({ center: mapCoords, zoom: 16, duration: 1000 });
            },
            (err) => { alert('GPS Error.'); resetRouteWizard(); },
            { enableHighAccuracy: true }
        );
    } else { alert('Geolocation not supported.'); }
}

// =========================================================================
// 5. LISTENERS FOR STANDARD ROUTING
// =========================================================================
if (routeBtn) {
    routeBtn.addEventListener('click', () => {
        const isVisible = routeOptionsPanel && routeOptionsPanel.style.display === 'block';
        closeAllTools(); // Reset everything
        
        if (!isVisible) {
            if (routeOptionsPanel) routeOptionsPanel.style.display = 'block';
            routeBtn.classList.add('active');
        }
    });
}

if (btnRouteFromGps) btnRouteFromGps.addEventListener('click', getGpsForRouting);

if (btnRouteManual) {
    btnRouteManual.addEventListener('click', () => {
        closeAllTools();
        if (routeOptionsPanel) routeOptionsPanel.style.display = 'none'; // Hide panel, start wizard
        routeBtn.classList.add('active');
        
        routeWizardState = 'selectStart';
        showMessage("Click on map to set START point");
        map.getTargetElement().style.cursor = 'crosshair';
    });
}

// =========================================================================
// 6. MASTER CLICK HANDLER
// =========================================================================
map.on('click', function(evt) {
    
    // 1. Measure Check
    if (isMeasuring) return;

    const feature = map.forEachFeatureAtPixel(evt.pixel, function(feat) {
        return feat;
    });

    // If we clicked a job marker 
    if (feature && feature.get('index') !== undefined) {
        const idx = feature.get('index');
        
        // Toggle selection
        jobList[idx].selected = !jobList[idx].selected;
        
        // Redraw to show color change
        updateMapMarkers();
        renderJobList(); // Update checkbox in list
        return; 
    }

    // 2. Job Planner (Adding New Points on empty space)
    if (isAddingJobs) {
        const coords = ol.proj.toLonLat(evt.coordinate);
        // Manual adds are selected (Blue) by default
        addJobPoint(coords[0], coords[1], false, "Manual Selection"); 
        return;
    }

    // Priority 3: Standard Routing Wizard
    switch (routeWizardState) {
        case 'idle':
            // No tool active -> Show Info Popup
            handleRoadInfoClick(evt);
            break;

        case 'selectStart':
            const apiCoordsStart = ol.proj.toLonLat(evt.coordinate);
            startPoint = { lon: apiCoordsStart[0], lat: apiCoordsStart[1] };
            addMarker(evt.coordinate, 'Start');
            showMessage('Now select DESTINATION point');
            routeWizardState = 'selectDest';
            break;

        case 'selectDest':
            const apiCoordsEnd = ol.proj.toLonLat(evt.coordinate);
            const endPoint = { lon: apiCoordsEnd[0], lat: apiCoordsEnd[1] };
            addMarker(evt.coordinate, 'End');
            showMessage(null);
            getRoute(startPoint, endPoint);
            
            // Reset
            routeWizardState = 'idle'; 
            map.getTargetElement().style.cursor = '';
            routeBtn.classList.remove('active'); 
            break;
    }
});