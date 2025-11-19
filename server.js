const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

// === 1. SETUP EXPRESS WEB SERVER ===
const app = express();
const port = 3000;
app.use(cors()); // This lets your OpenLayers app talk to this server

// === 2. SETUP POSTGRESQL CONNECTION ===
// (Edit these details for your LOCAL database)
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres', // <-- EDIT THIS (you database name)
  password: 'mynewpassword',       // <-- EDIT THIS (your database password)
  port: 5432,
});

// === 3. CREATE THE API ENDPOINT ===
// This will run when you call:
// http://localhost:3000/route?start_lon=...&start_lat=...&end_lon=...&end_lat=...
// =========================================================================
app.get('/route-by-name', async (req, res) => {
    try {
        const { start_name, end_name } = req.query;

        // SQL to find the coordinates for a road name
        const geocodeQuery = `
            SELECT 
                ST_X(ST_StartPoint(geom)) as lon, 
                ST_Y(ST_StartPoint(geom)) as lat
            FROM test_roads_final 
            WHERE road_name ILIKE $1 
            LIMIT 1
        `;

        // 1. Geocode the START name
        const startResult = await pool.query(geocodeQuery, [`%${start_name}%`]);
        if (startResult.rows.length === 0) {
            return res.status(404).send(`Start road not found: ${start_name}`);
        }
        const startCoords = startResult.rows[0]; // { lon: 116.xxx, lat: 5.xxx }

        // 2. Geocode the END name
        const endResult = await pool.query(geocodeQuery, [`%${end_name}%`]);
        if (endResult.rows.length === 0) {
            return res.status(404).send(`End road not found: ${end_name}`);
        }
        const endCoords = endResult.rows[0];

        // 3. We have coordinates! Now call our main routing function
        //
        //    THIS IS THE CORRECTED PART:
        //
        const routeGeoJSON = await getRouteFromCoords(
            startCoords.lon, 
            startCoords.lat, 
            endCoords.lon, 
            endCoords.lat
        );

        if (routeGeoJSON) {
            res.json(routeGeoJSON);
        } else {
            console.log('No route found between those road names.');
            res.json(null);
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('Error calculating route by name');
    }
});

// =========================================================================
// HELPER FUNCTION: Returns Geometry AND Steps (Using test_roads_final)
// =========================================================================
async function getRouteFromCoords(lon1, lat1, lon2, lat2) {
    
    const sqlQuery = `
        -- 1. Run the main routing query ONCE
        WITH route AS (
            SELECT *
            FROM pgr_dijkstra(
                'SELECT 
                    id::integer AS id, 
                    source::integer, 
                    target::integer, 
                    cost, 
                    reverse_cost 
                 FROM test_roads_final 
                 WHERE source IS NOT NULL AND target IS NOT NULL AND cost IS NOT NULL'::text,
                
                (SELECT id::integer FROM test_roads_final_vertices_pgr 
                 ORDER BY the_geom <-> ST_SetSRID(ST_Point($1, $2), 4326) 
                 LIMIT 1
                ),
                (SELECT id::integer FROM test_roads_final_vertices_pgr 
                 ORDER BY the_geom <-> ST_SetSRID(ST_Point($3, $4), 4326) 
                 LIMIT 1
                ),
                false
            )
        ),
        
        -- 2. Get the Route Line
        route_geom AS (
            SELECT ST_AsGeoJSON(ST_Collect(w.geom)) AS geom
            FROM route AS di
            JOIN test_roads_final AS w ON di.edge = w.id
        ),

        -- 3. Get the Turn-by-Turn Steps
        route_steps AS (
            SELECT json_agg(steps.* ORDER BY steps.step) AS steps
            FROM (
                SELECT 
                    di.seq AS step, 
                    COALESCE(w.road_name, 'Unnamed Road') AS road_name,
                    ROUND(w.cost::numeric, 1) AS length_meters
                FROM route AS di
                JOIN test_roads_final AS w ON di.edge = w.id
                WHERE di.edge > 0 
            ) AS steps
        )

        -- 4. Combine them
        SELECT json_build_object(
            'route_geometry', (SELECT geom FROM route_geom),
            'steps', (SELECT steps FROM route_steps)
        ) AS route_data;
    `;
    
    const values = [lon1, lat1, lon2, lat2];

    try {
        const result = await pool.query(sqlQuery, values);
        
        // Return the composite object
        if (result.rows.length === 0 || !result.rows[0].route_data) {
            return null; 
        }
        return result.rows[0].route_data; 

    } catch (err) {
        console.error("Error in getRouteFromCoords:", err);
        throw err;
    }
}


// =========================================================================
// API ENDPOINT 1: For click-on-map 
// =========================================================================
app.get('/route', async (req, res) => {
    try {
        const { start_lon, start_lat, end_lon, end_lat } = req.query;
        
        // Call the helper function
        const routeGeoJSON = await getRouteFromCoords(start_lon, start_lat, end_lon, end_lat);

        if (routeGeoJSON) {
            res.json(routeGeoJSON);
        } else {
            console.log('No route found between coordinates.');
            res.json(null);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Error calculating route');
    }
});

// === 4. START THE SERVER ===
app.listen(port, () => {
  console.log(`Routing API listening at http://10.1.4.18:${port}`);
});