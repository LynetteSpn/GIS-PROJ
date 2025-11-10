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
let isMeasuring = false;

const measureBtn = document.getElementById('measure-btn');
const measureTooltipElement = document.createElement('div');
let measureTooltip;

/**
 * Format length output.
 * @param {ol.geom.LineString} line The line geometry.
 * @return {string} The formatted length (m or km).
 */
const formatLength = function (line) {
    // 1. Reproject the LineString geometry to EPSG:4326 (WGS 84)
    // We clone the geometry and transform it to ensure accuracy.
    const transformedLine = line.clone().transform(
        map.getView().getProjection(), // Source Projection (e.g., EPSG:3857)
        'EPSG:4326'                    // Target Projection (WGS 84)
    );

    // 2. Calculate the geodetic length using the WGS 84 coordinates
    // We explicitly tell ol.sphere.getLength the projection is 'EPSG:4326'
    const length = ol.sphere.getLength(transformedLine, { projection: 'EPSG:4326' });
    
    let output;
    if (length > 100) {
        // Convert to Kilometers
        output = Math.round((length / 1000) * 100) / 100 + ' km';
    } else {
        // Use Meters
        output = Math.round(length * 100) / 100 + ' m';
    }
    return output;
};

// --- Function to create the measurement tooltip overlay ---
function createMeasureTooltip() {
    // Check if the element exists in the DOM and remove any previous instance
    if (measureTooltip) map.removeOverlay(measureTooltip); 
    
    // Create the OpenLayers overlay
    measureTooltip = new ol.Overlay({
        element: measureTooltipElement,
        offset: [0, -15],
        positioning: 'bottom-center'
    });
    map.addOverlay(measureTooltip);
    // Ensure it's visible when starting a draw
    measureTooltipElement.style.display = 'block'; 
}

// --- Function to start measurement interaction ---
function addInteraction() {
    measureDraw = new ol.interaction.Draw({
        source: measureSource,
        type: 'LineString',
        // Style the drawing interaction itself
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

    createMeasureTooltip(); // Initialize the tooltip overlay

    // Listener for when the user starts drawing a feature
    measureDraw.on('drawstart', function (evt) {
        measureSource.clear(); // Clear previous measurement
        measureTooltipElement.innerHTML = '0 m';
        measureTooltip.setPosition(evt.coordinate);
        
        let sketch = evt.feature;
        let listener = sketch.getGeometry().on('change', function (evt) {
            let geom = evt.target;
            let output = formatLength(geom);
            measureTooltipElement.innerHTML = output;
            measureTooltip.setPosition(geom.getLastCoordinate());
        });

        // Store the listener so we can dispose of it later
        sketch.set('listener', listener);
    });

    // Listener for when the user finishes drawing a feature (double-click)
    measureDraw.on('drawend', function (evt) {
        // Finalize the tooltip appearance
        measureTooltipElement.className = 'ol-tooltip ol-tooltip-static';
        // Remove the 'change' listener from the feature
        ol.Observable.unByKey(evt.feature.get('listener'));

        // Important: Stop the tool immediately after measurement ends
        toggleMeasurement(); 
    });
}


// --- Function to activate/deactivate the tool ---
function toggleMeasurement() {
    isMeasuring = !isMeasuring;
    measureBtn.classList.toggle('active', isMeasuring);

    if (isMeasuring) {
        // Start Measurement: Activate interaction
       // 1. Clear previous measurements and reset tooltip appearance
        measureSource.clear(); 
        if (measureTooltipElement) {
            // Hide the tooltip element initially, it will be made visible in addInteraction
            measureTooltipElement.style.display = 'block'; 
            measureTooltipElement.className = 'ol-tooltip ol-tooltip-measure';
        }
        disableRoadInfoClick();
        
        // 2. Start the drawing interaction
        addInteraction();
        map.getTargetElement().style.cursor = 'crosshair';
    } else {
        // Stop Measurement: Deactivate interaction and clear the features/tooltip
        map.removeInteraction(measureDraw);
        map.getTargetElement().style.cursor = '';
        
        enableRoadInfoClick();
        // Hide the tool-in-progress tooltip element
        //measureTooltipElement.style.display = 'none';
    }
}

// --- Attach Listener to Measure Button ---
if (measureBtn) {
    measureBtn.addEventListener('click', function () {
        if (!isMeasuring) {
             measureSource.clear();
             // Remove the static overlay (if it exists) to ensure a clean start
             if (measureTooltip) map.removeOverlay(measureTooltip); 
        }

        toggleMeasurement();
    });
}