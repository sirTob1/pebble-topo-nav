# TopoNav 🗺️

**Offline Topographic Map Navigation & Activity Recorder for Pebble Smartwatches**

> [!NOTE]
> **This is a Vibe-Coding project! 🎸✨**
> Built interactively using advanced agentic AI pair-programming to prototype, test, and implement features on-the-fly.

TopoNav brings full topographic map navigation, GPX route guidance, and workout tracking directly to your wrist. Compatible with all Pebble platforms (including Pebble Time 2/`emery` and Pebble Round/`chalk`), it works by companion-stitching live outdoor map tiles (e.g., OpenTopoMap, CyclOSM), rendering colored route paths, and utilizing sensor-fused compass/GPS headings.

![TopoNav Banner](images/appstore_banner.png)

---

## 🌟 Key Features (For Users)

* 🗺️ **Detailed Topographic Maps**: Displays real-world topographic maps (contour lines, hiking paths, water bodies) in Pebble-native 64 colors (`GColor8`). Supports **Fullscreen Map Mode** to hide header/footer and maximize the visible map area.
* 🥾 **GPX Route Guidance**: Upload, name, and store multiple GPX files on your phone. Choose, activate, or deactivate routes directly from a dedicated on-watch menu.
* 📍 **Sensor-Fused Compass Arrow**: A dynamic direction chevron representing your heading.
  * *Stationary (Speed <= 1.0 m/s)*: Aligns in real time using the watch's hardware magnetic compass.
  * *In Motion (Speed > 1.0 m/s)*: Automatically switches to GPS-based direction to filter out wrist-swing jitter.
* ⏺️ **Activity Recording & GPX Export**: Start or stop recording your path by long-pressing the *Select* button on your watch (or using the phone UI). Export your finished workouts as standard `.gpx` files from the companion settings page.
* 👣 **Live Breadcrumb Trail**: Optionally displays your real-time traveled route directly on the map as a distinct colored line, so you can always retrace your steps.
* 🗺️ **Interactive Trip History**: View your recorded walks on an interactive map directly within the settings page on your phone, including total distance, average speed, and elevation data.
* 📊 **Dynamic Stats Dashboard**: Real-time workout metrics:
  * **Navigation Dashboard:** Toggleable dashboard view providing metrics like average speed, trip distance, elevation gain/loss, battery level, duration, altitude, heading, and distance to destination.
  * **Big Navigation View:** Auto-popup full-screen navigation arrow and distance when approaching a turn (< 50m). Can be toggled in settings.
  * **Offline Tracking:** Follow the GPX path visually without needing turn-by-turn prompts if desired. The watch dynamically calculates the grid layout and maximizes font sizes based on up to 4 selected optional data fields alongside the fixed coordinates field.
* 🔊 **Turn-by-Turn & Off-Route Alerts**: Screen indications and distinct directional vibration patterns (e.g. double pulse for left, long pulse for right) notify you when a turn is approaching or when you drift more than 50 meters off-route. Directional vibrations can be optionally disabled in the settings in favor of a uniform alert.
* 🔋 **High Contrast & Battery Indicator**: Optimised high-contrast white header/footer layouts for excellent sunlight legibility, complete with watch battery level percentage.
* 🌐 **Multilingual Support**: Fully translated into both **English** and **German**.

---

## 📸 Screenshots Gallery

| Map View | Stats Dashboard | Off-Route Warning |
| :---: | :---: | :---: |
| ![Map View](images/screenshot_map.png) | ![Stats Dashboard](images/screenshot_dashboard.png) | ![Off-Route Warning](release_assets/screenshot_offroute_200x228.png) |

---

## 🛠️ Technical Architecture (For Developers)

TopoNav uses a split watchapp/phone-companion architecture via **PebbleKit JS**:

```mermaid
graph TD
    subgraph Watch (C)
        main.c[main.c: UI / Rendering / Sensors]
    end
    subgraph Phone (PebbleKit JS)
        index.js[index.js: State Manager & GPS Listener]
        graphics.js[graphics.js: Tile Stitcher & GPX Renderer]
        png.js[png.js: JS PNG Decoder]
        config.html[config.html: Webview Configuration Page]
    end
    
    config.html -- "Upload GPX / Change Settings" --> index.js
    index.js -- "GPS Updates / State" --> graphics.js
    graphics.js -- "Fetches & Decodes Tiles" --> png.js
    graphics.js -- "AppMessage Chunks (3000 Bytes)" --> main.c
    main.c -- "Change Zoom / Change Active Route" --> index.js
```

### Component Breakdown:

1. **Watchapp (`src/c/main.c`)**:
   * Written in C. Renders the map layer, the custom sensor-fused GPath compass chevron, and the dual-column metrics dashboard.
   * Manages packet assembly: Receives raw 30,000-byte framebuffers (`200x150` GColor8 pixels) from the phone in 3,000-byte `AppMessage` chunks.
   * Listens to Pebble's `CompassService` and `BatteryStateService`.
   * Integrates a Custom Menu Window (`SimpleMenuLayer`) for on-watch route swapping.

2. **Phone Companion (`src/pkjs/`)**:
   * **`index.js`**: Orchestrates state synchronization, listens to GPS updates, buffers logs in `localStorage` for crash/app-exit persistence, and feeds metadata (next-turn arrow, remaining distance, elevation stats) to the watch.
   * **`graphics.js`**: Calculates Web Mercator projection bounds, downloads outdoor map tiles (e.g., OpenTopoMap, CyclOSM), renders GPX track segments (grey for walked, vibrant orange `#FF3C00` for upcoming path, 5px width), draws current viewport offsets, and maps color values down to GColor8.
   * **`png.js`**: A lightweight PNG decoder featuring a custom Huffman-Inflate algorithm. PebbleKit JS has no access to Node.js libraries or Canvas, so PNGs are decoded directly in pure JS.
   * **`config.html`**: A clay-based HTML settings page. Features Douglas-Peucker path simplification (reducing GPX sizes before syncing to the watch), route-naming controls, and GPX download options for recorded walks.

---

## 🚀 Building & Running

### Method A: Local SDK Build (Using Docker)
Since the original Pebble SDK relies on Python 2.7, we recommend compiling with Docker.

1. Ensure Docker is running.
2. Build the project using the helper script:
   ```powershell
   ./docker_build.sh
   ```
   *Or execute the Docker run command directly:*
   ```powershell
   docker run --rm -v "${PWD}:/app" rebble/pebble-sdk bash /app/docker_build.sh
   ```
3. The compiled watchapp bundle will be saved to: `build/project.pbw`

### Method B: CloudPebble (Repebble)
1. Compress the project folder (excluding `build` and `.lock-waf*` files) into a `.zip` archive.
2. Go to [cloudpebble.repebble.com](https://cloudpebble.repebble.com/) and upload your zip file.
3. Compile, run, and test directly in the browser emulator.
