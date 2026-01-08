// * ============================================================================
//  * INTELLIGENT ROUTING & ASSET API (BACKEND MIDDLEWARE)
//  * ============================================================================
//  * * DESCRIPTION:
//  * This Node.js/Express server acts as the middleware between the Client 
//  * (OpenLayers Frontend) and the Spatial Database (PostgreSQL/PostGIS).
//  * It handles logic that is  complex for the frontend, such as pathfinding
//  * algorithms, asset queries, and route optimization (TSP).
//  * * CORE TECHNOLOGIES:
//  * - Runtime: Node.js (Express Framework)
//  * - Database: PostgreSQL with PostGIS & pgRouting extensions
//  * - Driver: node-postgres ('pg')
//  * * DATABASE DEPENDENCIES (Tables required):
//  * 1. test_roads_final       -> Main road network (topology enabled).
//  * 2. test_roads_final_vertices_pgr -> Network nodes (intersections).
//  * 3. tbl_bridge             -> Bridge asset inventory.
//  * 4. tbl_culvert            -> Culvert asset inventory.
//  * * API ENDPOINTS REFERENCE:
//  * * 1. GET /assets/critical
//  * - Purpose: Fetches bridges/culverts with 'Poor' condition.
//  * - Params: ?type=bridge OR ?type=culvert
//  * * 2. GET /route/optimize (TSP)
//  * - Purpose: Reorders a list of random stops into an optimized travel path.
//  * - Params: ?locations=[[lon,lat], [lon,lat], ...]
//  * - Algorithm: Nearest Neighbor (JavaScript) + Dijkstra (pgRouting).
//  * * 3. GET /route-by-name
//  * - Purpose: Finds a route using road names (e.g., "Jalan A" to "Jalan B").
//  * - Params: ?start_name=...&end_name=...
//  * - Logic: Geocodes name -> Coordinate -> Snaps to Graph -> Routing.
//  * * 4. GET /route (Standard A-to-B)
//  * - Purpose: Calculates shortest path between two coordinate pairs.
//  * - Params: ?start_lon=...&start_lat=...&end_lon=...&end_lat=...
//  * * ============================================================================
//  */

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

// === 1. SETUP EXPRESS WEB SERVER ===
const app = express();
const port = 3000;
app.use(cors());

// === 2. SETUP POSTGRESQL CONNECTION ===
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres', // Your Database Name
  password: 'mynewpassword', // Your Password
  port: 5432,
});

// =========================================================================
// FEATURE 1: ASSET SCANNER (With Type Filtering)
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
                SELECT tid as id, ST_X(geom) as lon, ST_Y(geom) as lat, 
                       COALESCE(structure_no, 'Unnamed Bridge') as name, 'Bridge' as type, 
                       br_general_condition as condition
                FROM tbl_bridge 
                WHERE br_general_condition ILIKE 'poor' AND geom IS NOT NULL
            `);
        }

        // 2. Query Culverts (If type is 'culvert')
        if (!type || type === 'culvert') {
            queries.push(`
                SELECT tid as id, ST_X(geom) as lon, ST_Y(geom) as lat, 
                       COALESCE(cv_structure_no, 'Unnamed Culvert') as name, 'Culvert' as type, 
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
// FEATURE 2: MULTISTOP ROUTE OPTIMIZATION 
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
        
        const snapQuery = `
            SELECT 
                p.id as req_id, 
                v.id as node_id, 
                ST_X(v.the_geom) as lon, 
                ST_Y(v.the_geom) as lat,
                ST_Distance(v.the_geom::geography, ST_SetSRID(ST_Point(p.x, p.y), 4326)::geography) as dist
            FROM (VALUES ${valuesList}) AS p(id, x, y)
            CROSS JOIN LATERAL (
                SELECT id, the_geom FROM test_roads_final_vertices_pgr
                ORDER BY the_geom <-> ST_SetSRID(ST_Point(p.x, p.y), 4326) LIMIT 1
            ) v;
        `;

        const snapResult = await pool.query(snapQuery);
        let nodes = snapResult.rows;

        if (nodes.length < 2) {
            return res.json(null);
        }

        // 2. SOLVE TSP (In JavaScript) - "Nearest Neighbor" Algorithm
        // Start at the first point (User's current location or first click)
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

                const legQuery = `
                    SELECT ST_AsGeoJSON(ST_Collect(geom)) as geom
                    FROM pgr_dijkstra(
                        'SELECT id::integer, source::integer, target::integer, cost, reverse_cost FROM test_roads_final',
                        ${nodeInfo.node_id}, 
                        ${nextNodeInfo.node_id}, 
                        false
                    ) d
                    JOIN test_roads_final w ON d.edge = w.id;
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
// FEATURE 3: STANDARD ROUTING HELPER (A to B) SNAPPING BY COORDS
// =========================================================================
async function getRouteFromCoords(lon1, lat1, lon2, lat2) {
    const sqlQuery = `
        WITH route AS (
            SELECT *
            FROM pgr_dijkstra(
                'SELECT id::integer AS id, source::integer, target::integer, cost, reverse_cost 
                 FROM test_roads_final 
                 WHERE source IS NOT NULL AND target IS NOT NULL AND cost IS NOT NULL'::text,
                (SELECT id::integer FROM test_roads_final_vertices_pgr ORDER BY the_geom <-> ST_SetSRID(ST_Point($1, $2), 4326) LIMIT 1),
                (SELECT id::integer FROM test_roads_final_vertices_pgr ORDER BY the_geom <-> ST_SetSRID(ST_Point($3, $4), 4326) LIMIT 1),
                false
            )
        ),
        route_geom AS (
            SELECT ST_AsGeoJSON(ST_Collect(w.geom)) AS geom
            FROM route AS di
            JOIN test_roads_final AS w ON di.edge = w.id
        ),
        route_steps AS (
            SELECT json_agg(steps.* ORDER BY steps.step) AS steps
            FROM (
                SELECT di.seq AS step, COALESCE(w.road_name, 'Unnamed Road') AS road_name, ROUND(w.cost::numeric, 1) AS length_meters
                FROM route AS di
                JOIN test_roads_final AS w ON di.edge = w.id
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
        const geocodeQuery = `SELECT ST_X(ST_StartPoint(geom)) as lon, ST_Y(ST_StartPoint(geom)) as lat FROM test_roads_final WHERE road_name ILIKE $1 LIMIT 1`;

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
app.listen(port, () => {
  console.log(`Routing API listening at https://10.1.4.18:${port}`);
});