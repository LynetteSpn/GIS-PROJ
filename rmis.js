let currentSearchField = 'road_name'; // Default search field
const filterOptions = {
    'road_name': 'Road Name',
    'pkm_road_id': 'PKM ID',
    'marris_id': 'Marris ID',
    'zone_name': 'Zone Name',
    'taman': 'Area Name',
    'rdcat_code' : 'Road Category',
    'dun_code': 'DUN Code'
};

// Global filter variables
let currentDistrict = "ALL";
// Keep track of which road types are currently active (toggled ON)
let activeRoadTypes = new Set(); 
let lastSearchResults = []; // Store last search results for zooming

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

const labelsLayer = new ol.layer.Tile({
  source: new ol.source.XYZ({
    // 'h' is for Hybrid (roads, labels, boundaries)
    url: 'https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}', 
    attributions: '© Google',
    // Set layer as transparent so it shows the satellite layer beneath it
    cacheSize: 0 
  }),
  // Set opacity high (e.g., 0.99) to make sure it renders on top
  opacity: 0.99 
});

satelliteLayer.getSource().on('tileloaderror', () => {
  console.warn("Google tile failed; switching to ESRI backup.");
  satelliteLayer.setSource(new ol.source.XYZ({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  }));
});

const baseGroup = new ol.layer.Group({
    layers: [satelliteLayer,labelsLayer, regularLayer]
});

satelliteLayer.setVisible(true);
regularLayer.setVisible(false);
regularLayer.setVisible(false);

// =========================================================================
// 2. STYLES 
// =========================================================================
// --- Base District Styles ---
function osmDistrictStyle(feature) {
    const name = feature.get('NAME_2');
    const style = new ol.style.Style({
        stroke: new ol.style.Stroke({ color: 'transparent', width: 1 }),
        text: new ol.style.Text({
            text: name || "",
            font: '14px Calibri,sans-serif',
            fill: new ol.style.Fill({ color: 'transparent' }),
            stroke: new ol.style.Stroke({ color: '#000000ff', width: 0.5 }),
            overflow: false
        })
    });
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

// --- Highlight Style (Used for WFS-on-Demand result) ---
function highlightRoadStyle(feature) {
    // This style expects the feature to be a full vector feature fetched via WFS
    const layer = feature.get('layer'); 
    const color = roadColors[layer] || 'black';
    const roadName = feature.get('road_name') || '';

    return [
        new ol.style.Style({
            stroke: new ol.style.Stroke({ color: color, width: 3 }),
            text: new ol.style.Text({
                text: roadName,
                font: 'bold 10px Calibri,sans-serif',
                fill: new ol.style.Fill({ color: '#000' }),
                stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
                overflow: false,
                placement: 'line',
                minZoom: 14
            })
        }),
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(0, 255, 242, 0.8)', width: 8 }) })
    ];
}

// --- District Filter Style (Applies the highlight fill) ---
function districtFilterStyle(feature) {
    const districtCode = feature.get('district_code');
    const style = isSatellite ? satelliteDistrictStyle(feature) : osmDistrictStyle(feature);

    if (districtCode === currentDistrict) {
        style.setFill(new ol.style.Fill({ color: 'rgba(255, 255, 0, 0.3)' }));
    }
    return style;
}

// =========================================================================
// 3. OVERLAY LAYERS
// =========================================================================
// WMS ROAD LAYER (FAST VISUALIZATION - Now handles display at all zoom levels)
const roadLayerSource = new ol.source.TileWMS({
    url: 'https://10.1.4.18/geoserver/rmisv2db_prod/wms',
    params: {
        'LAYERS': 'rmisv2db_prod:gis_sabah_road_map',
        'STYLES': 'road_style',
        'TILED': true,
        'cql_filter': '1=1' 
    },
    useInterimTilesOnError: true,
    serverType: 'geoserver'
});

const roadLayer = new ol.layer.Tile({
    source: roadLayerSource,
    opacity: 1
});
roadLayer.set('name', 'RoadLayer');

//CULVERT LAYER
const culvertLayerSource = new ol.source.TileWMS({
    url: 'https://10.1.4.18/geoserver/rmisv2db_prod/wms',
    params : {
        'LAYERS' : 'rmisv2db_prod:tbl_culvert',
        'TILED' : true,
        'STYLES' : 'culvert_style'
    },
    serverType : 'geoserver'
});

const culvertLayer = new ol.layer.Tile({
    source: culvertLayerSource,
    opacity: 1,
    visible: false
});
culvertLayer.set('name',"CulvertLayer");

//BRIDGES LAYER
const bridgeLayerSource = new ol.source.TileWMS({
    url: 'https://10.1.4.18/geoserver/rmisv2db_prod/wms',
    params : {
        'LAYERS' : 'rmisv2db_prod:tbl_bridge',
        'TILED' : true,
        'STYLES' : 'bridge_style'
    },
    serverType : 'geoserver'
});

const bridgeLayer = new ol.layer.Tile({
    source: bridgeLayerSource,
    opacity: 1,
    visible: false
});

bridgeLayer.set('name',"BridgeLayer");

//bridges and culverts group
const bridgeCulvertGroup = new ol.layer.Group({
    title: 'Bridges & Culverts',
    layers: [
        culvertLayer,
        bridgeLayer
    ],
    visible:false
});

// CHAINAGE LAYER (WMS, controlled by legend)
const chainageLayer = new ol.layer.Tile({
    source: new ol.source.TileWMS({
        url: 'https://10.1.4.18/geoserver/rmisv2db_prod/wms',
        params: {
            'LAYERS': 'rmisv2db_prod:gis_chainage', 
            'TILED': true,
            'STYLES': 'chainage_point_style'
        },
        serverType: 'geoserver'
    }),
    opacity: 1,
    visible: false,
    minZoom: 16
});
chainageLayer.set('name', 'ChainageLayer');

//LMC ROAD LAYER
const lmcRoadLayer = new ol.layer.Tile({
    title: 'LMC2025',
    source : new ol.source.TileWMS({
        url: 'https://10.1.4.18/geoserver/rmisv2db_prod/wms',
        params: {
            'LAYERS': 'rmisv2db_prod:lmc_road',
            'TILED': true,
            'STYLES': 'lmc_style'
        },
        serverType: 'geoserver'
    }),
    visible: false,
});
lmcRoadLayer.set('name','lmcLayer');

//SABAH DISTRICT LAYER
const districtLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
        url: './sabah_district.geojson',
        format: new ol.format.GeoJSON()
    }),
    style: districtFilterStyle,
    minZoom: 0,
    maxZoom: 22
});
districtLayer.set('name', 'DistrictLayer');

const highlightLayer = new ol.layer.Vector({
    source: new ol.source.Vector(),
    style: highlightRoadStyle
});

//PGROUTING ROUTE LAYER
const routeSource = new ol.source.Vector();

const routeLayer = new ol.layer.Vector({
    source: routeSource,
    style: new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: '#00ff6aff',
            width: 6
        })
    })
})

const routeMarkerSource = new ol.source.Vector();
const routeMarkerLayer = new ol.layer.Vector({
    source: routeMarkerSource,
    style: new ol.style.Style({
        image: new ol.style.Style({
            radius: 8,
            fill: new ol.style.Fill({color: '#ff0000'}),
            stroke: new ol.style.Stroke({color: '#ffffff', width: 2})   
        })
    })
});

// =========================================================================
// 4. MAP INITIALIZATION 
// =========================================================================
const map = new ol.Map({
    target: 'map',
    layers: [baseGroup, lmcRoadLayer, roadLayer, bridgeCulvertGroup, districtLayer, routeLayer, routeMarkerLayer,chainageLayer, highlightLayer],
    view: new ol.View({
        center: ol.proj.fromLonLat([117.04304, 5.21470]),
        zoom: 8,
        maxZoom: 22
    })
});

map.on('moveend', function() {
    if (dashboardPanel.style.display === 'block') {
        updateDashboardCharts();
    }
});

// =========================================================================
// 5. BASEMAP SWITCH LOGIC
// =========================================================================
// Use a string to track the current mode
let currentBasemap = 'SATELLITE'; // SATELLITE, HYBRID, REGULAR
const basemapButton = document.getElementById('switchBasemap');

// A helper function to manage visibility
function setBasemap(mode) {
    if (mode === 'REGULAR') {
        // Show Regular (OSM), Hide Satellite & Labels
        regularLayer.setVisible(true);
        satelliteLayer.setVisible(false);
        labelsLayer.setVisible(false); 
        
        // Update Tooltip for next click
        basemapButton.title = "Switch to Satellite Imagery";
        
    } else { 
        // Mode is 'SATELLITE'
        // Show Satellite, Hide Regular & Labels
        regularLayer.setVisible(false);
        satelliteLayer.setVisible(true);
        labelsLayer.setVisible(false); 
        
        // Update Tooltip for next click
        basemapButton.title = "Switch to Regular Map";
    }
    
    currentBasemap = mode;

    // Update global variable for styles
    // (Previously matched SATELLITE or HYBRID, now just SATELLITE)
    isSatellite = (mode === 'SATELLITE');
    
    // Refresh district layer styles to match the new basemap
    if (typeof districtLayer !== 'undefined') {
        districtLayer.setStyle(districtFilterStyle); 
        districtLayer.changed();
    }
}

// Simple Toggle Listener (A -> B -> A)
basemapButton.addEventListener('click', function () {
    if (currentBasemap === 'SATELLITE') {
        setBasemap('REGULAR');
    } else {
        setBasemap('SATELLITE');
    }
});

// Ensure initial state is set correctly (required due to the new variable)
setBasemap(currentBasemap);

//OPTIMIOZE VERSION ROAD SEARCH FILTER 
const searchTypeToView = {
    'road_name':'gis_sabah_road_map',
    'pkm_road_id':'gis_sabah_road_map',
    'marris_id':'gis_sabah_road_map',
    'zone_name':'vw_search_zone_name', // need to configure new query in geoserver
    'taman':'vw_search_taman', // need to configure new query in geoserver
    'rdcat_code':'vw_search_rdcat_code', // need to configure new query in geoserver
    'dun_code':'vw_search_dun_code' // need to configure new query in geoserver
};

// =========================================================================
// WFS HELPER FUNCTION (Targeted query only)
// =========================================================================
/**
 * Executes a targeted WFS query to GeoServer based on a filter.
 * @param {string} viewName - Name of the geoserver view/layer to query.
 * @param {string} cqlFilter - The CQL filter string.
 * @returns {Promise<ol.Feature[]>} A promise that resolves with an array of OpenLayers features.
 */
function queryWFS(viewName, cqlFilter) {
    let finalCql = cqlFilter;

    if(activeRoadTypes.size > 0 && activeRoadTypes.size < Object.keys(roadColors).length) {
        const types = Array.from(activeRoadTypes).map(type => `'${type}'`).join(',');
        const typeFilter = `"layer" IN (${types})`;
        finalCql = `(${cqlFilter}) AND (${typeFilter})`;
    }else if(activeRoadTypes.size === 0) {
        finalCql = "1=0"; // No types active, return no results
    }

    // We are requesting the geometry and attributes for filtering/highlighting
    const url = (
        'https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&' +
        'version=1.0.0&request=GetFeature&typeName=rmisv2db_prod:'+ viewName + '&' +
        'outputFormat=application/json&srsName=EPSG:4326&' +
        'cql_filter=' + encodeURIComponent(finalCql)+ // Use finalCql here
        '&maxFeatures=100' +
        '&_=' + Date.now()
    );

    return fetch(url)
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => { throw new Error(`WFS request failed: ${text.substring(0, 150)}...`); });
            }
            return response.json();
        })
        .then(data => {
            const format = new ol.format.GeoJSON();
            return format.readFeatures(data);
        })
        .catch(error => {
            console.error("Error fetching WFS data:", error);
            document.getElementById("autocomplete-list").innerHTML = "";
            return [];
        });
}

const SPATIAL_LAYER = 'rmisv2db_prod:gis_sabah_road_map';
const ATTRIBUTE_LAYER = 'rmisv2db_prod:vw_road_map2';
const DIRECT_SEARCH_FIELDS = ['road_name', 'pkm_road_id', 'marris_id'];

//THIS IS FOR THE FETCHING AVAILABILITY OF CULVERTS AND BRIDGES 
//FOR SHOWINFO POPUP (IF CHECKBOXBC IS CHECKED)
// =========================================================================
// DEEP DEBUG: FETCH NEARBY ASSETS
// =========================================================================
async function fetchNearbyAssets(lon, lat) {
    console.log(`%c 🔍 STARTING ASSET SEARCH at ${lat}, ${lon}`, 'background: #222; color: #bada55');
    
    const bcCheckbox = document.getElementById("BCCheckbox");
    if (!bcCheckbox || !bcCheckbox.checked) {
        console.log("Asset Search skipped: Checkbox OFF or Missing.");
        return [];
    }

    // Increased buffer slightly to ensure we catch the feature
    const buffer = 0.00050; 
    const cql = `BBOX(geom, ${lon - buffer}, ${lat - buffer}, ${lon + buffer}, ${lat + buffer}, 'EPSG:4326')`;
    
    const queries = [
        { type: 'Bridge', layer: 'rmisv2db_prod:tbl_bridge' },
        { type: 'Culvert', layer: 'rmisv2db_prod:tbl_culvert' }
    ];

    const promises = queries.map(async (q) => {
        const url = (
            'https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&' +
            'version=1.0.0&request=GetFeature&typeName=' + q.layer + '&' +
            'outputFormat=application/json&cql_filter=' + encodeURIComponent(cql) +
            '&maxFeatures=5&_=' + Date.now()
        );

        try {
            const res = await fetch(url);
            
            // 1. Check Network Status
            if (!res.ok) {
                console.error(`HTTP Error for ${q.type}: ${res.status}`);
                return [];
            }

            // 2. Read RAW TEXT first (Debugging Step)
            const text = await res.text();

            // 3. Parse JSON manually
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.error(`JSON Parse Error for ${q.type}. Server likely sent XML.`, e);
                return [];
            }

            // 4. Check Features
            if (data && data.features && data.features.length > 0) {
                console.log(`FOUND ${data.features.length} ${q.type}(s)!`);
                return data.features.map(f => {
                    f.properties._assetType = q.type;
                    return f;
                });
            } else {
                console.log(`0 features found for ${q.type}`);
                return [];
            }

        } catch (err) {
            console.error(`CRITICAL FETCH ERROR for ${q.type}:`, err);
            return [];
        }
    });

    const results = await Promise.all(promises);
    const finalAssets = results.flat().filter(item => item !== null && item !== undefined);
    return finalAssets;
}

// Helper: Fetch extended attributes from the heavy view using ID
async function fetchExtendedAttributes(roadId) {
    // We filter by ID, which is extremely fast even on large tables
    const cql = `pkm_road_id = '${roadId}'`;
    
    const url = (
        'https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&' +
        'version=1.0.0&request=GetFeature&' +
        'typeName=rmisv2db_prod:vw_road_map2&' + 
        'outputFormat=application/json&' +
        'cql_filter=' + encodeURIComponent(cql) +
        '&maxFeatures=1&_=' + Date.now()
    );

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Attribute fetch failed");
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            return data.features[0].properties; // Return just the properties
        }
    } catch (err) {
        console.warn("Could not fetch extended attributes:", err);
    }
    return null;
}

// async function getChainageRange(roadId) {
//     // Layer name confirmed from your chainage WMS layer:
//     const chainageTypeName = 'rmisv2db_prod:gis_chainage'; 

//     // Filter by the unique road ID field ('pkm_road_id')
//     const cql = `"pkm_road_id"='${roadId}'`; 

//     // Build the WFS request URL
//     const url = (
//         'https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&' + 
//         'version=1.0.0&request=GetFeature&typeName=' + chainageTypeName + '&' +
//         'outputFormat=application/json&srsName=EPSG:4326&' +
//         'cql_filter=' + encodeURIComponent(cql) +
//         '&propertyname=distance' + // Request ONLY the distance field
//         '&maxFeatures=10000&sortBy=distance&_=' + Date.now()
//     );

//     try {
//         const response = await fetch(url);
//         if (!response.ok) throw new Error('Chainage WFS failed');
        
//         const data = await response.json();
//         // Use GeoJSON format reader to parse features
//         const features = new ol.format.GeoJSON().readFeatures(data);
        
//         if (features && features.length > 0) {
//             let minChainage = Infinity;
//             let maxChainage = -Infinity;
            
//             features.forEach(f => {
//                 // Read the 'distance' property
//                 const val = parseFloat(f.get('distance')); 
//                 if (!isNaN(val)) {
//                     if (val < minChainage) minChainage = val;
//                     if (val > maxChainage) maxChainage = val;
//                 }
//             });

//             return {
//                 start: minChainage !== Infinity ? minChainage : null,
//                 end: maxChainage !== -Infinity ? maxChainage : null
//             };
//         }
//         return { start: null, end: null };
        
//     } catch (error) {
//         console.error("Error fetching chainage distance data:", error);
//         return { start: null, end: null };
//     }
// }

// =========================================================================
// 6. ROAD SEARCH & AUTOSUGGEST LOGIC (WFS-on-Demand Re-enabled)
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
roadSearchInput.disabled = false; // Re-enabled

// This function now uses WFS to search the GeoServer
async function fetchRoadNames(searchText) {
    autocompleteList.innerHTML = "Searching...";

    const viewName = searchTypeToView[currentSearchField];
    if (!viewName) {
        autocompleteList.innerHTML = "Invalid search field.";
        return;
    }
    
    // 1. Build the CQL Filter for GeoServer
    // Use ILIKE for case-insensitive partial matching
    let cql = `${currentSearchField} ILIKE '%${searchText}%'`;
    
    // Add district filter if applicable
    if (currentDistrict !== "ALL") {
        cql += ` AND district_code = '${currentDistrict}'`;
    }
    
    // Add road type filter if applicable (optional, but good for narrowing results)
    if (activeRoadTypes.size > 0 && activeRoadTypes.size < Object.keys(roadColors).length) {
        const types = Array.from(activeRoadTypes).map(type => `'${type}'`).join(',');
        cql += ` AND "layer" IN (${types})`;
    }

    // 2. Query GeoServer to get filtered features
    const features = await queryWFS(viewName, cql);
    
    // 3. Extract unique road names/IDs from the results
    const results = [...new Set(
        features
        .map(f => f.get(currentSearchField))
        .filter(Boolean) 
    )];

    renderAutocomplete(results, currentSearchField);
}

function renderAutocomplete(results, fieldName) {
    autocompleteList.innerHTML = "";

    results.forEach(value => { 
        const item = document.createElement("div");
        item.textContent = value; 

        item.addEventListener("click", function () {
            roadSearchInput.value = value;
            autocompleteList.innerHTML = "";

            // Call a new function to fetch the full feature with geometry
            fetchAndZoomToFeature(fieldName, value);
        });
        autocompleteList.appendChild(item);
    });
}

// =========================================================================
// SEARCH FUNCTION: ZOOMS AND FETCHES DETAILS
// =========================================================================
async function fetchAndZoomToFeature(fieldName, fieldValue) {
    let features = [];
    let cql = `${fieldName} = '${fieldValue}'`;
    if (currentDistrict !== "ALL") cql += ` AND district_code = '${currentDistrict}'`;

    document.body.style.cursor = 'wait';

    try {
        // --- STEP 1: FIND ROAD (Same as your logic) ---
        if (DIRECT_SEARCH_FIELDS.includes(fieldName)) {
            const url = `https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${SPATIAL_LAYER}&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${encodeURIComponent(cql)}&maxFeatures=100&_=${Date.now()}`;
            const response = await fetch(url);
            const data = await response.json();
            features = new ol.format.GeoJSON().readFeatures(data);
        } else {
            // Indirect logic (keep your existing indirect logic here)
            const idUrl = `https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${ATTRIBUTE_LAYER}&outputFormat=application/json&propertyName=pkm_road_id&cql_filter=${encodeURIComponent(cql)}&maxFeatures=500&_=${Date.now()}`;
            const idRes = await fetch(idUrl);
            const idData = await idRes.json();
            if (idData.features && idData.features.length > 0) {
                const ids = [...new Set(idData.features.map(f => f.properties.pkm_road_id).filter(Boolean))];
                if(ids.length > 0) {
                    const geomCql = `pkm_road_id IN (${ids.map(id => `'${id}'`).join(',')})`;
                    const geomUrl = `https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${SPATIAL_LAYER}&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${encodeURIComponent(geomCql)}&_=${Date.now()}`;
                    const geomRes = await fetch(geomUrl);
                    const geomData = await geomRes.json();
                    features = new ol.format.GeoJSON().readFeatures(geomData);
                }
            }
        }

        // --- STEP 2: PROCESS RESULTS ---
        if (features.length > 0) {
            zoomToFeatures(features);

            // ONLY OPEN POPUP IF SINGLE RESULT (or direct search)
            if (features.length === 1 || DIRECT_SEARCH_FIELDS.includes(fieldName)) {
                const mainFeature = features[0];
                const roadId = mainFeature.get('pkm_road_id');

                if (roadId) {
                    const extendedProps = await fetchExtendedAttributes(roadId);
                    if (extendedProps) {
                        mainFeature.setProperties(extendedProps);

                        // Calculate Geom Center
                        const geom = mainFeature.getGeometry();
                        const extent = geom.getExtent();
                        const center = ol.extent.getCenter(extent); // EPSG:3857
                        
                        // Convert Center to LatLon for Asset Query
                        const centerLonLat = ol.proj.toLonLat(center);

                        // Calculate Coordinates Strings
                        if (!mainFeature.get('start_chainage') && geom) {
                             const clone = geom.clone().transform(map.getView().getProjection(), 'EPSG:4326');
                             const coords = clone.getCoordinates();
                             if(coords.length >= 2) {
                                const start = coords[0];
                                const end = coords[coords.length-1];
                                mainFeature.set('start_node_coord', `${start[1].toFixed(6)} ${start[0].toFixed(6)}`);
                                mainFeature.set('end_node_coord', `${end[1].toFixed(6)} ${end[0].toFixed(6)}`);
                             }
                        }

                        // --- NEW: FETCH ASSETS FOR SEARCH RESULT ---
                        const nearbyAssets = await fetchNearbyAssets(centerLonLat[0], centerLonLat[1]);

                        // Trigger Popup
                        showRoadInfo(mainFeature, center, nearbyAssets);
                    }
                }
            }
        } else {
            alert("No road geometry found.");
        }
    } catch (err) {
        console.error("Search Error:", err);
    } finally {
        document.body.style.cursor = 'default';
    }
}

// Event listener calls the asynchronous function
roadSearchInput.addEventListener("input", function () {
    const val = this.value.trim();
    autocompleteList.innerHTML = "";

    // IMPORTANT: Wait until user types at least 2 characters to prevent large initial requests
    if (val.length < 2) return; 

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
// zoomToFeatures FUNCTION (Handles multiple features and collective extent)
// =========================================================================
function zoomToFeatures(features) {
    highlightLayer.getSource().clear(); // Clear previous highlights

    if (features && features.length > 0) {
        let fullExtent = ol.extent.createEmpty();

        features.forEach(feature => {
            if (feature.getGeometry()) {
                const roadClone = feature.clone();
                
                // Transform geometry to map projection before adding and calculating extent
                roadClone.getGeometry().transform('EPSG:4326', map.getView().getProjection());
                
                highlightLayer.getSource().addFeature(roadClone);
                
                // Extend the collective extent with the current feature's extent
                ol.extent.extend(fullExtent, roadClone.getGeometry().getExtent());
            }
        });

        // Check if a valid extent was calculated
        if (!ol.extent.isEmpty(fullExtent)) {
            map.getView().fit(fullExtent, { 
                duration: 1000, 
                maxZoom: 17,
                padding: [50, 50, 50, 50]
            });
        } else {
            console.warn(`Features found but geometries were missing or invalid for zooming.`);
        }
    } else {
        console.warn(`No features found for zooming and highlighting.`);
    }
}

// Reset button logic
document.getElementById("resetButton").addEventListener("click", function () {
    roadSearchInput.value = "";
    autocompleteList.innerHTML = "";
    highlightLayer.getSource().clear();

    const districtFilter = document.getElementById("districtFilter");
    districtFilter.value = "ALL";
    districtFilter.dispatchEvent(new Event('change'));

    const filterBy = document.getElementById("filterBy");
    filterBy.value = "";
    filterBy.dispatchEvent(new Event('change'));
});

// =========================================================================
// 7. CENTER ON CLICK LOGIC (WFS-on-Demand for Road Click)
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

// =========================================================================
// 8. ROAD FILTER (WMS cql_filter)
// =========================================================================

function updateRoadFilter() {
    let cqlFilter = [];

    // --- Road Type Filter ---
    if (activeRoadTypes.size > 0 && activeRoadTypes.size < Object.keys(roadColors).length) {
        const types = Array.from(activeRoadTypes).map(type => `'${type}'`).join(',');
        cqlFilter.push(`"layer" IN (${types})`);
    }

    // --- District Filter ---
    if (currentDistrict !== "ALL") {
        cqlFilter.push(`"district_code" = '${currentDistrict}'`);
    }

    if (activeRoadTypes.size === 0) {
    // If no road types are active, hide the road layer
    roadLayer.setVisible(false);
} else {
    roadLayer.setVisible(true);

    const finalCql = cqlFilter.length > 0 ? cqlFilter.join(' AND ') : '1=1';
    roadLayerSource.updateParams({ 'cql_filter': finalCql });
}
}

function updateLmcRoadFilter() {
    // Get the source of the LMC road layer
    const lmcRoadSource = lmcRoadLayer.getSource();

    let cqlFilter = '1=1'; // Default: show all

    // Apply district filter if one is selected
    if (currentDistrict !== "ALL") {
        // Assuming the district code field name in the LMC layer is also 'district_code'
        cqlFilter = `"district_code" = '${currentDistrict}'`;
    }

    // Update the WMS source parameters
    lmcRoadSource.updateParams({ 
        'cql_filter': cqlFilter 
    });
}

// Clear highlight and search results after filter change
highlightLayer.getSource().clear();
document.getElementById("autocomplete-list").innerHTML = "";
//=========================================================================
// DISTRICT FILTER
//=========================================================================
document.getElementById("districtFilter").addEventListener("change", function (e) {
    const selectedDistrictName = e.target.options[e.target.selectedIndex].text;
    const selectedDistrictValue = e.target.value; 

    highlightLayer.getSource().clear();

    currentDistrict = (selectedDistrictName === "ALL DISTRICTS") ? "ALL" : selectedDistrictValue;

    updateRoadFilter(); 
    updateLmcRoadFilter();

    districtLayer.changed(); 

    if (selectedDistrictName === "ALL DISTRICTS") {
        map.getView().setCenter(ol.proj.fromLonLat([117.04304, 5.21470]));
        map.getView().setZoom(8);
        return;
    }

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
        highlightLayer.getSource().clear();
    } else {
        console.warn(`District '${selectedDistrictName}' not found in districtLayer.`);
    }
});

// =========================================================================
// 9. LEGEND BUILDER & TOGGLE LOGIC
// =========================================================================
const legendDiv = document.getElementById("legend");
// const legendContent = legendDiv.querySelector(".legend-content");
const roadTypeItemsContainer = document.getElementById("roadTypeItemsContainer");
const lrmItemsContainer = document.getElementById("lrmItemsContainer");
const BCItemsContainer = document.getElementById("BCItemsContainer");

const toggleRoadTypesBtn = document.getElementById("toggleRoadTypes");
const toggleChainageBtn = document.getElementById("toggleChainage");
const toggleLMCBtn = document.getElementById("toggleLMC");
const toggleBCBtn = document.getElementById("toggleBC");

let mcdcChainageItem;
let lmcRoadItem;
let bcItems;

let areRoadTypesVisible = true;
let areChainageTypesVisible = false;
let areLMCTypesVisible = false;
let areBCTypesVisible = false;

const defaultDisabledTypes = ['UNID', 'FEDERAL','JKR'];

const mcdcChainageData = {
    type: 'MCDC CHAINAGE',
    color: 'brown'
};

const lmcRoadData = {
    type: 'LMC ROADS',
    color: 'lightblue'
}

const bridgeData = {
    type: 'Bridges',
    color: 'deeppink'
}

const culvertData = {
    type: 'Culverts',
    color: 'cyan'
}

activeRoadTypes = new Set(
    Object.keys(roadColors).filter(type => !defaultDisabledTypes.includes(type)
)); //Define default active and inactive legend layers


if(toggleRoadTypesBtn && roadTypeItemsContainer) {
    toggleRoadTypesBtn.addEventListener("click", function (e) {
        e.stopPropagation(); // Prevent triggering other click events
        areRoadTypesVisible = !areRoadTypesVisible;

        if (areRoadTypesVisible) {
            roadTypeItemsContainer.style.display = "block";
            toggleRoadTypesBtn.textContent = "-";
            toggleRoadTypesBtn.title = "Collapse";
        } else {
            //Hide the content
            roadTypeItemsContainer.style.display = "none";
            toggleRoadTypesBtn.textContent = "+";
            toggleRoadTypesBtn.title = "Expand";
        }
    });
}

if(toggleChainageBtn && chainageTypeItemsContainer) {
    chainageTypeItemsContainer.style.display = "none";
    toggleChainageBtn.textContent = "+";
    toggleChainageBtn.title = "Expand";
    toggleChainageBtn.addEventListener("click", function (e) {
         e.stopPropagation(); // Prevents issues if the label is clickable
         areChainageTypesVisible = !areChainageTypesVisible;

        if (areChainageTypesVisible) {
            chainageTypeItemsContainer.style.display = "block";
            toggleChainageBtn.textContent = "-";
            toggleChainageBtn.title = "Collapse";
        } else {
            //Hide the content
            chainageTypeItemsContainer.style.display = "none";
            toggleChainageBtn.textContent = "+";
            toggleChainageBtn.title = "Expand";
        }
    });
}

if(toggleLMCBtn && lrmItemsContainer) {
    lrmItemsContainer.style.display = "none";
    toggleLMCBtn.textContent="+";
    toggleLMCBtn.title="Expand";
    toggleLMCBtn.addEventListener("click", function (e) {
         e.stopPropagation(); 
         areLMCTypesVisible = !areLMCTypesVisible;

     if (areLMCTypesVisible) {
        lrmItemsContainer.style.display = "block";
        toggleLMCBtn.textContent = "-";
        toggleLMCBtn.title = "Collapse";
    } else {
             lrmItemsContainer.style.display = "none";
             toggleLMCBtn.textContent = "+";
             toggleLMCBtn.title = "Expand";
         }
     });
}

if(toggleBCBtn && BCItemsContainer){
    BCItemsContainer.style.display = "none";
    toggleBCBtn.textContent="+";
    toggleBCBtn.title="Expand";
    toggleBCBtn.addEventListener("click", function(e){
        e.stopPropagation();
        areBCTypesVisible = !areBCTypesVisible;

        if(areBCTypesVisible){
            BCItemsContainer.style.display = "block";
            toggleBCBtn.textContent = "-";
            toggleBCBtn.title = "Collapse";
        }else {
            BCItemsContainer.style.display="none";
            toggleBCBtn.textContent = "+";
            toggleBCBtn.title ="Expand";
        }
    });
}

// 9A. Build the legend content (items)
for (const [layerType, color] of Object.entries(roadColors)) {
  const item = document.createElement("div");

  if(activeRoadTypes.has(layerType)){
    item.className = "legend-item active"; //update the html div class for css purpose (active class)
  } else {
    item.className = "legend-item disabled"; //(inactive class)
  }

  item.dataset.layer = layerType;

  const colorBox = document.createElement("div");
  colorBox.className = "legend-color";
  colorBox.style.backgroundColor = color;

  const label = document.createElement("span");
  label.textContent = layerType;

  item.appendChild(colorBox);
  item.appendChild(label);
  if (roadTypeItemsContainer) { 
      roadTypeItemsContainer.appendChild(item); 
  }

  item.addEventListener("click", () => {
    if(!sabahRoadCheckbox.checked) {
        return;
    } // Ignore clicks if master is off


    if (activeRoadTypes.has(layerType)) {
      activeRoadTypes.delete(layerType);
      item.classList.remove("active");
      item.classList.add("disabled");
    } else {
      activeRoadTypes.add(layerType);
      item.classList.add("active");
      item.classList.remove("disabled");
    }

    if (typeof updateRoadFilter === 'function'){
            updateRoadFilter();
    }
  });
}

if(typeof updateRoadFilter === 'function'){
    updateRoadFilter();
}

if(chainageTypeItemsContainer) {
    const data = mcdcChainageData;
    // Create the main item div
    const item = document.createElement("div");
    item.id = "mcdcChainageItem"; // Assign the ID needed for the control logic
    item.className = "legend-item disabled"; // Start disabled
    
    // Create the color box
    const colorBox = document.createElement("span");
    colorBox.className = "legend-color";
    colorBox.style.backgroundColor = data.color;

    // Create the label
    const label = document.createElement("span");
    label.textContent = data.type;

    item.appendChild(colorBox);
    item.appendChild(label);
    
    chainageTypeItemsContainer.appendChild(item);
    
    // Store reference for the control logic below
    mcdcChainageItem = item;
}

// New block for LMC Road Item
if(lrmItemsContainer) {
 const data = lmcRoadData;

 const item = document.createElement("div");
 item.id = "lmcRoadItem"; 
 item.className = "legend-item disabled"; // Start disabled

 const colorBox = document.createElement("span");
 colorBox.className = "legend-color";
 colorBox.style.backgroundColor = data.color;

 const label = document.createElement("span");
 label.textContent = data.type;

 item.appendChild(colorBox);
 item.appendChild(label);
 
 lrmItemsContainer.appendChild(item);

 lmcRoadItem = item;
}

// NEW: Map the legend type strings to the actual OpenLayers layer objects for easy reference
const bcLayerMap = {
    'Bridges': { layer: bridgeLayer, source: bridgeLayerSource },
    'Culverts': { layer: culvertLayer, source: culvertLayerSource }
};


if(BCItemsContainer){
    const dataItems = [bridgeData, culvertData];

    dataItems.forEach(data => {
        const layerType = data.type; // 'Bridges' or 'Culverts'
        
        const item = document.createElement("div");
        item.id = `${layerType}Item`;
        item.className = "legend-item disabled"; // Start disabled
        
        const colorBox = document.createElement("span");
        colorBox.className = "legend-color";
        colorBox.style.backgroundColor = data.color;

        const label = document.createElement("span");
        label.textContent = layerType;

        item.appendChild(colorBox);
        item.appendChild(label);

        BCItemsContainer.appendChild(item);

        item.addEventListener("click", () => {
            const layerObjects = bcLayerMap[layerType];
            if (!layerObjects) return; 

            // 1. Check if master checkbox is ON (like the Sabah Roads layer)
            if (!BCCheckbox.checked) {
                return; 
            }

            const olLayer = layerObjects.layer;
            const olSource = layerObjects.source;
            const isVisible = olLayer.getVisible();

            if (isVisible) {
                // Turn OFF
                olLayer.setVisible(false);
                item.classList.remove("active");
                item.classList.add("disabled");
            } else {
                // Turn ON
                olLayer.setVisible(true);
                item.classList.add("active");
                item.classList.remove("disabled");
                
                // CRITICAL: Refresh to force a new WMS request
                olSource.refresh(); 
            }
        });
    });
}

const sabahRoadCheckbox = document.getElementById("sabahRoadCheckbox");
const chainageCheckbox = document.getElementById("chainageCheckbox");
const lmcRoadCheckbox = document.getElementById("lmcCheckbox");
const BCCheckbox = document.getElementById("BCCheckbox");

// --- Sabah Roads master control ---
if (sabahRoadCheckbox) {
    sabahRoadCheckbox.addEventListener('change', function () {
        const visible = this.checked;

        const roadTypeItems = document.querySelectorAll("#roadTypeItemsContainer .legend-item");

        // Toggle visibility of the road layer
        if (roadLayer) roadLayer.setVisible(visible);


        // Update activeRoadTypes for filter logic
        if (visible) {
            activeRoadTypes = new Set(Object.keys(roadColors)); // enable all again
            // Ensure visual state matches
           roadTypeItems.forEach(item => {
                item.classList.add("active");
                item.classList.remove("disabled"); 
            });
        } else {
            activeRoadTypes.clear(); // disable all
            roadTypeItems.forEach(item => {
                item.classList.remove("active"); 
                item.classList.add("disabled"); 
            });
        }

        updateRoadFilter();
    });
}

//--- Bridges & Culverts (Master Control) ---
if (BCCheckbox) {
    BCCheckbox.addEventListener('change', function () {
        const visible = this.checked;
        if(culvertLayer) culvertLayer.setVisible(visible);
        if(bridgeLayer) bridgeLayer.setVisible(visible);

        if (bridgeCulvertGroup) bridgeCulvertGroup.setVisible(visible);

        if (visible) {
            if (culvertLayerSource) culvertLayerSource.refresh();
            if (bridgeLayerSource) bridgeLayerSource.refresh(); 
        }

        const bcItems = document.querySelectorAll("#BCItemsContainer .legend-item");
        bcItems.forEach(item => {
            if (visible) {
                item.classList.add("active");
                item.classList.remove("disabled");
            } else {
                item.classList.remove("active");
                item.classList.add("disabled");
            }
        });
    });
}

// --- Chainage control ---
if (chainageCheckbox) {
  chainageCheckbox.addEventListener('change', function () {
        const visible = this.checked;
        
        // 1. Toggle WMS Layer visibility
        if (chainageLayer) chainageLayer.setVisible(visible);

        if (mcdcChainageItem) { 
            if (visible) {
                mcdcChainageItem.classList.add("active");
                mcdcChainageItem.classList.remove("disabled");
            } else {
                mcdcChainageItem.classList.remove("active");
                mcdcChainageItem.classList.add("disabled");
            }
        }
    });
}

//--- LRM Roads ---
if(lmcRoadCheckbox){
    lmcRoadCheckbox.addEventListener('change', function(){
    const visible = this.checked;

    if (lmcRoadLayer) lmcRoadLayer.setVisible(visible);

    if (lmcRoadItem) { 
        if (visible) {
            lmcRoadItem.classList.add("active");
            lmcRoadItem.classList.remove("disabled");
        } else {
            lmcRoadItem.classList.remove("active");
            lmcRoadItem.classList.add("disabled");
        }
    }
    });
}


// 9B. Legend toggle logic
const legendToggleBtn = document.getElementById("minimize-legend");
const legendMobileToggleBtn = document.getElementById("legend-toggle-btn");

// Desktop legend toggle (minimize/maximize)
let isLegendMinimized = true;
legendToggleBtn.addEventListener("click", function (e) {
    // Only work as minimize/maximize on desktop
    if (window.innerWidth > 500) {
        isLegendMinimized = !isLegendMinimized;
        legendDiv.classList.toggle("minimized", isLegendMinimized);

        legendToggleBtn.textContent = isLegendMinimized ? "+" : "-";
        legendToggleBtn.title = isLegendMinimized ? "Maximize Legend" : "Minimize Legend";
    } else {
        // On mobile, close button behavior
        e.preventDefault();
        legendDiv.classList.remove('mobile-active');
        if (legendMobileToggleBtn) {

            
            legendMobileToggleBtn.classList.remove('active');
        }
    }
});

// Mobile legend toggle button (show/hide)
if (legendMobileToggleBtn) {
    legendMobileToggleBtn.addEventListener('click', function(e) {
        // Prevent any parent clicks
        e.stopPropagation(); 

        if (window.innerWidth <= 500) {
            // Toggle the class that CSS uses to show/hide
            legendDiv.classList.toggle('mobile-active');
            
            // Toggle visual state of the button (e.g. make it darker)
            this.classList.toggle('active');
            
            // Force remove 'minimized' just in case desktop logic interfered
            legendDiv.classList.remove('minimized');
        }
    });
}

// Close legend when clicking map on mobile (Better UX)
map.on('click', function() {
    if (window.innerWidth <= 500 && legendDiv.classList.contains('mobile-active')) {
        legendDiv.classList.remove('mobile-active');
        if (legendMobileToggleBtn) {
            legendMobileToggleBtn.classList.remove('active');
        }
    }
});

// Initial state for desktop
if (window.innerWidth > 500) {
    legendDiv.classList.add("minimized");
    legendToggleBtn.textContent = "+";
    legendToggleBtn.title = "Maximize Legend";
}

// Handle window resize to maintain proper state
window.addEventListener('resize', function() {
    if (window.innerWidth > 500) {
        // Desktop mode - remove mobile classes
        legendDiv.classList.remove('mobile-active');
        if (legendMobileToggleBtn) {
            legendMobileToggleBtn.classList.remove('active');
        }
        // Restore desktop minimize state if needed
        if (isLegendMinimized && !legendDiv.classList.contains('minimized')) {
            legendDiv.classList.add('minimized');
        }
    } else {
        // Mobile mode - remove desktop minimize state
        legendDiv.classList.remove('minimized');
    }
});