/* * =========================================================================
 * RMIS 4.0 - Advanced Analytics & Geospatial Dashboard
 * =========================================================================
 * * CORE FEATURES:
 * 1. DASHBOARD ANALYTICS (Chart.js):
 * - Real-time "Viewport-Driven" aggregation (calculates stats for visible map area).
 * - Visualizes Asset Condition (Doughnut) and Asset Inventory (Bar).
 * - bridges and culverts only.
 * - Responsive UI: Floating panel with mobile toolbar adjustments.
 * =========================================================================
 */

const dashboardPanel = document.getElementById('dashboard-panel');
const dashboardOpenBtn = document.getElementById('chart-btn'); // Or 'dashboard-toggle' if you switched to slider
const dashboardCloseBtn = document.getElementById('dashboard-close-btn');

if (dashboardOpenBtn) {
    dashboardOpenBtn.onclick = function() {
        dashboardPanel.style.display = 'block';
        updateDashboardCharts();

        const tb = document.getElementById('toolbar');
        const wrapper = document.getElementById('top-controls-wrapper');
        
        if(window.innerWidth <= 500 && tb){
            if(tb) tb.classList.add('active-chart');
            if(wrapper) wrapper.classList.add('dashboard-active');
        }

        const bcCheckbox = document.getElementById('BCCheckbox');
        if (bcCheckbox && !bcCheckbox.checked) {
            bcCheckbox.checked = true;
            bcCheckbox.dispatchEvent(new Event('change'));
        }
    };
}

if (dashboardCloseBtn) {
    dashboardCloseBtn.onclick = function() {
        dashboardPanel.style.display = 'none';

        const tb = document.getElementById('toolbar');
        const wrapper = document.getElementById('top-controls-wrapper');
        
        if (window.innerWidth <= 500) {
            if(tb) tb.classList.remove('active-chart');
            if(wrapper) wrapper.classList.remove('dashboard-active'); // ADD THIS LINE
        }
    };
}


// --- 3. CHART INITIALIZATION (Rest of your file remains the same) ---
let assetChart, typeChart;

// Asset Condition chart (Doughnut) INIT
const assetChartCtx = document.getElementById('dashboard-asset-chart').getContext('2d');
assetChart = new Chart(assetChartCtx, {
    type: 'doughnut',
    data: {
        labels: ['Good', 'Fair', 'Poor'],
        datasets: [{
            data: [0, 0, 0],
            backgroundColor: ['#3ac370', '#face1a', '#d62222'],
            borderColor: ['transparent', 'transparent', 'transparent'],
            borderWidth: 0
        }]
    },
    options: {
        plugins: {
            legend: { position: 'bottom',
                labels: {
                    color: '#ffffffff',
                    font: { size: 12},
                    usePointStyle: true,
                    pointStyle: 'circle',
                    boxwidth: 7,
                    boxHeight:7
                }
             },
            datalabels: {
                color: '#ffffffff',
                font: { weight: 'bold', size: 11 },
                formatter: function(value, context) {
                    return value > 0 ? value : '';
                }
            }
        },
        cutout: "65%",
    },
    plugins: [ChartDataLabels],
});

// Asset Type chart (Bar) INIT
const typeChartCtx = document.getElementById('dashboard-type-chart').getContext('2d');
typeChart = new Chart(typeChartCtx, {
    type: 'bar',
    data: {
        labels: ['Bridge', 'Culvert'], 
        datasets: [{
            label: 'Assets',
            data: [0, 0], 
            backgroundColor: ['#FF1493', '#00FFFF'],
        }]
    },
    options: {
        plugins: { 
            legend: { display: false },
            datalabels: {
                color: '#ffffff', 
                anchor: 'end',
                align: 'top'
            }
        },
        scales: { 
            // Y-Axis (Vertical Numbers)
            y: { 
                beginAtZero: true, 
                ticks: { color: '#ffffff', font: { size: 11 }} 
            },
            // X-Axis (Bridge, Culvert Labels)
            x: {
                ticks: { 
                    color: '#ffffff', 
                    font: { size: 11 }
                }
            }
        }
    },
    // Don't forget to include the plugin if you want numbers on top of bars
    plugins: [ChartDataLabels] 
});

async function getVisibleAssets(extent) {
    // extent is [minX, minY, maxX, maxY] in EPSG:3857
    // Convert extent to EPSG:4326 (lat/lon)
    const min = ol.proj.toLonLat([extent[0], extent[1]]);
    const max = ol.proj.toLonLat([extent[2], extent[3]]);
    
    // Build CQL filter: BBOX(geom, minLon, minLat, maxLon, maxLat, 'EPSG:4326')
    const bboxCql = (min, max) => `BBOX(geom, ${min[0]}, ${min[1]}, ${max[0]}, ${max[1]}, 'EPSG:4326')`;

    // WFS config for both types
    const layers = [
        { type: 'Bridge', url: 'https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&' +
            'version=1.0.0&request=GetFeature&typeName=rmisv2db_prod:tbl_bridge&outputFormat=application/json&' +
            'cql_filter=' + encodeURIComponent(bboxCql(min, max)) + 
            '&maxFeatures=1000&_=' + Date.now()
        },
        { type: 'Culvert', url: 'https://10.1.4.18/geoserver/rmisv2db_prod/ows?service=WFS&' +
            'version=1.0.0&request=GetFeature&typeName=rmisv2db_prod:tbl_culvert&outputFormat=application/json&' +
            'cql_filter=' + encodeURIComponent(bboxCql(min, max)) + 
            '&maxFeatures=1000&_=' + Date.now()
        }
    ];

    let allAssets = [];
    for (const layer of layers) {
        try {
            const res = await fetch(layer.url);
            if (!res.ok) continue;
            const data = await res.json();
            if (data.features && data.features.length > 0) {
                data.features.forEach(f => {
                    f.properties._assetType = layer.type;
                    allAssets.push(f.properties);
                });
            }
        } catch (e) {
            console.error("Error fetching assets for layer", layer.type, e);
        }
    }
    return allAssets; // [{...props, _assetType: 'Bridge'}, {...props, _assetType: 'Culvert'}]
}

function normalizeCondition(rawCond) {
    if (!rawCond) return "Unknown";
    const val = rawCond.toLowerCase().replace(/[^a-z]/gi, "");
    if (val.startsWith("good")) return "Good";
    if (val.startsWith("fair")) return "Fair";
    if (val.startsWith("poor")) return "Poor";
    return "Unknown";
}

async function updateDashboardCharts() {
    // Only show when panel is open
    if (dashboardPanel.style.display !== 'block') return;

    // Get map bounds in EPSG:3857!
    const extent = map.getView().calculateExtent(map.getSize());

    // Fetch assets in viewport
    const assets = await getVisibleAssets(extent);

    // Aggregate condition counts
    let good=0, fair=0, poor=0;
    let bridge=0, culvert=0;

    for (let asset of assets) {
    let condRaw = undefined;
    if (asset._assetType === "Bridge") condRaw = asset.br_general_condition;
    if (asset._assetType === "Culvert") condRaw = asset.cv_general_condition;
    const cond = normalizeCondition(condRaw);

    if (asset._assetType === "Bridge") bridge++;
    if (asset._assetType === "Culvert") culvert++;
    if (cond === "Good") good++;
    else if (cond === "Fair") fair++;
    else if (cond === "Poor") poor++;
}

    document.getElementById('condition-summary').innerHTML = 
    `<span style='color:#3ac370;'>Good: ${good}</span> | ` +
    `<span style='color:#face1a;'>Fair: ${fair}</span> | ` +
    `<span style='color:#d62222;'>Poor: ${poor}</span>`;

    // Update Chart.js values
    assetChart.data.datasets[0].data = [good, fair, poor];
    assetChart.update();

    typeChart.data.datasets[0].data = [bridge, culvert];
    typeChart.update();
}