/*
 * =========================================================================
 * RMIS BACKEND API SERVER
 * =========================================================================
 * Purpose: Acts as the middleware between the OpenLayers Frontend and PostGIS Database.
 * Tech Stack: Node.js, Express, PostgreSQL (pg), PostGIS, pgRouting.
 * * CORE MODULES:
 * 1. AUTHENTICATION (/login): 
 * - Validates user roles (e.g., 'Group IT', 'JKR').
 * - Assigns permission flags (canViewDefects, allowedDistricts).
 * * 2. ASSET VISUALIZATION:
 * - /assets/critical: Fetches 'Poor' condition Bridges & Culverts.
 * - /assets/potholes: Returns validated pothole data with photo links.
 * * 3. ROUTING ENGINE (pgRouting):
 * - /route: Standard A-to-B Dijkstra navigation.
 * - /route/optimize: Solves Traveling Salesperson Problem (TSP) using 
 * Nearest Neighbor logic to reorder multiple maintenance stops.
 * * 4. GEOSPATIAL LOGIC:
 * - Snaps user coordinates to the nearest graph node (gis_sabah_vertices).
 * - Generates GeoJSON FeatureCollections for map rendering.
 * =========================================================================
 */

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const https = require('https'); 
const fs = require('fs');      

// === 1. SETUP EXPRESS WEB SERVER ===
const app = express();
const port = 3005;
app.use(cors());


const SERVER_IP = "10.1.4.27"; 


// === 2. SETUP POSTGRESQL CONNECTION ===
const pool = new Pool({
  user: 'gis_user',
  host: '192.168.0.35',
  database: 'rmisv2db_prod', // Your Database Name
  password: 'pkmgis', // Your Password
  port: 5433,
});

app.use(express.json());

// =========================================================================
// FEATURE 1: STANDARD ROUTING HELPER (A to B) SNAPPING BY COORDS
// =========================================================================
app.post('/login', async (req, res) => {
    const { username } = req.body; // username IS the lombardi_userid
    
    try {
        // 1. The "Detective" Query
        const query = `
            SELECT 
                r.resource_id, 
                r.resource_name, 
                r.lombardi_userid,
                g.group_desc,         
                array_agg(d.district_code) as districts 
            FROM tbl_resource r
            LEFT JOIN tbl_resource_group g ON r.resource_role_id = g.group_id
            LEFT JOIN tbl_district_resource d ON r.resource_id = d.resource_id
            WHERE r.lombardi_userid = $1 
              AND r.active = true
            GROUP BY r.resource_id, r.resource_name, r.lombardi_userid, g.group_desc;
        `;

        const result = await pool.query(query, [username]);

        if (result.rows.length > 0) {
            const user = result.rows[0];
            const role = user.group_desc || ""; // e.g., "Group IT" or "JKR/MOF"

            // 2. Default Permissions (Safe Mode)
            let permissions = {
                canViewAllDistricts: false, // Default: Only see assigned districts
                canViewDefects: true,       // Default: Can see potholes
                allowedDistricts: user.districts.filter(d => d !== null)
            };

            // 3. Apply Rules based on YOUR Screenshot Strings 📏
            
            // RULE A: "Group IT" (Super Admin)
            if (role === 'Group IT') {
                permissions.canViewAllDistricts = true;
                permissions.canViewDefects = true;
            } 
            
            // // RULE B: "JKR/MOF" (Client View)
            // else if (role === 'JKR/MOF') {
            //     permissions.canViewAllDistricts = true; // Assuming JKR sees the whole state?
            //     permissions.canViewDefects = false;     // HIDE Defects!
            // }

            // // RULE C: "Road Inspector"
            // else if (role === 'Road Inspector') {
            //     // They keep defaults: 
            //     // - canViewAllDistricts = false (Restricted to their districts)
            //     // - canViewDefects = true (They need to see work)
            // }

            console.log(`User ${user.lombardi_userid} logged in as [${role}]`); // Helpful for debugging

            res.json({
                success: true,
                message: "Login Successful",
                user: {
                    id: user.resource_id,
                    username: user.lombardi_userid,
                    name: user.resource_name,
                    role: role,
                    permissions: permissions
                }
            });
        } else {
            res.status(404).json({ success: false, message: "User ID not found" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


// =========================================================================
// FEATURE 2: ASSET SCANNER (With Type Filtering)
// =========================================================================
// It scans for critical assets (bridges and culverts in poor condition) and 
// returns their locations.

app.get('/assets/critical', async (req, res) => {
    try {
        // Get type from URL: ?type=bridge OR ?type=culvert
        const type = req.query.type; 

        let queries = [];

        // 1. Query Bridges (If type is 'bridge')
        if (!type || type === 'bridge') {
            queries.push(`
                SELECT ROW_NUMBER() OVER () as id, 
                       ST_X(geom) as lon, 
                       ST_Y(geom) as lat, 
                       COALESCE(structure_no, 'Unnamed Bridge') as name, 
                       'Bridge' as type, 
                       br_general_condition as condition
                FROM tbl_bridge 
                WHERE br_general_condition ILIKE 'poor' AND geom IS NOT NULL
            `);
        }

        // 2. Query Culverts (Same trick)
        if (!type || type === 'culvert') {
            queries.push(`
                SELECT ROW_NUMBER() OVER () as id, 
                       ST_X(geom) as lon, 
                       ST_Y(geom) as lat, 
                       COALESCE(cv_structure_no, 'Unnamed Culvert') as name, 
                       'Culvert' as type, 
                       cv_general_condition as condition
                FROM tbl_culvert 
                WHERE cv_general_condition ILIKE 'poor' AND geom IS NOT NULL
            `);
        }
        const finalQuery = queries.join(' UNION ALL ');
        
        const result = await pool.query(finalQuery);
        res.json(result.rows);

    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching assets");
    }
});


// =========================================================================
// FEATURE: POTHOLE DEFECTS LAYER (OPTIMIZED & FAST)
// =========================================================================
app.get('/assets/potholes', async (req, res) => {
    try {
        const { districts } = req.query; 

        let districtFilter = "";
        if (districts) {
            const distArray = districts.split(',');
            const distString = distArray.map(d => `'${d}'`).join(',');
            districtFilter = `AND r.district_code IN (${distString})`; 
        }

        // 1. FAST QUERY: Standard Integer Join
        const query = `
            SELECT 
                r.surv_rec_id as id,
                r.pkm_road_id,
                t.defect_type_desc as description,
                r.verification_status as status,
                ST_X(r.geom) as lon,
                ST_Y(r.geom) as lat,
                ph.before_photo_id as before_photo,
                ph.after_photo_id as after_photo

            FROM tbl_surv_rec r
            LEFT JOIN tbl_defect_type t ON r.defect_type_code = t.defect_type_code
            
            -- FAST INNER JOIN (No casting, No trimming)
            INNER JOIN tbl_before_after_photo_link ph 
            ON r.surv_rec_id = ph.before_surv_rec_id
            
            WHERE r.geom IS NOT NULL 
            AND r.surv_rec_timestamp::date > '2021-01-01'
            ${districtFilter}
        
        `;

        const result = await pool.query(query);

        const geoJson = {
            type: "FeatureCollection",
            features: result.rows.map(row => ({
                type: "Feature",
                properties: {
                    id: row.id,
                    road_id: row.pkm_road_id,
                    name: row.description, 
                    status: row.status,
                    type: 'Pothole',
                    photo_before: row.before_photo,
                    photo_after: row.after_photo
                },
                geometry: {
                    type: "Point",
                    coordinates: [row.lon, row.lat]
                }
            }))
        };

        res.json(geoJson);

    } catch (err) {
        console.error("Error fetching potholes:", err);
        res.status(500).send("Server Error");
    }
});

// =========================================================================
// FEATURE 4: MULTISTOP ROUTE OPTIMIZATION (TSP)
// =========================================================================
// It optimizes a route given multiple locations (lat/lon pairs) using a simple
// "Nearest Neighbor" algorithm for TSP and returns the ordered route geometry.

app.get('/route/optimize', async (req, res) => {
    try {
        const locations = JSON.parse(req.query.locations);
        if (!locations || locations.length < 2) return res.status(400).send("Need at least 2 locations.");

        console.log(`\n--- STARTING OPTIMIZATION (${locations.length} Points) ---`);

        // 1. SNAP POINTS (We still need DB for this)
        const valuesList = locations.map((loc, index) => `(${index + 1}, ${loc[0]}, ${loc[1]})`).join(',');
        
        // UPDATED: Using 'gis_sabah_vertices' and 'geom' column
        const snapQuery = `
            SELECT 
                p.id as req_id, 
                v.id as node_id, 
                ST_X(v.geom) as lon, 
                ST_Y(v.geom) as lat,
                ST_Distance(v.geom::geography, ST_SetSRID(ST_Point(p.x, p.y), 4326)::geography) as dist
            FROM (VALUES ${valuesList}) AS p(id, x, y)
            CROSS JOIN LATERAL (
                SELECT id, geom FROM gis_sabah_vertices
                ORDER BY geom <-> ST_SetSRID(ST_Point(p.x, p.y), 4326) LIMIT 1
            ) v;
        `;

        const snapResult = await pool.query(snapQuery);
        let nodes = snapResult.rows;

        if (nodes.length < 2) {
            return res.json(null);
        }

        // 2. SOLVE TSP (In JavaScript) - "Nearest Neighbor" Algorithm
        // Start at the first point (User's current location or first click /enhanced :user input)
        let orderedNodes = [nodes[0]]; 
        let unvisited = nodes.slice(1); // Everyone else

        while (unvisited.length > 0) {
            const lastNode = orderedNodes[orderedNodes.length - 1];
            let nearestIndex = -1;
            let minDist = Infinity;

            // Find the closest unvisited point to the last node
            for (let i = 0; i < unvisited.length; i++) {
                const candidate = unvisited[i];
                // Simple Pythagorean distance (good enough for short range optimization)
                const d = Math.sqrt(Math.pow(candidate.lon - lastNode.lon, 2) + Math.pow(candidate.lat - lastNode.lat, 2));
                
                if (d < minDist) {
                    minDist = d;
                    nearestIndex = i;
                }
            }

            // Add nearest to order and remove from unvisited
            orderedNodes.push(unvisited[nearestIndex]);
            unvisited.splice(nearestIndex, 1);
        }

        console.log(" JS Optimization Order:", orderedNodes.map(n => n.req_id));

        // 3. CALCULATE ROUTE LEGS (Dijkstra)
        let routeGeoms = [];
        let orderedStops = [];

        for (let i = 0; i < orderedNodes.length; i++) {
            const nodeInfo = orderedNodes[i];
            
            orderedStops.push({
                seq: i + 1,
                lon: nodeInfo.lon,
                lat: nodeInfo.lat
            });

            if (i < orderedNodes.length - 1) {
                const nextNodeInfo = orderedNodes[i+1];

                // UPDATED: Using 'gis_sabah_road_pgr_final' and 'gid'
                const legQuery = `
                    SELECT ST_AsGeoJSON(ST_Collect(geom)) as geom
                    FROM pgr_dijkstra(
                        'SELECT gid::integer as id, source::integer, target::integer, cost, reverse_co FROM gis_sabah_road_pgr_final',
                        ${nodeInfo.node_id}, 
                        ${nextNodeInfo.node_id}, 
                        false
                    ) d
                    JOIN gis_sabah_road_pgr_final w ON d.edge = w.gid;
                `;
                
                const legResult = await pool.query(legQuery);
                
                if (legResult.rows.length > 0 && legResult.rows[0].geom) {
                    routeGeoms.push(JSON.parse(legResult.rows[0].geom));
                }
            }
        }

        if (routeGeoms.length === 0) {
            return res.json({ route_geometry: null, stops: orderedStops });
        }

        // 4. MERGE RESULTS
        const collectionJson = JSON.stringify({
            type: "GeometryCollection",
            geometries: routeGeoms
        });
        
        const finalResult = await pool.query(
            `SELECT ST_AsGeoJSON(ST_CollectionExtract(ST_GeomFromGeoJSON($1), 2)) as route_geometry`, 
            [collectionJson]
        );

        res.json({
            route_geometry: JSON.parse(finalResult.rows[0].route_geometry),
            stops: orderedStops
        });

    } catch (err) {
        console.error("SERVER ERROR:", err);
        res.status(500).send("Optimization Error");
    }
});

// =========================================================================
// FEATURE 5: STANDARD ROUTING HELPER (A to B) SNAPPING BY COORDS
// =========================================================================
async function getRouteFromCoords(lon1, lat1, lon2, lat2) {
    // UPDATED: Table names and column 'gid'
    const sqlQuery = `
        WITH route AS (
            SELECT *
            FROM pgr_dijkstra(
                'SELECT gid::integer AS id, source::integer, target::integer, cost, reverse_co 
                 FROM gis_sabah_road_pgr_final 
                 WHERE source IS NOT NULL AND target IS NOT NULL AND cost IS NOT NULL'::text,
                (SELECT id::integer FROM gis_sabah_vertices ORDER BY geom <-> ST_SetSRID(ST_Point($1, $2), 4326) LIMIT 1),
                (SELECT id::integer FROM gis_sabah_vertices ORDER BY geom <-> ST_SetSRID(ST_Point($3, $4), 4326) LIMIT 1),
                false
            )
        ),
        route_geom AS (
            SELECT ST_AsGeoJSON(ST_Collect(w.geom)) AS geom
            FROM route AS di
            JOIN gis_sabah_road_pgr_final AS w ON di.edge = w.gid
        ),
        route_steps AS (
            SELECT json_agg(steps.* ORDER BY steps.step) AS steps
            FROM (
                SELECT di.seq AS step, 
                       -- Assuming road_name exists, if not change to 'Unnamed Road' or specific column
                       COALESCE(w.road_name, 'Unnamed Road') AS road_name, 
                       ROUND(w.cost::numeric, 1) AS length_meters
                FROM route AS di
                JOIN gis_sabah_road_pgr_final AS w ON di.edge = w.gid
                WHERE di.edge > 0 
            ) AS steps
        )
        SELECT json_build_object('route_geometry', (SELECT geom FROM route_geom), 'steps', (SELECT steps FROM route_steps)) AS route_data;
    `;
    const values = [lon1, lat1, lon2, lat2];
    try {
        const result = await pool.query(sqlQuery, values);
        if (result.rows.length === 0 || !result.rows[0].route_data) return null; 
        return result.rows[0].route_data; 
    } catch (err) {
        console.error("Error in getRouteFromCoords:", err);
        throw err;
    }
}

// === ROUTE BY NAME ===
app.get('/route-by-name', async (req, res) => {
    try {
        const { start_name, end_name } = req.query;
        // UPDATED: Table name
        const geocodeQuery = `SELECT ST_X(ST_StartPoint(geom)) as lon, ST_Y(ST_StartPoint(geom)) as lat FROM gis_sabah_road_pgr_final WHERE road_name ILIKE $1 LIMIT 1`;

        const startResult = await pool.query(geocodeQuery, [`%${start_name}%`]);
        if (startResult.rows.length === 0) return res.status(404).send(`Start not found`);
        
        const endResult = await pool.query(geocodeQuery, [`%${end_name}%`]);
        if (endResult.rows.length === 0) return res.status(404).send(`End not found`);

        const routeData = await getRouteFromCoords(startResult.rows[0].lon, startResult.rows[0].lat, endResult.rows[0].lon, endResult.rows[0].lat);
        if (routeData) res.json(routeData);
        else res.json(null);

    } catch (err) {
        console.error(err);
        res.status(500).send('Error calculating route by name');
    }
});

// === ROUTE BY CLICK ===
app.get('/route', async (req, res) => {
    try {
        const { start_lon, start_lat, end_lon, end_lat } = req.query;
        const routeData = await getRouteFromCoords(start_lon, start_lat, end_lon, end_lat);
        if (routeData) res.json(routeData);
        else res.json(null);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error calculating route');
    }
});



// === START SERVER ===
try {
    const httpsOptions = {
        key: fs.readFileSync('key.pem'),
        cert: fs.readFileSync('cert.pem')
    };

    https.createServer(httpsOptions, app).listen(port, () => {
        console.log(` SECURE API LISTENING: https://${SERVER_IP}:${port}`);
    });

} catch (err) {
    console.error("❌ SSL ERROR: Could not find key.pem or cert.pem.");
}