/* * =========================================================================
 * RMIS 1.0 - Core Map Configuration & Layer Management
 * =========================================================================
 * * CORE FUNCTIONS:
 * 1. MAP INITIALIZATION: OpenLayers map setup with View and Interaction defaults.
 * 
 * 2. BASEMAP SWITCHER: Toggles between Satellite, Hybrid, and Regular OSM layers.
 * 
 * 3. LAYER MANAGEMENT:
 * - WMS Layers (Roads, Chainage, LMC, Bridges, Culverts) from GeoServer.
 * - Vector Layers (District Boundaries, Highlight styles).
 * 
 * 4. FILTERING SYSTEM:
 * - District Filtering: Zooms to specific districts and filters WMS layers.
 * - Road Type Filtering: Toggles specific road categories (e.g., Federal, State).
 * 
 * 5. SEARCH ENGINE:
 * - WFS-based search for Roads, IDs, and Assets with autocomplete.
 * - "Zoom To" feature highlights search results on the map.
 * 
 * 6. LEGEND CONTROL: Dynamic interactive legend for toggling layer visibility.
 * =========================================================================
 */

// 1. READ USER
const storedUser = localStorage.getItem('currentUser');
if (!storedUser) window.location.href = 'login.html';
const currentUser = JSON.parse(storedUser);

// 2. GET VARIABLES
const userDistricts = currentUser.permissions.allowedDistricts || [];
const userRole = currentUser.role || ""; // e.g. "JKR" or "Group IT"

console.log(`User: ${currentUser.username}, Role: ${userRole}`);

// 3. DEFINE FILTER LOGIC
let initialCqlFilter = "1=0"; // DEFAULT: HIDE EVERYTHING (Safety First!)

// Scenario A: JKR / Admin / Superuser (Explicitly allow ALL)
// Update 'Group IT' to whatever your exact admin role name is in the DB
if (userRole.includes("JKR") || userRole.includes("Group IT") || userRole.includes("Admin")) {
    initialCqlFilter = "1=1"; // Show All
} 
// Scenario B: Inspector with Assigned Districts
else if (userDistricts.length > 0) {
    const distList = userDistricts.map(d => `'${d}'`).join(',');
    initialCqlFilter = `district_code IN (${distList})`;
}
// Scenario C: Inspector with NO Districts -> "1=0" (Still sees nothing, safe)

console.log("Applying Road Filter:", initialCqlFilter);



let currentSearchField = 'road_name'; // Default search field
//pothole layer
let potholeLayer; // Define globally


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
const SERVER_IP="10.1.4.27"; // Update this to your server's IP address
const GEOSERVER_HOST=`http://${SERVER_IP}:8080`;



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


// --- Pothole Style (Red Dot) ---
const potholeStyle = function(feature) {
    // Get the specific name (e.g., "Pothole with Crack")
    const specificType = feature.get('name'); 
    
    // Find out which "Bucket" it belongs to (e.g., "Surface")
    const category = getDefectCategory(specificType);
    
    // Get the color for that bucket
    const color = CATEGORY_COLORS[category];

    return new ol.style.Style({
        image: new ol.style.Circle({
            radius: 6,
            fill: new ol.style.Fill({ color: color }),
            stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
        })
    });
};


function highlightRoadStyle(feature) {
    // 1. Check if it is a Line (Road) or a Point (Asset)
    const geometry = feature.getGeometry();
    const type = geometry.getType();

    // =========================================================
    // CASE A: IT IS A ROAD (LineString / MultiLineString)
    // =========================================================
    if (type === 'LineString' || type === 'MultiLineString') {
        const layer = feature.get('layer'); 
        const color = roadColors[layer] || 'black';
        const roadName = feature.get('road_name') || '';

        return [
            // 1. The colored road line (Base)
            new ol.style.Style({
                stroke: new ol.style.Stroke({ color: color, width: 3 })
            }),
            // 2. The Cyan Glow (Highlight)
            new ol.style.Style({
                stroke: new ol.style.Stroke({ color: 'rgba(0, 255, 242, 0.8)', width: 8 }),
                text: new ol.style.Text({
                    text: roadName,
                    font: 'bold 12px Calibri,sans-serif',
                    fill: new ol.style.Fill({ color: '#000' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
                    placement: 'line',
                    overflow: true,
                    offsetY: -10
                })
            })
        ];
    } 
    
    // =========================================================
    // CASE B: IT IS AN ASSET (Point)
    // =========================================================
    else {
        const p = feature.getProperties();
        
        // Determine if Bridge or Culvert
        // Bridges have 'structure_no', Culverts have 'cv_structure_no'
        const isBridge = p.structure_no || (p.layer === 'Bridge');
        const id = isBridge ? p.structure_no : p.cv_structure_no;
        
        // Color: Pink for Bridge, Blue for Culvert
        const dotColor = isBridge ? '#FF1493' : '#00FFFF';

        return [
            // 1. Large Cyan "Halo" (The Glow)
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 14,
                    fill: new ol.style.Fill({ color: 'rgba(0, 255, 242, 0.4)' }), // Transparent Cyan
                    stroke: new ol.style.Stroke({ color: 'rgba(0, 255, 242, 1)', width: 2 })
                })
            }),
            // 2. The Inner Solid Dot
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 7,
                    fill: new ol.style.Fill({ color: dotColor }), 
                    stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
                }),
                // 3. Label with ID above the dot
                text: new ol.style.Text({
                    text: id || 'Asset',
                    font: 'bold 12px Arial',
                    fill: new ol.style.Fill({ color: '#000' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
                    offsetY: -22, // Move text up
                    overflow: true
                })
            })
        ];
    }
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
    url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/wms`,
    params: {
        'LAYERS': 'rmisv2db_prod:gis_sabah_road_map',
        'STYLES': 'road_style',
        'TILED': true,
        'cql_filter': initialCqlFilter 
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
    url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/wms`,
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
    url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/wms`,
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



// SCENARIO A: ADMIN (WMS - High Performance)
if (userRole === '06' || userRole === '16') {
    
    potholeLayer = new ol.layer.Tile({
        source: new ol.source.TileWMS({
            // Use the SQL View you created in GeoServer
            url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/wms`,
            params: {
                'LAYERS': 'rmisv2db_prod:gis_sql_view_potholes', // Check your layer name!
                'STYLES': '', // Use default style you set in GeoServer
                'TILED': true
            },
            serverType: 'geoserver'
        }),
        visible: false // Hidden by default, toggle via Legend
    });

// SCENARIO B: INSPECTOR (Vector - Interactive)
} else {

    potholeLayer = new ol.layer.Vector({
        source: new ol.source.Vector({
            // 1. The URL Function
            url: function(extent) {
                 const distList = userDistricts.join(','); 
                 // Ensure Port 3005 and HTTPS are correct
                 return `https://10.1.4.27:3005/assets/potholes?districts=${distList}`;
            }, // <--- MAKE SURE THIS COMMA IS HERE!
            
            // 2. The Format (This fixes the projection)
            format: new ol.format.GeoJSON({
                featureProjection: 'EPSG:3857' 
            })
        }), // <--- Close Source
        
        style: potholeStyle,
        visible: false 
    }); // <--- Close Layer
}
potholeLayer.set('name', 'PotholeLayer');


const transparentPointStyle = new ol.style.Style({
    image: new ol.style.Circle({
        radius: 8,  // arbitrary: needs to be >0 for click detection
        fill: new ol.style.Fill({ color: 'rgba(255,255,255,0)' }), // fully transparent
        stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0)', width: 0 })
    })
});


// for lines, keep stroke: rgba(0,0,0,0) and width >0
const transparentLineStyle = new ol.style.Style({
    stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0)', width: 8 }) // width >0 for picking
});


// BRIDGE VECTOR LAYER
const bridgeVectorLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
        url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=rmisv2db_prod:tbl_bridge&outputFormat=application/json`,
        format: new ol.format.GeoJSON(),
    }),
    style: function(feature) {
        if (feature.getGeometry().getType() === 'Point') return transparentPointStyle;
        return transparentLineStyle;
    }
});
bridgeVectorLayer.set('name',"BridgeLayer");

// CULVERT VECTOR LAYER
const culvertVectorLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
        url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=rmisv2db_prod:tbl_culvert&outputFormat=application/json`,
        format: new ol.format.GeoJSON(),
    }),
    style: function(feature) {
        if (feature.getGeometry().getType() === 'Point') return transparentPointStyle;
        return transparentLineStyle;
    }
});
culvertVectorLayer.set('name',"CulvertLayer");

// CHAINAGE LAYER (WMS, controlled by legend)
const chainageLayer = new ol.layer.Image({
    source: new ol.source.ImageWMS({
        url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/wms`,
        params: {
            'LAYERS': 'rmisv2db_prod:gis_chainage', 
            // 'TILED': true,
            'FORMAT': 'image/png8',
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
        url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/wms`,
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

// Layer to show the red click circle
const clickRadiusSource = new ol.source.Vector();
const clickRadiusLayer = new ol.layer.Vector({
    source: clickRadiusSource,
    style: new ol.style.Style({
        stroke: new ol.style.Stroke({ color: 'rgba(255, 0, 0, 0.5)', width: 2 }),
        fill: new ol.style.Fill({ color: 'rgba(255, 0, 0, 0.1)' })
    }),
    zIndex: 9999 // Always on top
});


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
    layers: [baseGroup, lmcRoadLayer,bridgeVectorLayer,culvertVectorLayer,  roadLayer, 
            bridgeCulvertGroup,potholeLayer, districtLayer, routeLayer, routeMarkerLayer,
            chainageLayer, clickRadiusLayer, highlightLayer],
    view: new ol.View({
        center: ol.proj.fromLonLat([117.04304, 5.21470]),
        zoom: 8,
        maxZoom: 22
    })
});

// SCALE LINE CONTROL
const scaleLineControl = new ol.control.ScaleLine({
    target: 'my-scale-line', // <--- THIS IS THE KEY. It forces the control into your div.
    units: 'metric',
    bar: true,
    steps: 2,
    text: true,
    minWidth: 40
});

map.addControl(scaleLineControl);

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
// UI CONFIG: DYNAMIC DISTRICT LIST & AUTO-ZOOM
// =========================================================================

// 1. MASTER LIST (Value = DB Code, Text = GeoJSON Name)
// IMPORTANT: The "text" must match the "NAME_2" property in your sabah_district.geojson exactly!
const MASTER_DISTRICTS = [
    { value: "17", text: "Beaufort" },
    { value: "08", text: "Beluran" },
    { value: "13", text: "Keningau" },
    { value: "09", text: "Kinabatangan" },
    { value: "03", text: "Kota Belud" },
    { value: "01", text: "Kota Kinabalu" },
    { value: "22", text: "Kota Marudu" },
    { value: "18", text: "Kuala Penyu" },
    { value: "05", text: "Kudat" },
    { value: "24", text: "Kunak" },
    { value: "11", text: "Lahad Datu" },
    { value: "15", text: "Nabawan" },
    { value: "02", text: "Papar" },
    { value: "21", text: "Penampang" },
    { value: "23", text: "Pitas" },
    { value: "27", text: "Putatan" },
    { value: "06", text: "Ranau" },
    { value: "07", text: "Sandakan" },
    { value: "12", text: "Semporna" },
    { value: "19", text: "Sipitang" },
    { value: "14", text: "Tambunan" },
    { value: "10", text: "Tawau" },
    { value: "28", text: "Telupid" },
    { value: "16", text: "Tenom" },
    { value: "25", text: "Tongod" },
    { value: "04", text: "Tuaran" }
];

function populateDistrictDropdown() {
    const dropdown = document.getElementById("districtFilter");
    if (!dropdown) return;

    // 1. Clear existing HTML options
    dropdown.innerHTML = '';

    // 2. Add "ALL" Option (Always present)
    const allOption = document.createElement("option");
    allOption.value = "ALL";
    allOption.textContent = "ALL DISTRICTS";
    dropdown.appendChild(allOption);

    // 3. Loop through Master List and Add Allowed Districts
    MASTER_DISTRICTS.forEach(dist => {
        // CHECK: If user is Admin (empty list) OR User has specific access
        if (userDistricts.length === 0 || userDistricts.includes(dist.value)) {
            const option = document.createElement("option");
            option.value = dist.value; 
            option.textContent = dist.text;
            dropdown.appendChild(option);
        }
    });

    // 4. AUTO-ZOOM LOGIC (The "Fake Click")
    // If the user is an Inspector (has only 1 district), auto-select and zoom.
    if (userDistricts.length === 1) {
        
        // Set the value in the UI
        dropdown.value = userDistricts[0]; 
        
        // Update the global variable manually just in case
        currentDistrict = userDistricts[0];

        // 5. WAIT FOR GEOJSON TO LOAD
        // We can't zoom until 'districtLayer' has finished loading the shapes.
        // We check every 0.5 seconds.
        const checkLayerReady = setInterval(() => {
            const source = districtLayer.getSource();
            
            // Check if features exist yet
            if (source && source.getState() === 'ready' && source.getFeatures().length > 0) {
                
                console.log("Auto-zooming to assigned district...");
                clearInterval(checkLayerReady); // Stop checking
                
                // TRIGGER THE EVENT YOU SHOWED ME
                // This runs your existing code: `map.getView().fit(...)`
                dropdown.dispatchEvent(new Event('change')); 
                
            }
        }, 500); 
    }
}

// === CALL THIS FUNCTION AT THE END OF YOUR FILE ===
populateDistrictDropdown();

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

    // --- 1. APPLY DISTRICT PERMISSION (New Security Layer) ---
    // If I am NOT Admin (userDistricts has items), strictly limit search results.
    if (userDistricts.length > 0) {
        const distList = userDistricts.map(d => `'${d}'`).join(',');
        // Combine the user's search query with the security restriction
        finalCql = `(${finalCql}) AND district_code IN (${distList})`;
    }
    // ---------------------------------------------------------

    // 2. APPLY ROAD TYPE FILTER (Your existing logic)
    if(activeRoadTypes.size > 0 && activeRoadTypes.size < Object.keys(roadColors).length) {
        const types = Array.from(activeRoadTypes).map(type => `'${type}'`).join(',');
        const typeFilter = `"layer" IN (${types})`;
        finalCql = `(${finalCql}) AND (${typeFilter})`;
    } else if(activeRoadTypes.size === 0) {
        finalCql = "1=0"; 
    }

    const url = (
        `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&` +
        'version=1.0.0&request=GetFeature&typeName=rmisv2db_prod:'+ viewName + '&' +
        'outputFormat=application/json&srsName=EPSG:4326&' +
        'cql_filter=' + encodeURIComponent(finalCql)+ 
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
            `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&` +
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
        `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&` +
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
            const url = `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${SPATIAL_LAYER}&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${encodeURIComponent(cql)}&maxFeatures=100&_=${Date.now()}`;
            const response = await fetch(url);
            const data = await response.json();
            features = new ol.format.GeoJSON().readFeatures(data);
        } else {
            // Indirect logic (keep your existing indirect logic here)
            const idUrl = `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${ATTRIBUTE_LAYER}&outputFormat=application/json&propertyName=pkm_road_id&cql_filter=${encodeURIComponent(cql)}&maxFeatures=500&_=${Date.now()}`;
            const idRes = await fetch(idUrl);
            const idData = await idRes.json();
            if (idData.features && idData.features.length > 0) {
                const ids = [...new Set(idData.features.map(f => f.properties.pkm_road_id).filter(Boolean))];
                if(ids.length > 0) {
                    const geomCql = `pkm_road_id IN (${ids.map(id => `'${id}'`).join(',')})`;
                    const geomUrl = `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${SPATIAL_LAYER}&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${encodeURIComponent(geomCql)}&_=${Date.now()}`;
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
        minimizeToolbarBtn.innerHTML = "×";
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

    // 1. ROAD TYPE FILTER (Legend Toggles)
    if (activeRoadTypes.size > 0 && activeRoadTypes.size < Object.keys(roadColors).length) {
        const types = Array.from(activeRoadTypes).map(type => `'${type}'`).join(',');
        cqlFilter.push(`"layer" IN (${types})`);
    }

    // 2. DISTRICT FILTER (The Fix!)
    if (currentDistrict !== "ALL") {
        // Case A: User specifically clicked "Sandakan" in the dropdown
        cqlFilter.push(`"district_code" = '${currentDistrict}'`);
    } 
    else {
        // Case B: User clicked "ALL" (or it's the default on load)
        // WE MUST CHECK: Is this user actually allowed to see "ALL"?
        
        if (userDistricts.length > 0) {
            // I am an Inspector: "ALL" means "All MY assigned districts"
            const distList = userDistricts.map(d => `'${d}'`).join(',');
            cqlFilter.push(`"district_code" IN (${distList})`);
        }
        // If userDistricts is empty, I am Admin -> "ALL" means "The Whole State" (No filter added)
    }

    // 3. APPLY FILTER
    if (activeRoadTypes.size === 0) {
        roadLayer.setVisible(false);
    } else {
        roadLayer.setVisible(true);
        const finalCql = cqlFilter.length > 0 ? cqlFilter.join(' AND ') : '1=1';
        
        // This log proves it's working
        console.log("Updating Road Filter:", finalCql); 
        roadLayerSource.updateParams({ 'cql_filter': finalCql });
    }
}

function updateLmcRoadFilter() {
    let cqlFilter = "";

    if (currentDistrict !== "ALL") {
        cqlFilter = `"district_code" = '${currentDistrict}'`;
    } 
    else {
        // The Fix: Check permissions for "ALL" mode
        if (userDistricts.length > 0) {
            const distList = userDistricts.map(d => `'${d}'`).join(',');
            cqlFilter = `"district_code" IN (${distList})`;
        } else {
            cqlFilter = "1=1"; // Admin sees everything
        }
    }

    lmcRoadLayer.getSource().updateParams({ 
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
const potholeItemsContainer = document.getElementById("potholeItemsContainer");

const toggleRoadTypesBtn = document.getElementById("toggleRoadTypes");
const toggleChainageBtn = document.getElementById("toggleChainage");
const toggleLMCBtn = document.getElementById("toggleLMC");
const toggleBCBtn = document.getElementById("toggleBC");
const togglePotholeBtn = document.getElementById("togglePothole");

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

// MASTER CATEGORY COLORS
const CATEGORY_COLORS = {
    'Surface':    '#d62222', // Red
    'Drainage':   '#007bff', // Blue
    'Vegetation': '#28a745', // Green
    'Structure':  '#6f42c1', // Purple
    'Slope':      '#855a28', // Brown
    'Other':      '#6c757d'  // Gray
};

// THE LOGIC: Map specific names to Categories
function getDefectCategory(specificType) {
    if (!specificType) return 'Other';
    const t = specificType.toLowerCase();

    // 1. SURFACE (Red) - Anything related to holes, cracks, pavement
    if (t.includes('pothole') || t.includes('crack') || t.includes('edge') || 
        t.includes('delamination') || t.includes('pavement') || t.includes('reinstatement')) {
        return 'Surface';
    }

    // 2. DRAINAGE (Blue) - Water, Blockages, Gullies
    if (t.includes('water') || t.includes('ponding') || t.includes('block') || 
        t.includes('silted') || t.includes('gully') || t.includes('outlet')) {
        return 'Drainage';
    }

    // 3. VEGETATION / CLEANING (Green) - Grass, Trees, Rubbish
    if (t.includes('grass') || t.includes('tree') || t.includes('rubbish') || 
        t.includes('debris') || t.includes('cleaning')) {
        return 'Vegetation';
    }

    // 4. SLOPE (Brown) - Landslides, Erosion, Soil
    if (t.includes('landslide') || t.includes('slip') || t.includes('cave') || 
        t.includes('scouring') || t.includes('erosion') || t.includes('earth')) {
        return 'Slope';
    }

    // 5. STRUCTURES (Purple) - Manholes, Culverts, Bridges, Concrete
    if (t.includes('manhole') || t.includes('culvert') || t.includes('wall') || 
        t.includes('slab') || t.includes('grating') || t.includes('rail') || 
        t.includes('kerb') || t.includes('joint')) {
        return 'Structure';
    }

    return 'Other'; // Fallback for Vandalism, Accidents, etc.
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

if(togglePotholeBtn && potholeItemsContainer){
    togglePotholeBtn.textContent = "+"; //default state
    togglePotholeBtn.title = "Expand";

    togglePotholeBtn.addEventListener("click", function(e){
        e.stopPropagation();
        const isHidden = potholeItemsContainer.style.display === "none";

        if(isHidden){
            potholeItemsContainer.style.display = "block";
            togglePotholeBtn.textContent = "-";
            togglePotholeBtn.title = "Collapse";
        } else {
            potholeItemsContainer.style.display = "none";
            togglePotholeBtn.textContent = "+";
            togglePotholeBtn.title = "Expand";
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


if (potholeItemsContainer) {
    potholeItemsContainer.style.display = "none";
    potholeItemsContainer.innerHTML = ''; 

    // Loop through the 6 Categories defined above
    for (const [label, color] of Object.entries(CATEGORY_COLORS)) {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `
            <span class="legend-color" style="background-color: ${color};"></span>
            <span>${label} Defects</span>
        `;
        potholeItemsContainer.appendChild(item);
    }
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
const potholeCheckbox = document.getElementById("potholeCheckbox");

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

//--- Potholes control ---
if (potholeCheckbox) {
    potholeCheckbox.addEventListener('change', function () {
        const visible = this.checked;

        // A. Toggle Map Layer
        if(typeof potholeLayer !== 'undefined'){
            potholeLayer.setVisible(visible);

            if(visible && (potholeLayer.getSource() instanceof ol.source.TileWMS)){
                potholeLayer.getSource().refresh();
            }
        }

        // B. Toggle Legend List (The "Expand/Collapse" Logic)
        if (potholeItemsContainer) {
            if (visible) {
                // Show the list
                potholeItemsContainer.style.display = 'block';
                potholeItemsContainer.classList.add("active");
                potholeItemsContainer.classList.remove("disabled");
            } else {
                // Hide the list
                potholeItemsContainer.style.display = 'none';
                potholeItemsContainer.classList.remove("active");
                potholeItemsContainer.classList.add("disabled");
            }
        }
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