let currentSearchField= 'road_name'; // Default search field
const filterOptions={
  'road_name':'Road Name',
  'pkm_road_id':'PKM ID',
  'marris_id':'Marris ID'
};

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
function osmDistrictStyle(feature) {
  const name = feature.get('NAME_2');
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: 'black', width: 1 }),
    text: new ol.style.Text({
      text: name || "",
      font: '14px Calibri,sans-serif',
      fill: new ol.style.Fill({ color: '#000' }),
      stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
      overflow: false
    })
  });
}

function satelliteDistrictStyle(feature) {
  const name = feature.get('NAME_2');
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: 'white', width: 1 }),
    text: new ol.style.Text({
      text: name || "",
      font: '14px Calibri,sans-serif',
      stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
      overflow: false
    })
  });
}

const roadColors = {
  'UNID': 'blue',
  'MCDC': 'green',
  'OTHER': 'Gray',
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

// =========================================================================
// 3. OVERLAY LAYERS (Defined early so the event listener can see them)
// =========================================================================
const roadLayer = new ol.layer.Vector({
  source: new ol.source.Vector({
    format: new ol.format.GeoJSON(),
    url: function (extent) {
      return (
        'https://unchagrined-undecomposed-jacob.ngrok-free.dev/geoserver/wfs?' + //ngrok can be used here 10/10/25
        'service=WFS&' +
        'version=1.1.0&' +
        'request=GetFeature&' +
        'typeName=rmisv2db_prod:gis_sabah_centerline&' +
        'outputFormat=application/json&' +
        'srsName=EPSG:3857&' +
        'bbox=' + extent.join(',') + ',EPSG:3857&'
      );
    },
    strategy: ol.loadingstrategy.bbox
  }),
  style: roadStyle,
  minZoom: 9
});

// =========================================================================
// WMS ROAD LAYER (FAST VISUALIZATION)
// =========================================================================
const roadWMSLayer = new ol.layer.Tile({
  source: new ol.source.TileWMS({
    url: 'http://localhost:8080/geoserver/rmisv2db_prod/wms',
    params: {
      'LAYERS': 'rmisv2db_prod:gis_sabah_centerline',
      'STYLES': 'road_style',
      'TILED': true
    },
    serverType: 'geoserver',
  }),
  opacity: 1,
  minZoom: 8
});


const districtLayer = new ol.layer.Vector({
  source: new ol.source.Vector({
    url: 'sabah_district.geojson',
    format: new ol.format.GeoJSON()
  }),
  style: satelliteDistrictStyle,
  minZoom: 0,
  maxZoom: 22
});

const highlightLayer = new ol.layer.Vector({
  source: new ol.source.Vector(),
  style: function (feature) {
    const featureColor = feature.get('highlight_color') || '#000';
    const roadName = feature.get('road_name'); // get the attribute

    return [
      // thick yellow glow stroke
      new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: 'rgba(255, 255, 0, 0.8)',
          width: 8
        })
      }),
      // actual road stroke with original color
      new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: featureColor,
          width: 3
        }),
        text: new ol.style.Text({
          text: roadName || '',          // label text
          font: 'bold 20px Calibri,sans-serif',
          fill: new ol.style.Fill({ color: '#000' }),   // text color
          stroke: new ol.style.Stroke({ color: '#fff', width: 2 }), // halo for readability
          overflow: true,                
          placement: 'line'              // follow the road line
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
  layers: [baseGroup, districtLayer, roadWMSLayer, highlightLayer], // Add layers here
  view: new ol.View({
    center: ol.proj.fromLonLat([116.0735, 5.9804]),
    zoom: 8
  })
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
    districtLayer.setStyle(osmDistrictStyle); // Update style for regular map

    basemapButton.title = "Switch to Satellite Imagery";
  } else {
    // switch back to satellite
    regularLayer.setVisible(false);
    satelliteLayer.setVisible(true);
    districtLayer.setStyle(satelliteDistrictStyle); // Update style for satellite map

    basemapButton.title = "Switch to Regular Map";
  }

  isSatellite = !isSatellite;
});


// =========================================================================
// 6. ROAD SEARCH & AUTOSUGGEST LOGIC (WMS Query Filter - FAST)
// ========================================================================

//search field selector logic
function filterBy(fieldName){
  currentSearchField=fieldName;
  const roadSearchInput = document.getElementById("roadSearch");
  roadSearchInput.placeholder="Search "+filterOptions[fieldName];
  roadSearchInput.value="";
  document.getElementById("autocomplete-list").innerHTML="";
}


const roadSearchInput = document.getElementById("roadSearch");
const autocompleteList = document.getElementById("autocomplete-list");

// This function will asynchronously fetch road names based on the current search text
function fetchRoadNames(searchText) {
    const WFS_URL = 'http://localhost:8080/geoserver/rmisv2db_prod/wfs?';
    const isRoadName = (currentSearchField === 'road_name');
    const operator = isRoadName ? 'ILIKE' : 'LIKE'; 
    const startWildcard = isRoadName ? `%` : ``; // Wildcard at the start only for Road Name
    const endWildcard   = `%`;                    // Always use wildcard at the end for autocomplete

    // Construct the raw CQL filter string - THIS LINE IS THE KEY FIX!
    const rawCqlFilter = `${currentSearchField} ${operator} '${startWildcard}${searchText}${endWildcard}'`;

    // Safely encode the filter for the URL
    const encodedCqlFilter = encodeURIComponent(rawCqlFilter);

    // Build the final request URL... (rest of the function remains the same)
    const requestUrl = WFS_URL +
        'service=WFS&version=1.1.0&request=GetFeature&' +
        'typeName=rmisv2db_prod:gis_sabah_centerline&' +
        'outputFormat=application/json&srsName=EPSG:4326&' + 
        'maxFeatures=10&' +
        `cql_filter=${encodedCqlFilter}`;
        
    // Use a standard fetch request
    fetch(requestUrl)
        .then(response => {
            // ... error handling ...
            if (!response.ok) {
                throw new Error(`GeoServer request failed with status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const features = new ol.format.GeoJSON().readFeatures(data);
            let results = [];

            if (features.length > 0) {
                // Extract the value of the currently selected field (e.g., road_name, pkm_id, etc.)
                results = [...new Set(features.map(f => f.get(currentSearchField)).filter(n => n))];
            }
            
            // Render the extracted results (which could be IDs or names)
            renderAutocomplete(results, currentSearchField); 
        })
        .catch(error => {
            console.error("Error during WFS search:", error);
        });
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

    if (val.length < 2) return; // Wait until user types at least 1 character

    fetchRoadNames(val);
});

document.addEventListener("click", function (e) {
    if (e.target !== roadSearchInput) {
        autocompleteList.innerHTML = "";
    }
});

// =========================================================================
// zoomToRoad FUNCTION (Fetches geometry on demand)
// =========================================================================
function zoomToFeature(value, fieldName) {
    highlightLayer.getSource().clear();

    // 1. Construct the filter using the dynamic field name and value
    const filter = `${fieldName}='${value}'`; // e.g., pkm_id='1234' or road_name='Jalan ABC'
    
    // ... rest of the WFS URL construction using 'filter' ...
    const WFS_URL = 'http://localhost:8080/geoserver/rmisv2db_prod/wfs?' +
                    'service=WFS&version=1.1.0&request=GetFeature&' +
                    'typeName=rmisv2db_prod:gis_sabah_centerline&' + 
                    'outputFormat=application/json&' +
                    'srsName=EPSG:3857&' +
                    `cql_filter=${encodeURIComponent(filter)}`; 

    fetch(WFS_URL)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const features = new ol.format.GeoJSON().readFeatures(data, {
                dataProjection: 'EPSG:3857', 
                featureProjection: 'EPSG:3857' 
            });
            
            const road = features[0]; 

            if (road) {
                const originalColor = roadColors[road.get('layer')] || 'black';
                const roadClone = road.clone();
                roadClone.set('highlight_color', originalColor);

                highlightLayer.getSource().addFeature(roadClone);

                map.getView().fit(road.getGeometry().getExtent(), {
                    duration: 1000,
                    padding: [50, 50, 50, 50]
                });
            } else {
                console.warn(`Geometry for road '${name}' not found.`);
            }
        })
        .catch(error => {
            console.error("Error fetching road geometry. Check CORS and server logs:", error);
        });
}

document.addEventListener("click", function (e) {
    if (e.target !== roadSearchInput) {
        autocompleteList.innerHTML = "";
    }
});


// Reset button logic
document.getElementById("resetButton").addEventListener("click", function() {
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

centerBtn.addEventListener('click', function() {
  // Toggle feature centering
  centerOnClick = !centerOnClick;
  centerBtn.classList.toggle('active', centerOnClick);

  // Recenter map on button click (as defined in your original code)
  map.getView().setCenter(ol.proj.fromLonLat([116.0735, 6.0000])); 
  map.getView().setZoom(10); 
});

map.on('click', function(evt) {
  if (!centerOnClick) return;

  map.forEachFeatureAtPixel(evt.pixel, function(feature, layer) {
    if (layer === districtLayer || layer === highlightLayer) {
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
// 8. ROAD FILTER
// =========================================================================
let currentFilter = "ALL";


function updateRoadFilter() {
  let clauses = [];

  if (activeRoadTypes.size > 0) {
    const typeClauses = Array.from(activeRoadTypes).map(t => `layer='${t}'`);
    clauses.push(`(${typeClauses.join(" OR ")})`);
  } else {
    clauses.push("1=0"); // hide all if none selected
  }

  if (currentDistrict !== "ALL") {
    clauses.push(`district_code='${currentDistrict}'`);
  }

  roadWMSLayer.getSource().updateParams({
    CQL_FILTER: clauses.join(" AND ")
  });
}


//road name visibility


//=========================================================================
// DISTRICT FILTER
//=========================================================================
let currentDistrict = "ALL";

function districtFilterStyle(feature) {
    const districtCode = feature.get('district_code');
    
    // Start with the base style (which includes stroke/outline and text/label)
    const style = isSatellite ? satelliteDistrictStyle(feature) : osmDistrictStyle(feature);

    // Apply a transparent fill to all districts by default to prevent overlap issues
    style.setFill(new ol.style.Fill({ color: 'rgba(0,0,0,0.01)' })); 

    // Highlight the selected district with a visible fill
    if (districtCode === currentDistrict) {
        // Apply a semi-transparent yellow fill to clearly highlight the selected area
        style.setFill(new ol.style.Fill({ color: 'rgba(255, 255, 0, 0.3)' }));
    }
    
    return style; 
}



function roadDistrictFilterStyle(feature) {
  const districtCode = feature.get('district_code');
  const roadType = feature.get('layer');

  // Show only if the district matches AND the roadType is active
  if ((currentDistrict === "ALL" || districtCode === currentDistrict) &&
      activeRoadTypes.has(roadType)) {
    return roadStyle(feature);
  }

  return null; // hide unrelated roads
}


document.getElementById("districtFilter").addEventListener("change", function(e) {
  currentDistrict = e.target.value;
  districtLayer.setStyle(districtFilterStyle);

  // apply combined filter on WMS roads
  updateRoadFilter(currentFilter);

  if (currentDistrict !== "ALL") {
    const features = districtLayer.getSource().getFeatures();
    const district = features.find(f => f.get('district_code') === currentDistrict);
    if (district) { 
      map.getView().fit(district.getGeometry().getExtent(), {
        duration: 1000,
        padding: [100,100,100,100]
      });
    }
  } else {
    map.getView().setCenter(ol.proj.fromLonLat([116.0735, 5.9804]));
    map.getView().setZoom(8);
  }
});



// =========================================================================
// 9. LEGEND BUILDER & TOGGLE LOGIC
// =========================================================================
const legendDiv = document.getElementById("legend");
const legendContent = legendDiv.querySelector(".legend-content");
// Keep track of which road types are currently active (toggled ON)
let activeRoadTypes = new Set(Object.keys(roadColors)); 


// 9A. Build the legend content (items)
for (const [layerType, color] of Object.entries(roadColors)) {
  const item = document.createElement("div");
  item.className = "legend-item active"; // start active
  item.dataset.layer = layerType;

  const colorBox = document.createElement("div");
  colorBox.className = "legend-color";
  colorBox.style.backgroundColor = color;
  colorBox.style.borderColor = color === "yellow" ? "#000" : color;

  const label = document.createElement("span");
  label.textContent = layerType;

  item.appendChild(colorBox);
  item.appendChild(label);
  legendContent.appendChild(item);

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

// 9B. Legend toggle logic
const legendToggleBtn = document.getElementById("minimize-legend");
let isLegendMinimized = true;
legendToggleBtn.addEventListener("click", function() {
  isLegendMinimized = !isLegendMinimized;
  legendDiv.classList.toggle("minimized", isLegendMinimized);

  legendToggleBtn.textContent = isLegendMinimized ? "+" : "-";
  legendToggleBtn.title = isLegendMinimized ? "Maximize Legend" : "Minimize Legend";
});

// Initial state
legendDiv.classList.add("minimized");
legendToggleBtn.textContent = "+";
legendToggleBtn.title = "Maximize Legend";


// =========================================================================  
// END OF SCRIPT
// =========================================================================




  