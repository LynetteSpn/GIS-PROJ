let currentSearchField = 'road_name'; // Default search field
const filterOptions = {
    'road_name': 'Road Name',
    'pkm_road_id': 'PKM ID',
    'marris_id': 'Marris ID'
};

// Global filter variables (initialized here for clarity)
let currentDistrict = "ALL";
// Keep track of which road types are currently active (toggled ON)
let activeRoadTypes = new Set(); // Will be populated in Section 9

// =========================================================================
// LOADING OVERLAY SETUP
// =========================================================================
const loadingOverlay = document.createElement('div');
loadingOverlay.id = 'loading-overlay';
loadingOverlay.innerHTML = `
 <div class="spinner"></div>
 <p>Loading road data...</p>
`;
document.body.appendChild(loadingOverlay);

// CSS styling
const style = document.createElement('style');
style.textContent = `
 #loading-overlay {
 position: fixed;
 top: 0; left: 0;
 width: 100%; height: 100%;
 background: rgba(0,0,0,0.4);
 display: none; /* Starts hidden */
 justify-content: center;
 align-items: center;
 flex-direction: column;
 z-index: 9999;
 color: white;
 font-family: sans-serif;
 }
 .spinner {
 width: 40px;
 height: 40px;
 border: 4px solid #fff;
 border-top: 4px solid #00aaff;
 border-radius: 50%;
 animation: spin 1s linear infinite;
 }
 @keyframes spin { 100% { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

// =========================================================================
// 1. BASE LAYERS
// =========================================================================
const regularLayer = new ol.layer.Tile({
    source: new ol.source.OSM()
});

const satelliteLayer = new ol.layer.Tile({
    source: new ol.source.XYZ({
        url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        attributions: '© Google'
    })
});

const baseGroup = new ol.layer.Group({
    layers: [satelliteLayer, regularLayer]
});

satelliteLayer.setVisible(true);
regularLayer.setVisible(false);



// =========================================================================
// 2. STYLES (Must be defined before layers that use them)
// =========================================================================

// --- Base District Styles (No fill initially) ---
function osmDistrictStyle(feature) {
    const name = feature.get('NAME_2');
    const style = new ol.style.Style({
        stroke: new ol.style.Stroke({ color: 'black', width: 1 }),
        text: new ol.style.Text({
            text: name || "",
            font: '14px Calibri,sans-serif',
            fill: new ol.style.Fill({ color: '#000' }),
            stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
            overflow: false
        })
    });
    // Add transparent fill for hover/click detection
    style.setFill(new ol.style.Fill({ color: 'rgba(0,0,0,0.01)' }));
    return style;
}

function satelliteDistrictStyle(feature) {
    const name = feature.get('NAME_2');
    const style = new ol.style.Style({
        stroke: new ol.style.Stroke({ color: 'white', width: 1 }),
        text: new ol.style.Text({
            text: name || "",
            font: '14px Calibri,sans-serif',
            stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
            overflow: false
        })
    });
    // Add transparent fill for hover/click detection
    style.setFill(new ol.style.Fill({ color: 'rgba(0,0,0,0.01)' }));
    return style;
}

const roadColors = {
    'UNID': 'green',
    'MCDC': 'blue',
    'OTHER': 'gray',
    'PLANTATION': 'yellow',
    'JKR': 'red',
    'JLN KAMPUNG': 'orange',
    'FEDERAL': 'purple'
};

function roadStyle(feature) {
    const layer = feature.get('layer');
    const color = roadColors[layer] || 'black';
    return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: color, width: 2 })
    });
}

// --- Combined Road Filter Style (CRITICAL: Applied to roadVectorLayer) ---
function finalRoadStyle(feature) {
    const roadType = feature.get('layer');
    const districtCode = feature.get('district_code');

    const isRoadTypeActive = activeRoadTypes.has(roadType);
    const isDistrictActive = (currentDistrict === "ALL" || districtCode === currentDistrict);

    if (isRoadTypeActive && isDistrictActive) {
        return roadStyle(feature);
    }
    return null; // hide feature
}

// --- District Highlighting Style (CRITICAL: Applied to districtLayer) ---
function districtFilterStyle(feature) {
    const districtCode = feature.get('district_code');
    // Start with the base style (handles stroke/outline/text)
    const style = isSatellite ? satelliteDistrictStyle(feature) : osmDistrictStyle(feature);

    // Highlight the selected district with a visible fill
    if (districtCode === currentDistrict) {
        // Apply a semi-transparent yellow fill to clearly highlight the selected area
        style.setFill(new ol.style.Fill({ color: 'rgba(255, 255, 0, 0.3)' }));
    }

    return style;
}


// =========================================================================
// 3. OVERLAY LAYERS
// =========================================================================

// WMS ROAD LAYER (FAST VISUALIZATION - No local feature query)
const roadLayer = new ol.layer.Tile({
    source: new ol.source.TileWMS({
        url: 'https://unchagrined-undecomposed-jacob.ngrok-free.dev/geoserver/rmisv2db_prod/wms',
        crossOrigin: 'anonymous',
        params: {
            'REQUEST': 'GetMap',
            'SERVICE': 'WMS',
            'VERSION': '1.3.0',

            'LAYERS': 'rmisv2db_prod:1728_district',
            'STYLES': 'road_style',
            'TILED': true
        },
        serverType: 'geoserver'
    }),
    opacity: 1,
    maxZoom: 9.9 // CRITICAL: Visible only when zoomed out
});
roadLayer.set('name', 'RoadLayer');


// =========================================================================
// WFS ROAD LAYER (OPTIMIZED WITH BBOX STRATEGY)
// =========================================================================
const roadVectorLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
        format: new ol.format.GeoJSON(),
        // CRITICAL: Use ol.loadingstrategy.bbox to load only the visible extent
        strategy: ol.loadingstrategy.bbox, 
        
        // CRITICAL: Define a function to construct the URL with the current BBOX
        url: function(extent, resolution, projection) {
       
           // OpenLayers provides the current 'extent', 'resolution', and 'projection'.
            // We use 'extent' to build the BBOX filter.
            const srsCode = projection.getCode();
            
            // Note: Keep the GeoServer URL short; OpenLayers handles the BBOX parameter.
            return (
                'https://unchagrined-undecomposed-jacob.ngrok-free.dev/geoserver/rmisv2db_prod/ows?service=WFS&' +
                'version=1.0.0&request=GetFeature&typeName=	rmisv2db_prod:1728_district&' +
                'outputFormat=application/json&' +
                'srsName=' + srsCode + '&' +
                'bbox=' + extent.join(',') + ',' + srsCode // Appends the BBOX filter
            );
        }
    }),
    style: finalRoadStyle,
    minZoom: 10, // only visible when zoomed in
    visible: false // Start hidden
});
roadVectorLayer.set('name', 'RoadVectorLayer');

// =========================================================================
// !!! HOOK INTO WFS VECTOR REQUESTS FOR LOADING OVERLAY 
// =========================================================================
//Hook into GeoServer WFS source to show loading overlay
const roadSource = roadVectorLayer.getSource();

roadSource.on('vectorloadstart', () => {
    loadingOverlay.style.display = 'flex';
});

roadSource.on('vectorloadend', () => {
    loadingOverlay.style.display = 'none';
});

roadSource.on('vectorloaderror', () => {
    loadingOverlay.style.display = 'none';
    alert('Error loading road data from server.');
});


// CHAINAGE LAYER (WMS, controlled by legend)
const chainageLayer = new ol.layer.Tile({
    source: new ol.source.TileWMS({
        url: 'https://unchagrined-undecomposed-jacob.ngrok-free.dev/geoserver/chainage_bft/wms',
        params: {
            'LAYERS': 'chainage_bft:gis_chainage_kku_202510280845', // workspace:name
            'TILED': true
        },
        serverType: 'geoserver'
    }),
    opacity: 1,
    visible: false // hidden by default
});
chainageLayer.set('name', 'ChainageLayer');


const districtLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
        url: './sabah_district.geojson',
        format: new ol.format.GeoJSON()
    }),
    style: districtFilterStyle, // CRITICAL: Applies highlighting logic
    minZoom: 0,
    maxZoom: 22
});
districtLayer.set('name', 'DistrictLayer');

const highlightLayer = new ol.layer.Vector({
    source: new ol.source.Vector(),
    // Highlight layer style remains the same
    style: function (feature) {
        const featureColor = feature.get('highlight_color') || '#000';
        const roadName = feature.get('road_name');
        // ... (rest of highlight style definition)
        return [
            new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255, 255, 0, 0.8)', width: 8 }) }),
            new ol.style.Style({
                stroke: new ol.style.Stroke({ color: featureColor, width: 3 }),
                text: new ol.style.Text({
                    text: roadName || '',
                    font: 'bold 20px Calibri,sans-serif',
                    fill: new ol.style.Fill({ color: '#000' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
                    overflow: true,
                    placement: 'line'
                })
            })
        ];
    }
});


// =========================================================================
// 4. MAP INITIALIZATION (Layers are now defined)
// =========================================================================
const map = new ol.Map({
    target: 'map',
    layers: [baseGroup, districtLayer, roadLayer, roadVectorLayer, highlightLayer, chainageLayer],
    view: new ol.View({
        center: ol.proj.fromLonLat([117.04304, 5.21470]),
        zoom: 8
    })
});

// CRITICAL: Zoom level management for WMS vs Vector roads
map.getView().on('change:resolution', function () {
    const zoom = map.getView().getZoom();
    if (zoom >= 10) {
        roadVectorLayer.setVisible(true);
        roadLayer.setVisible(false);
    } else {
        roadVectorLayer.setVisible(false);
        roadLayer.setVisible(true);
    }
});


// =========================================================================
// 5. BASEMAP SWITCH LOGIC (Now safely uses districtLayer)
// =========================================================================
let isSatellite = true;
const basemapButton = document.getElementById('switchBasemap');

basemapButton.addEventListener('click', function () {
    if (isSatellite) {
        // switch to regular map
        satelliteLayer.setVisible(false);
        regularLayer.setVisible(true);
        districtLayer.setStyle(osmDistrictStyle); // Update base style
        basemapButton.title = "Switch to Satellite Imagery";
    } else {
        // switch back to satellite
        regularLayer.setVisible(false);
        satelliteLayer.setVisible(true);
        districtLayer.setStyle(satelliteDistrictStyle); // Update base style
        basemapButton.title = "Switch to Regular Map";
    }
    isSatellite = !isSatellite;
    // CRITICAL: Force the district layer to re-evaluate the highlighting fill
    districtLayer.changed();
});


// =========================================================================
// 6. ROAD SEARCH & AUTOSUGGEST LOGIC (WFS/Vector Query)
// ========================================================================

//search field selector logic
function filterBy(fieldName) {
    currentSearchField = fieldName;
    const roadSearchInput = document.getElementById("roadSearch");
    roadSearchInput.placeholder = "Search " + filterOptions[fieldName];
    roadSearchInput.value = "";
    document.getElementById("autocomplete-list").innerHTML = "";
}


const roadSearchInput = document.getElementById("roadSearch");
const autocompleteList = document.getElementById("autocomplete-list");

// This function will asynchronously fetch road names based on the current search text
function fetchRoadNames(searchText) {
    // CRITICAL: Use the roadVectorLayer for searching
    const allFeatures = roadVectorLayer.getSource().getFeatures();

    // Filter roads that match BOTH the search text AND the selected district
    const results = [...new Set(
        allFeatures
        .filter(f => {
            const fieldValue = (f.get(currentSearchField) || '').toLowerCase();
            const districtCode = f.get('district_code');
            const roadType = f.get('layer'); // Check road type filter as well

            const matchesText = fieldValue.includes(searchText.toLowerCase());
            const matchesDistrict = currentDistrict === "ALL" || districtCode === currentDistrict;
            const matchesType = activeRoadTypes.has(roadType);

            return matchesText && matchesDistrict && matchesType;
        })
        .map(f => f.get(currentSearchField))
    )];

    renderAutocomplete(results, currentSearchField);
}

function renderAutocomplete(results, fieldName) {
    autocompleteList.innerHTML = "";

    results.forEach(value => { // value is the ID or name
        const item = document.createElement("div");
        item.textContent = value; // Display the value (ID or Name)

        item.addEventListener("click", function () {
            roadSearchInput.value = value;
            autocompleteList.innerHTML = "";

            // CRITICAL: Pass BOTH the value AND the field name to zoomToFeature
            zoomToFeature(value, fieldName);
        });
        autocompleteList.appendChild(item);
    });
}
// Event listener calls the asynchronous function
roadSearchInput.addEventListener("input", function () {
    const val = this.value.trim();
    autocompleteList.innerHTML = "";

    if (val.length < 2) return; // Wait until user types at least 2 characters

    fetchRoadNames(val);
});

document.addEventListener("click", function (e) {
    if (e.target !== roadSearchInput) {
        autocompleteList.innerHTML = "";
    }
});

const toolbar = document.getElementById("toolbar");
const minimizeToolbarBtn = document.getElementById("minimize-toolbar");
let isToolbarMinimized = false;
minimizeToolbarBtn.addEventListener("click", function () {
    isToolbarMinimized = !isToolbarMinimized;
    toolbar.classList.toggle("minimized", isToolbarMinimized);
    if (isToolbarMinimized) {
        minimizeToolbarBtn.innerHTML = '<img src="search.png" alt="Search" style="width:17px;height:17px;">';
        minimizeToolbarBtn.title = "Maximize Toolbar";
    } else {
        minimizeToolbarBtn.innerHTML = "-";
        minimizeToolbarBtn.title = "Minimize Toolbar";
    }
});

// =========================================================================
// zoomToRoad FUNCTION (Fetches geometry on demand)
// =========================================================================
function zoomToFeature(value, fieldName) {
    highlightLayer.getSource().clear();
    // CRITICAL: Use the roadVectorLayer for finding features
    const allFeatures = roadVectorLayer.getSource().getFeatures();
    const feature = allFeatures.find(f => f.get(fieldName) === value);

    if (feature) {
        const originalColor = roadColors[feature.get('layer')] || 'black';
        const roadClone = feature.clone();
        roadClone.set('highlight_color', originalColor);
        roadClone.set('road_name', feature.get('road_name')); // Ensure label is preserved

        highlightLayer.getSource().addFeature(roadClone);

        map.getView().fit(feature.getGeometry().getExtent(), {
            duration: 1000,
            padding: [50, 50, 50, 50]
        });

    } else {
        console.warn(`Geometry for road '${value}' not found.`);
    }
}

// Reset button logic
document.getElementById("resetButton").addEventListener("click", function () {
    // Clear search input and autocomplete
    roadSearchInput.value = "";
    autocompleteList.innerHTML = "";
    // Clear highlight layer
    highlightLayer.getSource().clear();
});

// =========================================================================
// 7. CENTER ON CLICK LOGIC (Using toggle/recenter logic)
// =========================================================================
let centerOnClick = false;
const centerBtn = document.getElementById('center-button');

centerBtn.addEventListener('click', function () {
    // Toggle feature centering
    centerOnClick = !centerOnClick;
    centerBtn.classList.toggle('active', centerOnClick);

    // Recenter map on button click (as defined in your original code)
    map.getView().setCenter(ol.proj.fromLonLat([117.04304, 5.21470]));
    map.getView().setZoom(8);
});

map.on('click', function (evt) {
    if (!centerOnClick) return;

    map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
        // Only target vector layers that have a geometry extent to zoom to
        if (layer === districtLayer || layer === roadVectorLayer || layer === highlightLayer) {
            const geometry = feature.getGeometry();
            const extent = geometry.getExtent();
            map.getView().fit(extent, {
                duration: 1000,
                padding: [50, 50, 50, 50]
            });
            return true;
        }
    });
});


// =========================================================================
// 8. ROAD FILTER (Simplified)
// =========================================================================

function updateRoadFilter() {
    // 1. Force OpenLayers to re-evaluate the style function for roadVectorLayer
    roadVectorLayer.changed();

    // 2. Clear highlight and autocomplete after filter change
    highlightLayer.getSource().clear();
    document.getElementById("autocomplete-list").innerHTML = "";
}


//=========================================================================
// DISTRICT FILTER
//=========================================================================
document.getElementById("districtFilter").addEventListener("change", function (e) {
    const selectedDistrictName = e.target.options[e.target.selectedIndex].text;
    const selectedDistrictValue = e.target.value; // Assuming the value is the district_code or unique ID

    // Clear highlight layer
    highlightLayer.getSource().clear();

    // 1. Update the global district variable
    currentDistrict = (selectedDistrictName === "ALL DISTRICTS") ? "ALL" : selectedDistrictValue;

    // 2. Trigger updates for both road filtering and district highlighting
    updateRoadFilter(); // Re-filters the roadVectorLayer based on the new district
    districtLayer.changed(); // Forces the district layer to re-evaluate districtFilterStyle

    // 3. Handle "ALL DISTRICTS" view reset
    if (selectedDistrictName === "ALL DISTRICTS") {
        map.getView().setCenter(ol.proj.fromLonLat([117.04304, 5.21470]));
        map.getView().setZoom(8);
        return;
    }

    // 4. Zoom to the selected district (remains based on NAME_2)
    const districtFeatures = districtLayer.getSource().getFeatures();
    const selectedFeature = districtFeatures.find(f =>
        f.get("NAME_2") && f.get("NAME_2").toLowerCase() === selectedDistrictName.toLowerCase()
    );

    if (selectedFeature) {
        const extent = selectedFeature.getGeometry().getExtent();
        map.getView().fit(extent, {
            duration: 1000,
            padding: [80, 80, 80, 80]
        });
    } else {
        console.warn(`District '${selectedDistrictName}' not found in districtLayer.`);
    }
});


// =========================================================================
// 9. LEGEND BUILDER & TOGGLE LOGIC
// =========================================================================
const legendDiv = document.getElementById("legend");
const legendContent = legendDiv.querySelector(".legend-content");

// 9A. Build the legend content (items)
for (const [layerType, color] of Object.entries(roadColors)) {
    const item = document.createElement("div");
    item.className = "legend-item active"; // start active
    item.dataset.layer = layerType;

    // CRITICAL: Add all main layer types to activeRoadTypes for initial visibility
    activeRoadTypes.add(layerType);

    const colorBox = document.createElement("div");
    colorBox.className = "legend-color";
    colorBox.style.backgroundColor = color;

    const label = document.createElement("span");
    label.textContent = layerType;

    const labelContainer = document.createElement("div");
    labelContainer.className = "legend-label-container";
    labelContainer.appendChild(colorBox);
    labelContainer.appendChild(label);

    // Container for sub-legend items (hidden by default)
    const subLegend = document.createElement("div");
    subLegend.className = "sub-legend";
    subLegend.style.display = "none";

    // Handle the expandable MCDC
    if (layerType === "MCDC") {
        const expandBtn = document.createElement("button");
        expandBtn.className = "expand-btn";
        expandBtn.textContent = "+";
        labelContainer.insertBefore(expandBtn, label);

        // Create sub-item for Chainage
        const chainageItem = document.createElement("div");
        chainageItem.className = "sub-legend-item active";
        chainageItem.textContent = "Chainage";
        chainageItem.dataset.layer = "CHAINAGE"; // custom ID
        

        // When sub-item is clicked, toggle chainageLayer visibility
        chainageItem.addEventListener("click", (e) => {
            e.stopPropagation();
            const isActive = chainageItem.classList.toggle("disabled");
            chainageItem.classList.toggle("active", !isActive);
            chainageLayer.setVisible(!isActive);
        });

        subLegend.appendChild(chainageItem);

        // Expand/collapse MCDC section
        expandBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isVisible = subLegend.style.display === "block";
            subLegend.style.display = isVisible ? "none" : "block";
            expandBtn.textContent = isVisible ? "+" : "-";
        });
    }

    item.appendChild(labelContainer);
    item.appendChild(subLegend);
    legendContent.appendChild(item);

    // Click main item to toggle road type visibility
    item.addEventListener("click", () => {
        if (activeRoadTypes.has(layerType)) {
            activeRoadTypes.delete(layerType);
            item.classList.remove("active");
            item.classList.add("disabled");
        } else {
            activeRoadTypes.add(layerType);
            item.classList.add("active");
            item.classList.remove("disabled");
        }
        updateRoadFilter();
    });
}

// ** CRITICAL INIT CALL **
updateRoadFilter(); // Ensure initial road vector layer filtering is applied


// 9B. Legend toggle logic
const legendToggleBtn = document.getElementById("minimize-legend");
let isLegendMinimized = false;
legendToggleBtn.addEventListener("click", function () {
    isLegendMinimized = !isLegendMinimized;
    legendDiv.classList.toggle("minimized", isLegendMinimized);

    legendToggleBtn.textContent = isLegendMinimized ? "+" : "-";
    legendToggleBtn.title = isLegendMinimized ? "Maximize Legend" : "Minimize Legend";
});

// Initial state
legendDiv.classList.remove("minimized");
legendToggleBtn.textContent = "-";
legendToggleBtn.title = "Minimize Legend";

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