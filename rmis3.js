// === RMIS Unified Route/Optimization Logic ===
// Single entry: plannerBtn. All legacy route-btn & optimize-btn code removed. Last update: 2025-12-02

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

// =========================================================================
// 1. MEASUREMENT TOOL CODE (unchanged)
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
        closeAllTools(false);

        measureSource.clear(); 
        if (measureTooltipElement) {
            measureTooltipElement.style.display = 'block'; 
            measureTooltipElement.className = 'ol-tooltip ol-tooltip-measure';
        }
        addInteraction();
        map.getTargetElement().style.cursor = 'crosshair';
    } else {
        if (measureDraw) map.removeInteraction(measureDraw);
        if (measureTooltip) map.removeOverlay(measureTooltip);
        measureSource.clear();
        map.getTargetElement().style.cursor = '';
        measureBtn.classList.remove('active');
    }
}

if (measureBtn) measureBtn.addEventListener('click', () => {
     toggleMeasurement();
});

// =========================================================================
// ROUTE TO POPUP FUNCTION
// =========================================================================
window.routeToPopupLocation = function(destLon, destLat) {
    // 1. Check for Geolocation support
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by this browser.");
        return;
    }

    // 2. Visual Feedback (Change cursor)
    document.body.style.cursor = 'wait';
    const originalText = document.querySelector('.popup-footer button[onclick*="routeToPopupLocation"]').innerHTML;
    document.querySelector('.popup-footer button[onclick*="routeToPopupLocation"]').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Locating...';

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
                hideRoadInfo(); 
            } else {
                alert("Routing function (getRoute) is missing!");
            }
        },
        (error) => {
            document.body.style.cursor = 'default';
            alert("Unable to retrieve your location. Check permissions.");
            // Reset button text
            document.querySelector('.popup-footer button[onclick*="routeToPopupLocation"]').innerHTML = originalText;
        },
        { enableHighAccuracy: true }
    );
};

// =========================================================================
// 2. STANDARD ROUTING (Single Start/End)
// =========================================================================
async function getRoute(start, end) {
    routeSource.clear();
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
function showMainMenu() {
    jobList = [];
    routeMarkerSource.clear();
    routeSource.clear();
    if(isAddingJobs) toggleAddJobsMode(); // Stop adding if active
    optMainMenu.style.display = 'flex';
    optWorkspace.style.display = 'none';
    btnBackMenu.style.display = 'none';
    optTitle.innerText = "Route Planner";
}

async function startMode(mode) {
    currentOptMode = mode;
    optMainMenu.style.display = 'none';
    optWorkspace.style.display = 'flex';
    btnBackMenu.style.display = 'block';

    if (mode === 'manual') {
        optTitle.innerText = "Manual Planner";
        btnAddJobs.style.display = 'flex';
        renderJobList();
    } 
    else if (mode === 'bridge') {
        optTitle.innerText = "Bridge Repair";
        btnAddJobs.style.display = 'none';
        await scanAssets('bridge');
    } 
    else if (mode === 'culvert') {
        optTitle.innerText = "Culvert Repair";
        btnAddJobs.style.display = 'none';
        await scanAssets('culvert');
    }
}

function enterFloatingMode(manualAdd = false) {
    if (optimizePanel) optimizePanel.style.display = 'none';
    if (addingModeBar) addingModeBar.style.display = 'flex';
    isAddingJobs = manualAdd; 
    
    if (manualAdd) {
        map.getTargetElement().style.cursor = 'copy'; 
        showMessage("Tap map to add stops");
        if (btnAddJobs) {
            btnAddJobs.innerText = "Adding...";
            btnAddJobs.classList.add("active");
        }
    } else {
        map.getTargetElement().style.cursor = ''; 
        showMessage("Tap dots to Select (Blue) / Unselect (Red)");
    }
    updateAddingCount();
}

function exitFloatingMode() {
    if (optimizePanel) optimizePanel.style.display = 'block';
    if (addingModeBar) addingModeBar.style.display = 'none';
    isAddingJobs = false;
    map.getTargetElement().style.cursor = '';
    showMessage(null);
    if (btnAddJobs) {
        btnAddJobs.innerText = "+ Add Locations";
        btnAddJobs.classList.remove("active");
    }
    renderJobList();
}

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
        jobList = [];
        routeMarkerSource.clear();
        routeSource.clear();

        const limit = 50;
        const assetsToShow = assets.slice(0, limit);

        assetsToShow.forEach((asset) => {
            if (asset.lon === null || asset.lat === null) return;
            addJobPoint(asset.lon, asset.lat, true, asset.name); 
        });
        
        const extent = routeMarkerSource.getExtent();
        if (!ol.extent.isEmpty(extent)) {
            map.getView().fit(extent, { padding: [50, 50, 50, 50], duration: 1000 });
        }
        optimizePanel.style.display = 'none'; 
        showMessage(`Found ${assets.length} assets. Tap dots to Select (Blue), then open menu to Optimize.`);
        enterFloatingMode();
    } catch (err) {
        console.error(err);
        alert("Scan failed. Check server.");
    }
}

// Job Points Add/Update UI
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

if (btnFinishAdding){
    btnFinishAdding.addEventListener('click', exitFloatingMode);
}

function renderJobList() {
    if (jobList.length === 0) {
        jobListDiv.innerHTML = '<div style="color:#999;text-align:center;margin-top:20px;">No jobs added.<br>Select a mode to begin.</div>';
        return;
    }
    let html = '';
    jobList.forEach((job, index) => {
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
    map.getView().animate({ center: coords, zoom: 18, duration: 1000 });
    const features = routeMarkerSource.getFeatures();
    const feature = features.find(f => f.get('index') === index);
    if (feature) {
        const originalStyle = feature.getStyle();
        const flashStyle = new ol.style.Style({
            image: new ol.style.Circle({
                radius: 20,
                fill: new ol.style.Fill({ color: 'rgba(255, 215, 0, 0.7)' }),
                stroke: new ol.style.Stroke({ color: 'white', width: 3 })
            }),
            text: originalStyle.getText()
        });
        feature.setStyle(flashStyle);
        setTimeout(() => {
            feature.setStyle(originalStyle);
        }, 500);
    }
}

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
        btnRunTsp.innerText = "Optimize Route";
        btnRunTsp.disabled = false;
        if (isAddingJobs) toggleAddJobsMode();
    }
}

function handleSuccess(data) {
    routeSource.clear();
    drawRouteOnMap(data.route_geometry);
    jobList = data.stops.map(stop => ({
        lon: stop.lon,
        lat: stop.lat,
        name: `Stop #${stop.seq}`,
        selected: true
    }));
    updateMapMarkers();
    renderJobList();
    optimizePanel.style.display = 'none';
    showMessage("Route Optimized! Open panel to review stops.");
}

function toggleAddJobsMode() {
    if (isAddingJobs) {
        optimizePanel.style.display = 'none';
        if (addingModeBar) {
            addingModeBar.style.display = 'flex';
            updateAddingCount();
        }
        map.getTargetElement().style.cursor = 'copy';
        showMessage("Tap on map to add stops");
        btnAddJobs.innerText = "Stop Adding";
        btnAddJobs.classList.add("active");

    } else {
        if (addingModeBar) addingModeBar.style.display = 'none';
        optimizePanel.style.display = 'block';
        map.getTargetElement().style.cursor = '';
        showMessage(null);
        btnAddJobs.innerText = "+ Add Locations";
        btnAddJobs.classList.remove("active");
        renderJobList();
    }
}

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
}

// A Helper to close ALL panels/modes to avoid conflicts
function closeAllTools(includeMeasure = true) {

    if (includeMeasure && isMeasuring){
        toggleMeasurement();
        return;
    } 

    resetRouteWizard();

    if (optimizePanel) optimizePanel.style.display = 'none';
    isAddingJobs = false;

    if (btnAddJobs) {
        btnAddJobs.innerText = "+ Add Locations";
        btnAddJobs.classList.remove("active");
    }
}

// =========================================================================
// 5. Route Planner Entry & Menu
// =========================================================================

// Main entry point, replaces both route and optimize buttons!
if (plannerBtn) {
    plannerBtn.addEventListener('click', () => {
        closeAllTools();
        optimizePanel.style.display = 'block';
        showMainMenu();
    });
}

// Option Handlers
if(btnModeGps) {
    btnModeGps.addEventListener('click', () => {
        optimizePanel.style.display = 'none';
        getGpsForRouting();
    });
}
if(btnModeManualStart) {
    btnModeManualStart.addEventListener('click', () => {
        optimizePanel.style.display = 'none';
        routeWizardState = 'selectStart';
        showMessage("Click on map to set START point");
        map.getTargetElement().style.cursor = 'crosshair';
    });
}
if(btnModeMultiStop) {
    btnModeMultiStop.addEventListener('click', () => startMode('manual'));
}
if(btnModeBridge) {
    btnModeBridge.addEventListener('click', () => startMode('bridge'));
}
if(btnModeCulvert) {
    btnModeCulvert.addEventListener('click', () => startMode('culvert'));
}

// Back/Workspace/Close handlers
if (btnBackMenu) btnBackMenu.addEventListener('click', () => {
    jobList = [];
    routeMarkerSource.clear();
    routeSource.clear();
    showMainMenu();
});
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
// 6. MASTER CLICK HANDLER
// =========================================================================
map.on('click', function(evt) {
    if (isMeasuring) return;
    const feature = map.forEachFeatureAtPixel(evt.pixel, function(feat) { return feat; });

    if (feature && feature.get('index') !== undefined) {
        const idx = feature.get('index');
        jobList[idx].selected = !jobList[idx].selected;
        updateMapMarkers();
        renderJobList();
        return; 
    }

    if (isAddingJobs) {
        const coords = ol.proj.toLonLat(evt.coordinate);
        addJobPoint(coords[0], coords[1], false, "Manual Selection"); 
        return;
    }

    switch (routeWizardState) {
        case 'idle':
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
            routeWizardState = 'idle';
            map.getTargetElement().style.cursor = '';
            break;
    }
});

// =========================================================================
// 7. GPS Routing Logic (no legacy button needed)
// =========================================================================
function getGpsForRouting() {
    if ('geolocation' in navigator) {
        showMessage("Finding your location...");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { longitude, latitude } = pos.coords;
                closeAllTools();
                currentUserLocation = { lon: longitude, lat: latitude}; 
                startPoint = currentUserLocation; 
                routeWizardState = 'selectDest';
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