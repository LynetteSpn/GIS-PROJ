# RMIS Web Map Prototype 

A prototype web application for road maintenance management and routing in Sabah. This project demonstrates a full-stack GIS architecture designed for internal testing.

## Architecture Overview

* **Frontend:** OpenLayers 8 (HTML/JS hosted on Apache).
* **Backend API:** Node.js & Express (Handles routing logic between Frontend and Database).
* **Map Server:** GeoServer (Serves WMS tiles for visualization and WFS for data queries).
* **Database:** PostgreSQL 18 + PostGIS + pgRouting 4.

---

## Installation & Setup

### 1. Database Setup (The Important Part) 

**Note:** Routing requires a "clean" network topology where lines are explicitly split at every intersection. Raw GIS data often contains "MultiLineStrings" or "Overpasses" (lines crossing without nodes) which break routing engines.

Use a **Hybrid Workflow (SQL + QGIS)** to prepare the routable graph:

#### Step A: Prepare Raw Data (in DBeaver)
First, duplicate the main road table to a working copy. During this process, use PostGIS functions to:
* **Explode MultiLineStrings:** Convert complex collections into simple `LineStrings` (one segment per row).
* **Force 2D:** Flatten the geometry to remove elevation (Z-values) that might prevent connections.

#### Step B: Noding & Cleaning (in QGIS)
Standard database functions cannot easily split lines where they cross without existing nodes (e.g., a T-junction that touches but doesn't connect).
1.  Load the prepared table into **QGIS**.
2.  Use the **Processing Toolbox** (specifically `v.clean` from GRASS or the `Union` overlay tool).
3.  Run the tool to physically **split lines at all intersections**.
4.  Export the "noded" result back to the database as a new table (e.g., `test_roads_final`).

#### Step C: Build Topology (in DBeaver)
Now that the geometry is physically cut and clean:
1.  Add the required pgRouting columns (`source`, `target`, `cost`, `reverse_cost`).
2.  Run **`pgr_createTopology`**. This "glues" the network together by assigning Node IDs to every start and end point.
3.  Calculate the **`cost`** (length in meters) for every segment so the algorithm knows the distance.

> 📖 **References:**
> * [Official pgRouting Topology Documentation](https://docs.pgrouting.org/latest/en/pgRouting-concepts.html#topology)
> * [GIS Stack Exchange (Community Solutions for Geometry)](https://gis.stackexchange.com/)

---

### 2. Routing API (Node.js)

This lightweight middleware receives coordinates from the frontend, executes `pgr_dijkstra` queries on the database, and returns the path as GeoJSON.

1.  Navigate to the `api` folder.
2.  Install dependencies: `npm install`
3.  Update `server.js` with your local database credentials.
4.  Start the server: `node server.js`

### 3. Frontend (Apache)

1.  Host the `index.html`, `js`, and `css` files on a standard Apache server (e.g., XAMPP).
2.  **Configuration:** Ensure `rmis3.js` points to your API's IP address (e.g., `http://localhost:3000` or your LAN IP) so mobile devices can connect.

### 4. GeoServer

1.  Connect GeoServer to your PostGIS database store.
2.  Publish the road layers via **WMS** (for visual display) and **WFS** (for snapping/identifying features).

---

## How to Use the Map (navigate specifically)

### Navigation (Routing)
1.  Click the **"Navigate"** button in the sidebar.
2.  **Select "From Current Location":** Uses GPS to set the start point (requires HTTPS or Localhost).
3.  **Select "Select on Map":** Manually pick a Start and End point.
4.  The system calculates the shortest path using Dijkstra's algorithm and renders a blue route line.

