/* * =========================================================================
 * RMIS 4.0 - DASHBOARD MODULE (Documented)
 * =========================================================================
 * Purpose: Handles the Analytics Dashboard logic.
 * 1. UI: Opens/Closes the floating panel.
 * 2. CHARTS: Renders visuals using Chart.js library.
 * 3. DATA: Fetches real-time data from GeoServer based on where the user is looking.
 * ========================================================================= */

// --- 1. UI ELEMENTS SELECTION ---
// We grab the HTML elements so we can control them with JavaScript.
const dashboardPanel = document.getElementById('dashboard-panel');
const dashboardOpenBtn = document.getElementById('chart-btn'); 
const dashboardCloseBtn = document.getElementById('dashboard-close-btn');

// --- 2. OPEN BUTTON LOGIC ---
if (dashboardOpenBtn) {
    dashboardOpenBtn.onclick = function() {
        // A. Show the panel (CSS display: block)
        dashboardPanel.style.display = 'block';
        
        // B. Trigger the data update immediately so it's not empty
        updateDashboardCharts();

        // C. Mobile Responsive Logic
        // If screen is small (mobile), we hide other toolbars to save space
        const tb = document.getElementById('toolbar');
        const wrapper = document.getElementById('top-controls-wrapper');
        
        if(window.innerWidth <= 500 && tb){
            if(tb) tb.classList.add('active-chart'); // Custom CSS class to adjust layout
            if(wrapper) wrapper.classList.add('dashboard-active');
        }

        // D. Force "Bridges & Culverts" Layer ON
        // The dashboard needs this data, so we auto-check the checkbox if it's off
        const bcCheckbox = document.getElementById('BCCheckbox');
        if (bcCheckbox && !bcCheckbox.checked) {
            bcCheckbox.checked = true;
            // We must manually dispatch the 'change' event so the map listeners react
            bcCheckbox.dispatchEvent(new Event('change'));
        }

        // E. Force "Potholes" Layer ON
        // The dashboard needs this data, so we auto-check the checkbox if it's off
        const potholeCheckbox = document.getElementById('PotholeCheckbox');
        if (potholeCheckbox && !potholeCheckbox.checked) {
            potholeCheckbox.checked = true;
            potholeCheckbox.dispatchEvent(new Event('change'));
        }
    };
}

// --- 3. CLOSE BUTTON LOGIC ---
if (dashboardCloseBtn) {
    dashboardCloseBtn.onclick = function() {
        // Hide the panel
        dashboardPanel.style.display = 'none';

        // Revert Mobile adjustments (Put things back to normal)
        const tb = document.getElementById('toolbar');
        const wrapper = document.getElementById('top-controls-wrapper');
        
        if (window.innerWidth <= 500) {
            if(tb) tb.classList.remove('active-chart');
            if(wrapper) wrapper.classList.remove('dashboard-active'); 
        }
    };
}


// --- 4. CHART CONFIGURATION (Chart.js) ---
// We define these globally so we can update their data later without re-creating them.
let assetChart, typeChart;

// --- CHART A: ASSET CONDITION (Doughnut Chart) ---
// Shows percentages of Good vs Fair vs Poor
const assetChartCtx = document.getElementById('dashboard-asset-chart').getContext('2d');
assetChart = new Chart(assetChartCtx, {
    type: 'doughnut', // The shape of the chart
    data: {
        labels: ['Good', 'Fair', 'Poor'], // The categories
        datasets: [{
            data: [0, 0, 0], // Placeholder data (will be replaced by updateDashboardCharts)
            // Green for Good, Yellow for Fair, Red for Poor
            backgroundColor: ['#3ac370', '#face1a', '#d62222'], 
            borderColor: ['transparent', 'transparent', 'transparent'],
            borderWidth: 0
        }]
    },
    options: {
        plugins: {
            // Legend Configuration (The labels at the bottom)
            legend: { 
                position: 'bottom',
                labels: {
                    color: '#ffffffff', // White text
                    font: { size: 12},
                    usePointStyle: true, // Use circles instead of squares for legend icons
                    pointStyle: 'circle'
                }
             },
            // DataLabels Plugin: Shows numbers inside the chart segments
            datalabels: {
                color: '#ffffffff',
                font: { weight: 'bold', size: 11 },
                // Only show the number if it's greater than 0
                formatter: function(value, context) {
                    return value > 0 ? value : '';
                }
            }
        },
        cutout: "65%", // Makes it a "Donut" (hole in middle) instead of a "Pie"
    },
    plugins: [ChartDataLabels], // Activates the plugin
});



// --- CHART B: ASSET TYPE (Bar Chart) ---
// Shows count of Bridges vs Culverts
const typeChartCtx = document.getElementById('dashboard-type-chart').getContext('2d');
typeChart = new Chart(typeChartCtx, {
    type: 'bar',
    data: {
        labels: ['Bridge', 'Culvert'], 
        datasets: [{
            label: 'Assets',
            data: [0, 0], // Placeholder
            backgroundColor: ['#FF1493', '#00FFFF'], // Pink for Bridge, Cyan for Culvert
        }]
    },
    options: {
        plugins: { 
            legend: { display: false }, // Hide legend (labels are on axis)
            datalabels: {
                color: '#ffffff', 
                anchor: 'end', // Position number at top of bar
                align: 'top'
            }
        },
        scales: { 
            // Y-Axis Styling (White text)
            y: { 
                beginAtZero: true, 
                ticks: { color: '#ffffff', font: { size: 11 }} 
            },
            // X-Axis Styling
            x: {
                ticks: { color: '#ffffff', font: { size: 11 } }
            }
        }
    },
    plugins: [ChartDataLabels] 
});


// --- 5. DATA FETCHING (The "Brain" of the Dashboard) ---

/**
 * FEATURE: getVisibleAssets
 * Purpose: Asks GeoServer for all bridges/culverts inside the current map view.
 * @param {Array} extent - The [minX, minY, maxX, maxY] coordinates of the screen.
 */
async function getVisibleAssets(extent) {
    // 1. Coordinate Conversion
    // The map uses EPSG:3857 (Meters), but the Database stores GPS (EPSG:4326 Lat/Lon).
    // We must convert the corners of the screen to Lat/Lon.
    const min = ol.proj.toLonLat([extent[0], extent[1]]);
    const max = ol.proj.toLonLat([extent[2], extent[3]]);
    
    // 2. Build CQL Filter (Common Query Language)
    // "BBOX" stands for Bounding Box. It finds things inside a rectangle.
    const bboxCql = (min, max) => `BBOX(geom, ${min[0]}, ${min[1]}, ${max[0]}, ${max[1]}, 'EPSG:4326')`;

    // 3. Define Requests
    // We need to ask for TWO things: Bridges AND Culverts.
    const layers = [
        { 
            type: 'Bridge', 
            url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&` +
                 'version=1.0.0&request=GetFeature&typeName=rmisv2db_prod:tbl_bridge&outputFormat=application/json&' +
                 'cql_filter=' + encodeURIComponent(bboxCql(min, max)) + // Insert our BBOX filter
                 '&maxFeatures=1000&_=' + Date.now()
        },
        { 
            type: 'Culvert', 
            url: `${GEOSERVER_HOST}/geoserver/rmisv2db_prod/ows?service=WFS&` +
                 'version=1.0.0&request=GetFeature&typeName=rmisv2db_prod:tbl_culvert&outputFormat=application/json&' +
                 'cql_filter=' + encodeURIComponent(bboxCql(min, max)) + 
                 '&maxFeatures=1000&_=' + Date.now()
        }
    ];

    let allAssets = [];
    
    // 4. Execute Fetches
    for (const layer of layers) {
        try {
            const res = await fetch(layer.url);
            if (!res.ok) continue; // Skip if error
            const data = await res.json();
            
            // 5. Tag and Merge Data
            if (data.features && data.features.length > 0) {
                data.features.forEach(f => {
                    // We add a custom tag "_assetType" so we know if it's a bridge or culvert later
                    f.properties._assetType = layer.type;
                    allAssets.push(f.properties);
                });
            }
        } catch (e) {
            console.error("Error fetching assets for layer", layer.type, e);
        }
    }
    return allAssets; // Returns combined list
}

/**
 * FEATURE: normalizeCondition
 * Purpose: Cleans up dirty database text.
 * Example: Converts "Good (Verified)" or "good condition" -> "Good"
 */
function normalizeCondition(rawCond) {
    if (!rawCond) return "Unknown";
    // Remove non-letters and convert to lowercase
    const val = rawCond.toLowerCase().replace(/[^a-z]/gi, "");
    
    if (val.startsWith("good")) return "Good";
    if (val.startsWith("fair")) return "Fair";
    if (val.startsWith("poor")) return "Poor";
    return "Unknown";
}


// --- 6. MASTER UPDATE FUNCTION ---
// This runs every time the map moves (if enabled) or when the button is clicked.
async function updateDashboardCharts() {
    // Optimization: Don't do heavy calculations if the panel is hidden
    if (dashboardPanel.style.display !== 'block') return;

    // A. Get the current map boundaries
    const extent = map.getView().calculateExtent(map.getSize());

    // B. Get the data from Server
    const assets = await getVisibleAssets(extent);

    // C. Calculate Statistics (Aggregation)
    let good=0, fair=0, poor=0;
    let bridge=0, culvert=0;

    for (let asset of assets) {
        // 1. Determine Condition
        let condRaw = undefined;
        if (asset._assetType === "Bridge") condRaw = asset.br_general_condition;
        if (asset._assetType === "Culvert") condRaw = asset.cv_general_condition;
        
        const cond = normalizeCondition(condRaw);

        // 2. Increment Counters
        if (asset._assetType === "Bridge") bridge++; 
        if (asset._assetType === "Culvert") culvert++;
        
        if (cond === "Good") good++;
        else if (cond === "Fair") fair++;
        else if (cond === "Poor") poor++;
    }

    // D. Update HTML Summary Text
    document.getElementById('condition-summary').innerHTML = 
    `<span style='color:#3ac370;'>Good: ${good}</span> | ` +
    `<span style='color:#face1a;'>Fair: ${fair}</span> | ` +
    `<span style='color:#d62222;'>Poor: ${poor}</span>`;

    // E. Update Charts with new numbers
    assetChart.data.datasets[0].data = [good, fair, poor];
    assetChart.update(); // Force Chart.js to redraw

    typeChart.data.datasets[0].data = [bridge, culvert];
    typeChart.update();
}