# Changelog

## [Unreleased]

### Added
- **Settings:** Added a toggle option to disable directional vibrations (different vibration patterns for left/right turns) and use a uniform vibration instead (US-14).

## [2.8.0] - 2026-08-05

### Changed
- **UI & Navigation Updates (by @patrickvbe):** 
  - **Dashboard & Layout Polish:** Introduced dynamic font scaling in the dashboard based on the number of items. Improved readability for battery and zoom fields, refined the distance formatting, and made the track recording indicator more distinct (open circle when not recording).
  - **Navigation Feedback:** The directional text in the footer now includes the exact distance. The big pop-up arrow behavior has been synced with the turn vibration to prevent overlapping alerts, and its on-map color and size have been tweaked for better contrast.

### Fixed
- **GPS Precision (by @patrickvbe):** Fixed the nearest point and section detection logic. This eliminates false "off-track" warnings and correctly calculates traveled vs. remaining distances on very long track sections.
- **Battery Optimizations (by @patrickvbe):** The app now strictly obeys the configured `gpsInterval` setting to skip overly frequent GPS polling, preserving both watch and phone battery life.
- **Map Sources Rendering White (by @ChrisBoomhower):** Fixed two map sources that displayed a blank white background instead of tiles.
  - **HikeBikeMap → CyclOSM:** The HikeBikeMap tile server (`tiles.wmflabs.org`) was decommissioned by the Wikimedia Foundation and no longer resolves, so the source never returned tiles. Replaced it with **CyclOSM** (`tile-cyclosm.openstreetmap.fr`), a live, free, HTTPS outdoor/hiking-and-cycling basemap with global coverage, and renamed the settings dropdown option accordingly (English & German). Previously-saved `hikebikemap` selections are transparently aliased to CyclOSM so existing users are not reset.
  - **MtbMap over HTTPS:** The MtbMap URL used cleartext `http://`, which is blocked by mobile WebViews / PebbleKit JS (iOS ATS, Android cleartext restrictions). Switched to `https://` (the server already supports it). Note: MtbMap's tile coverage is Europe-only, so it will still render blank in regions without data (e.g. North America) — this is a data-coverage limitation of the source, not a bug.
- Applied the same fixes to the Leaflet map preview in the settings page (`getLeafletTileUrl`) so the in-settings preview matches what the watch renders.

## [2.7.0] - 2026-07-12

### Fixed
- **Pebble Round Layout Support:** Adapted the watch app's UI layout (Header, Footer, Dashboard) to properly fit the round display (Chalk platform) without cutting off text elements or navigation arrows.
- **Dashboard Fields Visibility & Layout (US-11):** Fixed an issue where the Battery and Distance to Destination fields were invisible due to 8-bit truncation. Improved the grid layout to perfectly center the 3rd item when exactly 3 fields are active, and optimized line breaks for Elevation Gain/Loss fields.
- **Settings Page Routes Rendering:** Fixed an issue where the saved routes would not be visible in the Settings Page after a long GPX track was imported. The URL parameters passed to the Settings Page were sometimes getting truncated by the Pebble app due to massive track points in the latest recorded trips. The route parameter has been moved earlier in the URL payload to guarantee delivery.

## [2.6.0] - 2026-07-11

### Added
- **Navigation View Modes (Auto-Popup & Permanent Arrow):** Replaced the simple "Auto-Popup Navigation" setting with a 3-way dropdown for "Navigation View". Users can now choose to see the map, enable an auto-popup full-screen navigation view that shows a large arrow and distance when approaching a turn (< 50m), or permanently display the large arrow (Arrow Only) for quick reading and battery savings.
- **Directional Vibration Patterns:** Added distinct vibration patterns for turns. A left turn triggers a double pulse, while a right turn triggers a single long pulse. Off-route alerts now trigger 3 rapid pulses.
- **Fully Dynamic Dashboard & New Metrics:** Completely overhauled the dashboard grid architecture. Users can now select up to 4 optional fields from 10 different metrics (Speed, Average Speed, Distance, Elevation Gain/Loss, Duration, Altitude, Battery, Compass Heading, Distance to Destination) to display alongside fixed coordinates. The watch automatically adjusts grid layout and maximizes font sizes.

### Fixed
- **Navigation Menu Logic & Dashboard UI:** Fixed click handler logic so that pressing Select while the permanent "Arrow Only" mode is active correctly overlays the Dashboard, and pressing it again cycles to the Routes menu. Resolved overlapping issues and font scaling on the dashboard so characters and units scale alongside numeric metrics properly.

## [2.5.0] - 2026-06-14

### Added
- **Copy GPX to Clipboard Workaround**: Added a "Copy" / "Kopieren" button to the recorded trips list in settings. Since embedded mobile WebViews (especially on iOS) often restrict downloading files or opening local data/Blob URIs, users can now copy the raw GPX XML string directly to their clipboard and paste it into a file as a workaround.

### Changed
- **Capped Zoom Level**: Capped the maximum zoom level to 17 (previously 18) across the watchapp C code and the Leaflet settings map view of recorded routes, to prevent map rendering issues at extreme zoom levels.

## [2.4.0] - 2026-06-14

### Changed
- **Inline Recorded Trips Mapping and GPX Downloads**: Redesigned the "View" map modal and GPX file downloads to execute locally and inline within the settings WebView. This eliminates the legacy behavior of closing and reopening the settings WebView, completely preventing transition crashes and settings page collapse.
- **Embedded Route Compression**: Companion app now compresses coordinates for the latest 8 trips using a custom Base36 delta-compression scheme and embeds them inside the initial settings URL payload, keeping URL length well within Pebble limits.

## [2.3.0] - 2026-06-14

### Added
- **Real-Time Traveled Route Overlay (Breadcrumbs)**: Added real-time rendering of the user's traveled path (breadcrumb trail) on the watch map in a distinct Cobalt Blue color (3px thickness). Draw rendering takes place underneath the planned route line to preserve upcoming path legibility.
- **Show Traveled Route Settings Toggle**: Introduced a new settings toggle under the "Allgemein" section of the configuration page to show/hide the breadcrumb overlay dynamically. Includes full German/English localizations.
- **Graphics Rendering Optimizations**: Integrated a decimation filter to cap maximum drawn path points to 500 and a 50px viewport bounding box padding/clipping filter to keep map panning and zooming smooth.

### Fixed
- **Settings Page Closing on Action triggers**: Added a 350ms delay to all WebView re-open commands (viewing, deleting, downloading, and toggling recording) to allow the mobile OS to finish tearing down the closed WebView before requesting a new one. This prevents the settings screen from closing completely and returning the user to the app overview.

## [2.1.0] - 2026-06-14

### Added
- **Interactive Map View for Recorded Trips**: Added a "View" button to the recorded trips list in Settings, allowing users to view completed walks on an interactive Leaflet map overlay using their active map source style. Displays total distance, walking duration, calculated average speed, and elevation gain/loss.

## [2.0.0] - 2026-06-08

### Added
- **Fullscreen Map Mode**: Added a new settings configuration toggle to enable fullscreen map view. Hides header and footer overlays on the watch to maximize visible map area, dynamically adjusting layers and centering the compass chevron on the expanded viewport.

## [1.9.0] - 2026-06-07

### Removed
- **GPX File Selector**: Removed the unreliable file selection input and dropzone from the settings page. Copy-pasting the raw GPX XML content is now the sole route input method.

## [1.8.0] - 2026-06-07

### Fixed
- **Watch Route Load Failure**: Fixed a bug where activated routes from the watch menu failed to load ("No GPX route loaded" displayed on screen). This was caused by 64-bit JS timestamps (`Date.now()`) overflowing Pebble's 32-bit integer data types during transmission. Resolves the issue by performing bitwise 32-bit integer matching for route IDs on the companion side.

## [1.7.0] - 2026-06-07

### Fixed
- **Accidental Route Overwrite Prevention**: Selecting an inactive route now prompts the user with a confirmation window ("Start navigation?") or switch warning ("Switch route? Saves current trip.") instead of activating immediately. This prevents active workout recordings from being silently discarded.

## [1.6.0] - 2026-06-07

### Added
- **On-Watch Route Activation Confirmation**: Selecting an inactive route from the watch route menu now prompts the user with a confirmation window ("Start navigation?" / "Navi starten?") to prevent accidental starts.
- **Route Switch Safety Confirmation**: If a route navigation is already active and the user selects a different route, the watch displays a warning window ("Switch route? Saves current trip." / "Route wechseln? Speichert aktuelle.") to prevent overriding active tracks accidentally.
- **On-Watch Stop Confirmation Window**: Re-selecting the active route in the watch menu displays a confirmation dialog asking the user whether to stop navigation ("Stop navigation?" / "Navi stoppen?").
- **Auto-Save Walked Track on Stop/Switch**: Confirming the stop or switch deactivates the current route, stops recording, and automatically saves the walked track/trip to the phone's trips history before activating the new route.
- **Vibration Feedback**: Triggers vibes_short_pulse on start/switch and vibes_double_pulse on stop.
- **Menu Stack Popping on Confirm**: Automatically removes the route menu from the stack when confirming, returning the user directly to the main map screen.

## [1.5.0] - 2026-06-07

### Added
- **Dynamic Multilingual Support**: Live English/German translations across both PebbleKit JS companion app and watchapp (coordinates titles, dashboard fields, navigation text).
- **Dashboard Enhancements**: Dual-column responsive layout showing average speed, walked/remaining distance, and elevation profile in large bold fonts.
- **Sensor-Fused Direction Arrow**: Dynamic central compass arrow that aligns using the hardware magnetic compass when stationary and switches to GPS direction when in motion.
- **Offline GPX Downloads**: Settings page allows downloading walks recorded on the watch as valid `.gpx` files.
- **Douglas-Peucker Simplification**: Optimizes GPX paths in settings page to fit within watch memory limits.
- **Battery Status**: Live battery level percentage displayed in the top-right header.

### Fixed
- **App Launch Crashes**: Fixed battery-state and early AppMessage null-pointer crashes.

## [1.4.0] - 2026-06-07

### Fixed
- **GPS Connection Issues**: Encapsulates geolocation watchPosition in robust try-catch block and configures options (enabling high accuracy, 10s timeout, 10s maximum age) to prevent timeout failures.
- **LocalStorage robustness**: Wrapped JSON.parse for routes and trips in try-catch blocks to prevent startup crashes when storage gets corrupted.

## [1.3.0] - 2026-06-07

### Added
- **Free Map Source Selection**: Settings page now offers selection of free map sources without API keys (OpenTopoMap, HikeBikeMap, MtbMap, OpenStreetMap).
- **Persistent Dropdown Selection**: Settings page preserves the selected map source and interval after closing and returning.
