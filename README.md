# RMIS - Road Maintenance Information System

RMIS is a comprehensive web-based geospatial platform designed for managing road assets, monitoring defects (potholes), and optimizing maintenance routing. It integrates a high-performance OpenLayers frontend with a robust Node.js and PostGIS backend to deliver real-time insights and decision support.

## Project Structure

### **1. Core Frontend (HTML & Configuration)**
| File | Description |
| :--- | :--- |
| **`index.html`** | **Main Application Entry.** Contains the map container, sidebar UI structure, and loads all script dependencies. |
| **`login.html`** | **Authentication Portal.** Secure user login interface required before accessing the main map system. |
| **`manifest.json`** | **PWA Configuration.** Metadata (name, icons, theme color) allowing the application to be installed as a native-like app on mobile devices. |
| **`sw.js`** | **Service Worker.** Manages caching strategies and offline capabilities for the Progressive Web App (PWA). |

### **2. Map Logic (JavaScript Modules)**
| File | Role | Key Features |
| :--- | :--- | :--- |
| **`rmis.js`** | **Core Engine** | • **Map Initialization:** OpenLayers setup with View and Interaction defaults.<br>• **Layer Management:** Handling WMS (Roads, Assets) and Vector layers.<br>• **Basemap Switcher:** Toggles between Satellite, Hybrid, and OSM.<br>• **Search Engine:** WFS-based search for Roads, IDs, and Assets with autocomplete. |
| **`rmis2.js`** | **Interactions** | • **Popup System:** Interactive "Road Info" tables for Potholes, Bridges, and Culverts.<br>• **Drill-Down Nav:** Logic to navigate from Road -> Asset List -> Asset Details.<br>• **Geolocation:** "Locate Me" tools and coordinate sharing.<br>• **Mouse Events:** Hover effects and coordinate display. |
| **`rmis3.js`** | **Tools & Routing** | • **Routing Engine:** Integration with pgRouting for A-to-B navigation.<br>• **TSP Optimization:** Multi-stop route optimization using Nearest Neighbor logic.<br>• **Job Management:** UI for adding, removing, and reordering maintenance stops.<br>• **Measurement:** Interactive tool to measure road lengths on the map. |
| **`rmis4.js`** | **Analytics Dashboard** | • **Viewport-Driven Stats:** Real-time aggregation of data based on the currently visible map area.<br>• **Interactive Charts:** Visualizes Asset Condition (Doughnut) and Inventory (Bar) using Chart.js.<br>• **Asset Selector:** Switches analysis context between "Bridges & Culverts" and "Road Defects". |

### **3. Backend (Server)**
| File | Description |
| :--- | :--- |
| **`server.js`** | **API & Application Server.**<br>• Connects to the **PostgreSQL/PostGIS** database.<br>• Serves static frontend files (HTML/JS/CSS).<br>• Handles API Endpoints (e.g., `/assets/potholes`, `/route`, `/optimize`).<br>• Acts as a proxy for WFS/WMS requests to GeoServer to avoid CORS issues. |

### **4. Styling (CSS)**
| File | Description |
| :--- | :--- |
| **`stylermis.css`** | **Base Styles.** Defines the core layout, Sidebar, Map controls, Layer Switcher, and Legend styling. |
| **`stylermis2.css`** | **Popup Styles.** Specific styling for the Info Popups, Data Tables, and Asset detail views. |
| **`stylermis3.css`** | **Tool & Dashboard Styles.** Styling for the Routing Panel, Floating Action Buttons (FAB), Optimization UI, and Analytics Dashboard. |

---

## Quick Start Guide

### **Prerequisites**
* Node.js (v14 or higher)
* PostgreSQL with PostGIS extension installed
* GeoServer (for WMS/WFS layers)

### **Installation**
1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/your-username/rmis-project.git](https://github.com/your-username/rmis-project.git)
    cd rmis-project
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Database Configuration:**
    Ensure `server.js` (or your config file) has the correct credentials for your PostgreSQL database:
    ```javascript
    const pool = new Pool({
      user: 'postgres',
      host: 'localhost',
      database: 'rmis_db',
      password: 'your_password',
      port: 5432,
    });
    ```

4.  **Run the Server:**
    ```bash
    node server.js
    ```

5.  **Access the App:**
    Open your browser and navigate to:
    `http://localhost:3005` (or your configured port).

---

## 🛠️ Tech Stack
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla), OpenLayers v7+, Chart.js
* **Backend:** Node.js, Express.js
* **Database:** PostgreSQL, PostGIS
* **Map Services:** GeoServer (WMS/WFS), pgRouting (Navigation)
