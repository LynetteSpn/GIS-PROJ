// Advanced Hover Analytics (District Stats) - improved version
// - safer WFS handling
// - chunking of large OR filters
// - XML escaping
// - improved fallbacks for counts

// 1. SETUP TOOLTIP UI (Create the box)
const hoverTooltipElement = document.createElement('div');
hoverTooltipElement.className = 'ol-tooltip-hover';
hoverTooltipElement.style.position = 'absolute';
hoverTooltipElement.style.background = 'rgba(0, 0, 0, 0.85)';
hoverTooltipElement.style.color = 'white';
hoverTooltipElement.style.padding = '8px 12px';
hoverTooltipElement.style.borderRadius = '6px';
hoverTooltipElement.style.pointerEvents = 'none';
hoverTooltipElement.style.fontSize = '12px';
hoverTooltipElement.style.zIndex = '9999';
hoverTooltipElement.style.whiteSpace = 'nowrap';
hoverTooltipElement.style.display = 'none';
hoverTooltipElement.style.maxWidth = '320px';
hoverTooltipElement.style.overflow = 'hidden';
hoverTooltipElement.style.textOverflow = 'ellipsis';
document.body.appendChild(hoverTooltipElement);

// 2. ADD OVERLAY TO MAP
const hoverOverlay = new ol.Overlay({
    element: hoverTooltipElement,
    offset: [15, 0],
    positioning: 'center-left'
});
map.addOverlay(hoverOverlay);

// District name -> code map
const districtNameMap = {
    "Tuaran": "04",
    "Ranau": "06",
    "Kota Belud": "03",
    "Sandakan": "07",
    "Kinabatangan": "09",
    "Beluran": "08",
    "Tongod": "25",
    "Telupid": "28",
    "Tawau": "10",
    "Lahad Datu": "11",
    "Kunak": "24",
    "Semporna": "12",
    "Keningau": "13",
    "Nabawan": "15",
    "Tambunan": "14",
    "Tenom": "16",
    "Beaufort": "17",
    "Kuala Penyu": "18",
    "Sipitang": "19",
    "Kota Marudu": "22",
    "Kudat": "05",
    "Pitas": "23",
    "Kota Kinabalu": "01",
    "Papar": "02",
    "Penampang": "21",
    "Putatan": "27"
};

let isMapLoaded = true;
console.log("✅ District Mapping Loaded (Static Mode)");

// Simple cache: { [districtName]: stats }
const districtStatsCache = {}; // consider adding TTL/invalidation if underlying data changes

// Helper: escape XML special chars for literals
function escapeXml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Helper: coerce GeoServer/WFS count
function extractFeatureCount(json) {
    // GeoServer WFS can return numberOfFeatures, totalFeatures (string or number),
    // or if returned features array, use its length.
    if (!json) return 0;
    if (typeof json.numberOfFeatures !== 'undefined') {
        return Number(json.numberOfFeatures) || 0;
    }
    if (typeof json.totalFeatures !== 'undefined') {
        // totalFeatures sometimes is a string like "123"
        const n = Number(json.totalFeatures);
        return Number.isNaN(n) ? 0 : n;
    }
    if (Array.isArray(json.features)) {
        return json.features.length;
    }
    // fallback for other shapes
    return 0;
}

async function getDistrictStatsDeep(districtName) {
    // Normalize districtName
    const name = (districtName || '').trim();
    if (!name) return null;

    if (districtStatsCache[name]) return districtStatsCache[name];

    const dCode = districtNameMap[name];
    if (!dCode) {
        console.warn(`⚠️ No district code mapped for "${name}"`);
        return null;
    }

    // Use same GeoServer URL you used successfully
    const wfsUrl = 'https://10.1.4.18/geoserver/rmisv2db_prod/ows';

    try {
        // --- STEP A: Get Road IDs (GET Request) ---
        const roadUrl = `${wfsUrl}?service=WFS&version=1.0.0&request=GetFeature&typeName=rmisv2db_prod:gis_sabah_road_map&outputFormat=application/json&propertyName=pkm_road_id&cql_filter=district_code='${encodeURIComponent(dCode)}'&maxFeatures=20000`;
        const roadRes = await fetch(roadUrl, { method: 'GET', headers: { Accept: 'application/json' } });
        if (!roadRes.ok) {
            console.warn(`Road IDs request returned status ${roadRes.status}`);
            // continue but treat as no roads
            return { bridges: 0, bridgesPoor: 0, culverts: 0, culvertsPoor: 0 };
        }
        const roadData = await roadRes.json();
        const roadIds = (roadData.features || [])
            .map(f => f && f.properties && f.properties.pkm_road_id ? String(f.properties.pkm_road_id).trim() : null)
            .filter(id => id);

        if (roadIds.length === 0) {
            // No roads in this district
            districtStatsCache[name] = { bridges: 0, bridgesPoor: 0, culverts: 0, culvertsPoor: 0 };
            return districtStatsCache[name];
        }

        // Build an OR filter for chunks of roadIds to avoid giant POST bodies if many IDs
        const MAX_IDS_PER_CHUNK = 400; // tune as needed
        function buildOrFilterForIds(ids) {
            if (!ids || ids.length === 0) return '';
            let orFilter = '<ogc:Or>';
            ids.forEach(id => {
                const safeId = escapeXml(id);
                orFilter += `
                    <ogc:PropertyIsLike wildCard="*" singleChar="." escapeChar="!">
                        <ogc:PropertyName>road_id</ogc:PropertyName>
                        <ogc:Literal>*${safeId}*</ogc:Literal>
                    </ogc:PropertyIsLike>`;
            });
            orFilter += '</ogc:Or>';
            return orFilter;
        }

        const buildXmlBody = (layerName, filterContent) => {
            return `
                <wfs:GetFeature service="WFS" version="1.0.0"
                    resultType="hits"
                    outputFormat="application/json"
                    xmlns:wfs="http://www.opengis.net/wfs"
                    xmlns:ogc="http://www.opengis.net/ogc"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xsi:schemaLocation="http://www.opengis.net/wfs http://schemas.opengis.net/wfs/1.0.0/WFS-basic.xsd">
                    <wfs:Query typeName="${escapeXml(layerName)}">
                        <ogc:Filter>
                            ${filterContent}
                        </ogc:Filter>
                    </wfs:Query>
                </wfs:GetFeature>`;
        };

        // fetchCount for a single layer, but will chunk by roadId groups and sum results
        const fetchCount = async (layer, extraFilterXml = null) => {
            // chunk the roadIds into groups
            const chunks = [];
            for (let i = 0; i < roadIds.length; i += MAX_IDS_PER_CHUNK) {
                chunks.push(roadIds.slice(i, i + MAX_IDS_PER_CHUNK));
            }

            // perform requests for each chunk and sum
            const results = await Promise.all(chunks.map(async (idsChunk) => {
                const orFilter = buildOrFilterForIds(idsChunk);
                let finalFilter = orFilter;
                if (extraFilterXml) {
                    finalFilter = `<ogc:And>${orFilter}${extraFilterXml}</ogc:And>`;
                }
                const xmlBody = buildXmlBody(layer, finalFilter);

                const res = await fetch(wfsUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/xml',
                        'Accept': 'application/json'
                    },
                    body: xmlBody
                });

                if (!res.ok) {
                    console.warn(`WFS POST to ${layer} chunk returned status ${res.status}`);
                    return 0;
                }
                const json = await res.json();
                return extractFeatureCount(json);
            }));

            // sum chunked results
            return results.reduce((a, b) => a + b, 0);
        };

        const poorBridgeXml = `
            <ogc:PropertyIsLike wildCard="*" singleChar="." escapeChar="!">
                <ogc:PropertyName>br_general_condition</ogc:PropertyName>
                <ogc:Literal>*${escapeXml('Poor')}*</ogc:Literal>
            </ogc:PropertyIsLike>`;

        const poorCulvertXml = `
            <ogc:PropertyIsLike wildCard="*" singleChar="." escapeChar="!">
                <ogc:PropertyName>cv_general_condition</ogc:PropertyName>
                <ogc:Literal>*${escapeXml('Poor')}*</ogc:Literal>
            </ogc:PropertyIsLike>`;

        // Parallel requests (but each will itself be chunked)
        const [bTotal, bPoor, cTotal, cPoor] = await Promise.all([
            fetchCount('rmisv2db_prod:tbl_bridge', null),
            fetchCount('rmisv2db_prod:tbl_bridge', poorBridgeXml),
            fetchCount('rmisv2db_prod:tbl_culvert', null),
            fetchCount('rmisv2db_prod:tbl_culvert', poorCulvertXml)
        ]);

        const stats = {
            bridges: bTotal,
            bridgesPoor: bPoor,
            culverts: cTotal,
            culvertsPoor: cPoor
        };

        console.log(`✅ Stats for ${name}:`, stats);
        districtStatsCache[name] = stats;
        return stats;

    } catch (err) {
        console.error("❌ Stats Error:", err);
        return null;
    }
}

// 4. POINTERMOVE / EVENT LISTENER
let currentHoveredDistrict = null;

map.on('pointermove', async function (evt) {
    if (evt.dragging) {
        hoverTooltipElement.style.display = 'none';
        return;
    }

    // Priority 1: assets (non-district layers)
    const assetHit = map.forEachFeatureAtPixel(evt.pixel, function(feature, layer) {
        // if layer is undefined (feature from vector source no layer) or layer not the districtLayer, treat as asset
        return (layer && layer === districtLayer) ? null : feature;
    });

    if (assetHit) {
        try {
            const props = assetHit.getProperties();
            let content = null;

            if (props.name && props.condition) {
                const color = String(props.condition).toLowerCase() === 'poor' ? '#ff4d4d' : '#4dff88';
                content = `<strong>${escapeXml(props.name)}</strong><br>Status: <span style="color:${color}">${escapeXml(props.condition)}</span>`;
            } else if (props.road_name) {
                content = `🛣️ ${escapeXml(props.road_name)}`;
            } else if (props.name && String(props.name).startsWith("Stop")) {
                content = `📍 ${escapeXml(props.name)}`;
            }

            if (content) {
                hoverTooltipElement.innerHTML = content;
                hoverOverlay.setPosition(evt.coordinate);
                hoverTooltipElement.style.display = 'block';
                map.getTargetElement().style.cursor = 'pointer';
                currentHoveredDistrict = null;
                return;
            }
        } catch (e) {
            console.warn('Asset tooltip error:', e);
        }
    }

    // Priority 2: district polygon
    const districtHit = map.forEachFeatureAtPixel(evt.pixel, function(feature, layer) {
        return (layer === districtLayer) ? feature : null;
    });

    if (districtHit) {
        // try multiple common name fields
        const rawName = districtHit.get('NAME_2') || districtHit.get('name') || districtHit.get('NAM') || districtHit.get('Name') || null;
        if (!rawName) return;

        const dName = String(rawName).trim();
        hoverTooltipElement.style.display = 'block';
        hoverOverlay.setPosition(evt.coordinate);
        map.getTargetElement().style.cursor = 'help';

        if (currentHoveredDistrict !== dName) {
            console.log(`👉 Hovered new district: ${dName}`);
            currentHoveredDistrict = dName;
            hoverTooltipElement.innerHTML = `<strong>${escapeXml(dName)}</strong><br>Scanning DB...`;

            const stats = await getDistrictStatsDeep(dName);

            if (stats) {
                hoverTooltipElement.innerHTML = `
                    <div style="border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 4px; margin-bottom: 6px;">
                        <strong style="font-size:14px;">${escapeXml(dName)}</strong>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size:12px;">
                        <div>
                            <u style="font-size:10px; color:#cfcfcf">BRIDGES</u><br>
                            Total: <b>${stats.bridges}</b><br>
                            Poor: <b style="color:#ff4d4d">${stats.bridgesPoor}</b>
                        </div>
                        <div>
                            <u style="font-size:10px; color:#cfcfcf">CULVERTS</u><br>
                            Total: <b>${stats.culverts}</b><br>
                            Poor: <b style="color:#ff4d4d">${stats.culvertsPoor}</b>
                        </div>
                    </div>
                `;
            } else {
                hoverTooltipElement.innerHTML = `<strong>${escapeXml(dName)}</strong><br>No Assets Found or WFS Error.`;
            }
        }
    } else {
        // nothing under cursor
        hoverTooltipElement.style.display = 'none';
        currentHoveredDistrict = null;
        map.getTargetElement().style.cursor = '';
    }
});