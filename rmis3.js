// =========================================================================
// GLOBAL STATE VARIABLES
// =========================================================================
let isMeasuring = false;

// 'idle' = No tool active
// 'selectStart' = Wizard is active, waiting for user to click a START point
// 'selectDest' = Wizard is active, waiting for user to click a DESTINATION point
let routeWizardState = 'idle'; 
let startPoint = null; 
let currentUserLocation = null; // Stores { lon, lat } from GPS

// Get all the HTML elements for routing
const routeBtn = document.getElementById('route-btn');
const routeOptionsPanel = document.getElementById('route-options-panel');
const btnRouteFromGps = document.getElementById('btn-route-from-gps');
const btnRouteManual = document.getElementById('btn-route-manual');
const routeBanner = document.getElementById('route-banner');


// =========================================================================
// MEASUREMENT TOOL CODE (Your existing code)
// =========================================================================
const measureSource = new ol.source.Vector();
const measureLayer = new ol.layer.Vector({
    source: measureSource,
    style: new ol.style.Style({
        fill: new ol.style.Fill({color: 'rgba(255, 255, 255, 0.2)'}),
        stroke: new ol.style.Stroke({
            color: '#ffcc33',
            width: 2,
        })
    })
});
measureLayer.set('name','MeasureLayer');
map.addLayer(measureLayer);

let measureDraw;
const measureBtn = document.getElementById('measure-btn');
const measureTooltipElement = document.createElement('div');
let measureTooltip;

const formatLength = function (line) {
    const transformedLine = line.clone().transform(
        map.getView().getProjection(), 
        'EPSG:4326'               
    );
    const length = ol.sphere.getLength(transformedLine, { projection: 'EPSG:4326' });
    
    let output;
    if (length > 100) {
        output = Math.round((length / 1000) * 100) / 100 + ' km';
    } else {
        output = Math.round(length * 100) / 100 + ' m';
    }
    return output;
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
            stroke: new ol.style.Stroke({
                color: 'rgba(0, 0, 0, 0.5)',
                lineDash: [10, 10],
                width: 2
            }),
            image: new ol.style.Circle({
                radius: 5,
                stroke: new ol.style.Stroke({ color: 'rgba(0, 0, 0, 0.7)' }),
                fill: new ol.style.Fill({ color: 'rgba(255, 255, 255, 0.2)' })
            })
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
            let output = formatLength(geom);
            measureTooltipElement.innerHTML = output;
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
        // Turn off routing if it's active
        if (routeWizardState !== 'idle') {
            resetRouteWizard();
        }
        
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

if (measureBtn) {
    measureBtn.addEventListener('click', function () {
        if (!isMeasuring) {
             measureSource.clear();
             if (measureTooltip) map.removeOverlay(measureTooltip); 
        }
        toggleMeasurement();
    });
}

// =========================================================================
// PGROUTING - WIZARD HELPER FUNCTIONS
// =========================================================================

async function getRoute(start, end) {
  routeSource.clear();
  const apiUrl = `http://10.1.4.18:3000/route?start_lon=${start.lon}&start_lat=${start.lat}&end_lon=${end.lon}&end_lat=${end.lat}`;

  try {
    const response = await fetch(apiUrl);
    const routeData = await response.json(); 

    if (!routeData || !routeData.route_geometry) {
      console.error('No route was found.');
      alert('No route could be found between these two points.');
      resetRouteWizard(); 
      return;
    }

    const routeGeoJSON = routeData.route_geometry;
    const routeFeature = new ol.format.GeoJSON().readFeature(routeGeoJSON, {
      dataProjection: 'EPSG:4326',   
      featureProjection: 'EPSG:3857' 
    });

    routeSource.addFeature(routeFeature);
    map.getView().fit(routeFeature.getGeometry().getExtent(), {
      padding: [50, 50, 50, 50],
      duration: 1000
    });

    console.log("--- TURN-BY-TURN STEPS ---");
    console.table(routeData.steps);
    
  } catch (err) {
    console.error('Error fetching route:', err);
  }
}

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
    const marker = new ol.Feature({
        geometry: new ol.geom.Point(coordinate)
    });
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
    showMessage(null); // Hide banner
    map.getTargetElement().style.cursor = '';
    routeBtn.classList.remove('active');
    if (routeOptionsPanel) {
        routeOptionsPanel.style.display = 'none';
    }
}

// THIS IS THE NEW FUNCTION YOU NEEDED
function getGpsForRouting() {
    if ('geolocation' in navigator) {
        showMessage("Finding your location...");
        
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { longitude, latitude } = pos.coords;
                console.log(`GPS Location Found: ${latitude}, ${longitude}`);

                // 1. Clear the map first
                resetRouteWizard(); 

                // 2. Set the global state
                currentUserLocation = { lon: longitude, lat: latitude }; 
                startPoint = currentUserLocation; 
                routeWizardState = 'selectDest';  

                // 3. Define mapCoords FIRST
                const mapCoords = ol.proj.fromLonLat([startPoint.lon, startPoint.lat]);
                
                // 4. Add marker and show banner
                addMarker(mapCoords, 'Start'); 
                showMessage("Click on the map to set your DESTINATION");
                map.getTargetElement().style.cursor = 'crosshair';

                // 5. Zoom the map
                map.getView().animate({
                    center: mapCoords,
                    zoom: 17, 
                    duration: 1000 
                });
            },
            (err) => {
                alert('Could not get your location. Please check browser permissions.');
                resetRouteWizard(); 
            },
            { enableHighAccuracy: true }
        );
    } else {
        alert('Geolocation is not supported by your browser.');
        resetRouteWizard();
    }
}


// =========================================================================
// PGROUTING - MAIN TOOL TOGGLE & PANEL LISTENERS
// =========================================================================

// This is the main "Navigate" button on the sidebar
if (routeBtn) {
    routeBtn.addEventListener('click', () => {
        // Check if panel exists and is visible
        const isVisible = routeOptionsPanel && routeOptionsPanel.style.display === 'block';

        if (isVisible) {
            // If open, close everything
            resetRouteWizard();
        } else {
            // If closed, OPEN the panel
            
            // Turn off other tools
            if (isMeasuring) {
                toggleMeasurement();
            }
            
            // Show the panel
            if (routeOptionsPanel) {
                routeOptionsPanel.style.display = 'block';
            }
            routeBtn.classList.add('active');
        }
    });
}

// Listener for the "From Current Location" button
if (btnRouteFromGps) {
    btnRouteFromGps.addEventListener('click', () => {
        if (routeOptionsPanel) {
            routeOptionsPanel.style.display = 'none'; // Hide the panel
        }
        getGpsForRouting(); // Start the GPS-based routing
    });
}

// Listener for the "Select on Map" button
if (btnRouteManual) {
    btnRouteManual.addEventListener('click', () => {
        // Set the wizard state
        routeWizardState = 'selectStart';
        
        // Hide the panel and show the banner
        if (routeOptionsPanel) {
            routeOptionsPanel.style.display = 'none';
        }
        resetRouteWizard(); // Clear map, but keep state
        routeWizardState = 'selectStart'; // resetRouteWizard clears state, so set it again
        
        showMessage("Click on the map to set your START point");
        map.getTargetElement().style.cursor = 'crosshair';
    });
}


// =========================================================================
// MASTER CLICK HANDLER (State Machine Version)
// =========================================================================
map.on('click', function(evt) {
    
    // 1. Check if Measuring is active
    if (isMeasuring) {
        return; // Let the measure tool handle it
    }

    // 2. Use a 'switch' to manage our new wizard state
    switch (routeWizardState) {
        
        case 'idle':
            // No tool active, run "Show Info"
            handleRoadInfoClick(evt);
            break;

        case 'selectStart':
            // User is setting the START point
            const apiCoordsStart = ol.proj.toLonLat(evt.coordinate);
            startPoint = { lon: apiCoordsStart[0], lat: apiCoordsStart[1] };
            
            addMarker(evt.coordinate, 'Start');
            showMessage('Now select your DESTINATION point');
            
            // Move to the next state
            routeWizardState = 'selectDest';
            break;

        case 'selectDest':
            // User is setting the DESTINATION point
            const apiCoordsEnd = ol.proj.toLonLat(evt.coordinate);
            const endPoint = { lon: apiCoordsEnd[0], lat: apiCoordsEnd[1] };
            
            addMarker(evt.coordinate, 'End');
            showMessage(null); // Hide banner
            
            // We have a start and end, call the API!
            getRoute(startPoint, endPoint); 
            
            // Reset state to 'idle'
            routeWizardState = 'idle'; 
            map.getTargetElement().style.cursor = '';
            routeBtn.classList.remove('active'); // Deactivate the button
            break;
    }
});