var LatLon = require('geodesy/latlon-spherical.js');
var png = require('./png');
var graphics = require('./graphics');
var MAP_WIDTH = 200;
var MAP_HEIGHT = 150;

// State Variables
var CHUNK_SIZE = 3000;
var gpsInterval = 5;
var gpxTrack = [];
var currentLocation = null;
var currentLL = null;
var currentZoom = 17;
var isSendingMap = false;
var gpsWatchId = null;
var platform = "basalt";

function updateMapDimensions() {
  var isFullscreen = localStorage.getItem('fullscreen') === 'true';
  if (platform === "emery") {
    MAP_WIDTH = 200;
    MAP_HEIGHT = isFullscreen ? 228 : 150;
  } else if (platform === "chalk") {
    MAP_WIDTH = 180;
    MAP_HEIGHT = isFullscreen ? 180 : 114;
  } else { // basalt, aplite
    MAP_WIDTH = 144;
    MAP_HEIGHT = isFullscreen ? 168 : 112;
  }
  graphics.setDimensions(MAP_WIDTH, MAP_HEIGHT);
  console.log("Updated map dimensions to: " + MAP_WIDTH + "x" + MAP_HEIGHT + " (Fullscreen: " + isFullscreen + ")");
}

// Navigation & Recording State
var isNavigating = false;
var recordedTrack = [];
var currentSpeed = 0;
var currentHeading = -1;

// Haptic feedback states
var lastVibratedTurnIdx = -1;
var hasVibratedOffRoute = false;
var significantTurns = [];

function precalculateTurns() {
  significantTurns = [];
  if (!gpxTrack || gpxTrack.length < 2) return;
  
  var baseIdx = 0;
  var baseBearing = getBearing(gpxTrack[0].lat, gpxTrack[0].lon, gpxTrack[1].lat, gpxTrack[1].lon);
  
  for (var i = 1; i < gpxTrack.length - 1; i++) {
    var nextBearing = getBearing(gpxTrack[i].lat, gpxTrack[i].lon, gpxTrack[i+1].lat, gpxTrack[i+1].lon);
    var diff = (nextBearing - baseBearing + 180) % 360 - 180;
    
    if (Math.abs(diff) > 45) {
      significantTurns.push({
        idx: i,
        bearingDiff: diff
      });
      baseBearing = nextBearing;
      baseIdx = i;
    } else {
      var distFromBase = haversineDistance(gpxTrack[baseIdx].lat, gpxTrack[baseIdx].lon, gpxTrack[i].lat, gpxTrack[i].lon);
      if (distFromBase > 100 && Math.abs(diff) < 20) {
         baseBearing = nextBearing;
         baseIdx = i;
      }
    }
  }
  console.log("Precalculated " + significantTurns.length + " significant turns.");
}

// Average speed & walked route state
var totalMovingDistance = 0;
var totalMovingTimeSec = 0;
var lastPositionTime = null;
var lastPositionCoords = null;
var closestTrackPointIdx = -1;

// Utility: Convert ArrayBuffer to Base64 string
function arrayBufferToBase64(buffer) {
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Utility: Convert Base64 string to Uint8Array
function base64ToUint8Array(base64) {
  var binaryString = atob(base64);
  var len = binaryString.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Haversine formula to compute distance in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  var R = 6371000; // Radius of the Earth in meters
  var dLat = ((lat2 - lat1) * Math.PI) / 180;
  var dLon = ((lon2 - lon1) * Math.PI) / 180;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate bearing between two points (0 to 360)
function getBearing(lat1, lon1, lat2, lon2) {
  var dLon = ((lon2 - lon1) * Math.PI) / 180;
  var lat1Rad = (lat1 * Math.PI) / 180;
  var lat2Rad = (lat2 * Math.PI) / 180;
  var y = Math.sin(dLon) * Math.cos(lat2Rad);
  var x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  var brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

// Get tile URL based on chosen map source
function getTileUrl(z, x, y) {
  var mapSource = localStorage.getItem('mapSource') || 'opentopomap';
  var subdomains, sub;
  
  // 'hikebikemap' kept as a legacy alias: the old tiles.wmflabs.org server was
  // decommissioned by Wikimedia, so previously-saved settings now resolve to CyclOSM.
  if (mapSource === 'cyclosm' || mapSource === 'hikebikemap') {
    subdomains = ['a', 'b', 'c'];
    sub = subdomains[Math.floor(Math.random() * 3)];
    return 'https://' + sub + '.tile-cyclosm.openstreetmap.fr/cyclosm/' + z + '/' + x + '/' + y + '.png';
  } else if (mapSource === 'mtbmap') {
    return 'https://tile.mtbmap.cz/mtbmap_tiles/' + z + '/' + x + '/' + y + '.png';
  } else if (mapSource === 'osm') {
    subdomains = ['a', 'b', 'c'];
    sub = subdomains[Math.floor(Math.random() * 3)];
    return 'https://' + sub + '.tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';
  } else { // opentopomap
    subdomains = ['a', 'b', 'c'];
    sub = subdomains[Math.floor(Math.random() * 3)];
    return 'https://' + sub + '.tile.opentopomap.org/' + z + '/' + x + '/' + y + '.png';
  }
}

// Initialize the Pebble application
Pebble.addEventListener('ready', function() {
  if (typeof Pebble !== 'undefined' && Pebble.getActiveWatchInfo) {
    try {
      var info = Pebble.getActiveWatchInfo();
      platform = info.platform || "basalt";
    } catch(e) {
      console.log("Error getting watch info: " + e);
    }
  }
  graphics.initMapDimensions(platform);
  
  // Load settings from LocalStorage
  var storedInterval = localStorage.getItem('gpsInterval');
  if (storedInterval) gpsInterval = parseInt(storedInterval);
  
  // Update map dimensions based on loaded settings
  updateMapDimensions();
  if (storedInterval) gpsInterval = parseInt(storedInterval);
  
  var storedTrack = localStorage.getItem('gpxTrack');
  if (storedTrack) {
    try {
      gpxTrack = JSON.parse(storedTrack);
      precalculateTurns();
      console.log('Loaded GPX track from storage: ' + gpxTrack.length + ' points.');
    } catch (e) {
      gpxTrack = [];
    }
  }

  // Load walked stats from LocalStorage to allow seamless resumption
  var storedMovingDist = localStorage.getItem('totalMovingDistance');
  if (storedMovingDist) totalMovingDistance = parseFloat(storedMovingDist);
  
  var storedMovingTime = localStorage.getItem('totalMovingTimeSec');
  if (storedMovingTime) totalMovingTimeSec = parseFloat(storedMovingTime);
  
  var storedClosestIdx = localStorage.getItem('closestTrackPointIdx');
  if (storedClosestIdx) closestTrackPointIdx = parseInt(storedClosestIdx);

  isNavigating = localStorage.getItem('isNavigating') === 'true';
  var storedRecordedTrack = localStorage.getItem('recordedTrack');
  if (storedRecordedTrack) {
    try {
      recordedTrack = JSON.parse(storedRecordedTrack);
      console.log('Loaded recorded track: ' + recordedTrack.length + ' points.');
    } catch (e) {
      recordedTrack = [];
    }
  }

  // Load active route points if set
  var activeRouteIdStr = localStorage.getItem('activeRouteId');
  if (activeRouteIdStr) {
    var activeId = parseInt(activeRouteIdStr, 10);
    var savedRoutes = [];
    try {
      savedRoutes = JSON.parse(localStorage.getItem('savedRoutes') || '[]');
    } catch (e) {
      savedRoutes = [];
    }
    if (savedRoutes && Array.isArray(savedRoutes)) {
      var activeRoute = savedRoutes.filter(function(r) { return (r.id & 0xFFFFFFFF) === (activeId & 0xFFFFFFFF); })[0];
      if (activeRoute) {
        gpxTrack = activeRoute.points || [];
        precalculateTurns();
        console.log('Loaded active route: ' + activeRoute.name + ' (' + gpxTrack.length + ' points).');
      } else {
        gpxTrack = [];
      }
    } else {
      gpxTrack = [];
    }
  } else {
    // Legacy fallback
    var storedTrackFallback = localStorage.getItem('gpxTrack');
    if (storedTrackFallback) {
      try {
        gpxTrack = JSON.parse(storedTrackFallback);
        precalculateTurns();
        console.log('Loaded legacy GPX track: ' + gpxTrack.length + ' points.');
      } catch (e) {
        gpxTrack = [];
      }
    }
  }

  // Start GPS tracking
  restartGPSTracking();

  // Sync routes to watch on startup
  setTimeout(syncRoutesToWatch, 1000);
});

// Helper to open the configuration url with all required parameters
function openConfigPage() {
  var interval = localStorage.getItem('gpsInterval') || '5';
  var lang = localStorage.getItem('language') || 'de';
  var mapSource = localStorage.getItem('mapSource') || 'opentopomap';
  var fullscreen = localStorage.getItem('fullscreen') || 'false';
  var showBreadcrumbs = localStorage.getItem('showBreadcrumbs') !== 'false';
  var turnVibration = localStorage.getItem('turnVibration') || (localStorage.getItem('directionalVibrations') !== 'false' ? 'directional' : '1_short');
  var savedTrips = JSON.parse(localStorage.getItem('savedTrips') || '[]');
  
  // Keep only the latest 3 trips for the settings page to prevent URL overflow
  var recentTrips = savedTrips.slice(-3);
  
  var tripsMeta = recentTrips.map(function(t) {
    return {
      id: t.id,
      date: t.date,
      distance: t.distance,
      duration: t.duration,
      pointsCount: t.points ? t.points.length : 0,
      pointsStr: compressPointsCompact(t.points)
    };
  });

  // Serialize saved routes list metadata
  var savedRoutes = JSON.parse(localStorage.getItem('savedRoutes') || '[]');
  var routesMeta = savedRoutes.map(function(r) {
    var dist = 0;
    if (r.points) {
      for (var k = 0; k < r.points.length - 1; k++) {
        dist += haversineDistance(r.points[k].lat, r.points[k].lon, r.points[k+1].lat, r.points[k+1].lon);
      }
    }
    return {
      id: r.id,
      name: r.name,
      distance: dist,
      pointsCount: r.points ? r.points.length : 0
    };
  });
  
  var url = 'https://sirtob1.github.io/pebble-topo-nav/src/pkjs/config.html?v=' + Date.now() + 
            '&interval=' + interval + 
            '&lang=' + lang + 
            '&map=' + mapSource + 
            '&fullscreen=' + fullscreen + 
            '&show_breadcrumbs=' + showBreadcrumbs + 
            '&turn_vibration=' + turnVibration +
            '&nav_view_mode=' + (localStorage.getItem('navViewMode') || '0') +
            '&dashboard_fields=' + (localStorage.getItem('dashboardFields') || '15') + 
            '&is_nav=' + (isNavigating ? 'true' : 'false') + 
            '&routes=' + encodeURIComponent(JSON.stringify(routesMeta)) +
            '&active_route_id=' + (localStorage.getItem('activeRouteId') || '0') +
            '&trips=' + encodeURIComponent(JSON.stringify(tripsMeta));
            
  console.log('Opening config page with url: ' + url.substring(0, 150) + '... Length: ' + url.length);
  Pebble.openURL(url);
}

// Sync routes list to watch
function syncRoutesToWatch() {
  var savedRoutes = [];
  try {
    savedRoutes = JSON.parse(localStorage.getItem('savedRoutes') || '[]');
  } catch (e) {
    savedRoutes = [];
  }
  var activeRouteId = parseInt(localStorage.getItem('activeRouteId') || '0', 10);
  
  if (!savedRoutes || !Array.isArray(savedRoutes)) {
    savedRoutes = [];
  }
  
  console.log('Syncing ' + savedRoutes.length + ' routes to watch. Active ID: ' + activeRouteId);
  
  Pebble.sendAppMessage({
    ACTIVE_ROUTE_ID: activeRouteId
  }, function() {
    Pebble.sendAppMessage({
      ROUTE_COUNT: savedRoutes.length
    }, function() {
      var idx = 0;
      function sendNext() {
        if (idx >= savedRoutes.length || idx >= 15) {
          console.log('Route list fully synced to watch.');
          return;
        }
        var route = savedRoutes[idx];
        Pebble.sendAppMessage({
          ROUTE_INDEX: idx,
          ROUTE_ID: route.id,
          ROUTE_NAME: route.name.substring(0, 31)
        }, function() {
          idx++;
          setTimeout(sendNext, 100);
        }, function(err) {
          console.warn('Failed to sync route index ' + idx + ', retrying...');
          setTimeout(sendNext, 250);
        });
      }
      if (savedRoutes.length > 0) {
        sendNext();
      }
    });
  });
}

function activateSavedRoute(routeId) {
  var savedRoutes = [];
  try {
    savedRoutes = JSON.parse(localStorage.getItem('savedRoutes') || '[]');
  } catch (e) {
    savedRoutes = [];
  }
  var foundRoute = null;
  if (savedRoutes && Array.isArray(savedRoutes)) {
    foundRoute = savedRoutes.filter(function(r) { return (r.id & 0xFFFFFFFF) === (routeId & 0xFFFFFFFF); })[0];
  }
  
  if (foundRoute) {
    if (isNavigating) {
      stopRecording(true);
    }

    localStorage.setItem('activeRouteId', routeId.toString());
    gpxTrack = foundRoute.points || [];
    precalculateTurns();
    localStorage.setItem('gpxTrack', JSON.stringify(gpxTrack));
    console.log('Activated route: ' + foundRoute.name);
    
    // Reset navigation stats for the new route
    totalMovingDistance = 0;
    totalMovingTimeSec = 0;
    localStorage.removeItem('totalMovingDistance');
    localStorage.removeItem('totalMovingTimeSec');
    closestTrackPointIdx = -1;
    localStorage.removeItem('closestTrackPointIdx');
    lastPositionTime = null;
    lastPositionCoords = null;
    lastVibratedTurnIdx = -1;
    hasVibratedOffRoute = false;
    
    if (gpxTrack.length > 0) {
      cacheTrackTiles(gpxTrack);
    }
    
    startRecording();
  } else if (routeId === 0) {
    localStorage.setItem('activeRouteId', '0');
    gpxTrack = [];
    localStorage.setItem('gpxTrack', JSON.stringify(gpxTrack));
    console.log('Deactivated current route.');
    
    // Reset navigation stats
    totalMovingDistance = 0;
    totalMovingTimeSec = 0;
    localStorage.removeItem('totalMovingDistance');
    localStorage.removeItem('totalMovingTimeSec');
    closestTrackPointIdx = -1;
    localStorage.removeItem('closestTrackPointIdx');
    lastPositionTime = null;
    lastPositionCoords = null;
    lastVibratedTurnIdx = -1;
    hasVibratedOffRoute = false;
    
    if (isNavigating) {
      stopRecording(true);
    }
  }
  
  syncRoutesToWatch();
  updateWatchNavigationAndMap();
}

function deleteSavedRoute(routeId) {
  var savedRoutes = [];
  try {
    savedRoutes = JSON.parse(localStorage.getItem('savedRoutes') || '[]');
  } catch (e) {
    savedRoutes = [];
  }
  var updated = [];
  if (savedRoutes && Array.isArray(savedRoutes)) {
    updated = savedRoutes.filter(function(r) {
      return (r.id & 0xFFFFFFFF) !== (routeId & 0xFFFFFFFF);
    });
  }
  localStorage.setItem('savedRoutes', JSON.stringify(updated));
  console.log('Deleted route ID: ' + routeId);
  
  var activeId = parseInt(localStorage.getItem('activeRouteId') || '0', 10);
  if ((activeId & 0xFFFFFFFF) === (routeId & 0xFFFFFFFF)) {
    activateSavedRoute(0);
  } else {
    syncRoutesToWatch();
  }
}

// Coordinate delta compression for URL transmission
function compressTrack(points) {
  if (!points || points.length === 0) return '';
  var segments = [];
  var lastLat = 0;
  var lastLon = 0;
  var lastEle = 0;
  var lastTime = 0;
  
  for (var i = 0; i < points.length; i++) {
    var p = points[i];
    var latVal = Math.round(p.lat * 1000000);
    var lonVal = Math.round(p.lon * 1000000);
    var eleVal = Math.round(p.ele || 0);
    var timeVal = Math.round(p.time || 0);
    
    if (i === 0) {
      segments.push(latVal + ',' + lonVal + ',' + eleVal + ',' + timeVal);
    } else {
      var dLat = latVal - lastLat;
      var dLon = lonVal - lastLon;
      var dEle = eleVal - lastEle;
      var dTime = timeVal - lastTime;
      segments.push(dLat + ',' + dLon + ',' + dEle + ',' + dTime);
    }
    
    lastLat = latVal;
    lastLon = lonVal;
    lastEle = eleVal;
    lastTime = timeVal;
  }
  return segments.join('|');
}

function decimatePoints(points, maxPoints) {
  if (!points || points.length <= maxPoints) return points;
  var decimated = [];
  var step = Math.ceil((points.length - 1) / (maxPoints - 1));
  for (var i = 0; i < points.length - 1; i += step) {
    decimated.push(points[i]);
  }
  decimated.push(points[points.length - 1]);
  return decimated;
}

function compressPointsCompact(points) {
  if (!points || points.length === 0) return '';
  var maxPts = 50; // Decimate to max 50 points for settings view and download
  var pts = decimatePoints(points, maxPts);
  
  var segments = [];
  var lastLat = 0;
  var lastLon = 0;
  var lastEle = 0;
  var lastTime = 0;
  
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    var latVal = Math.round(p.lat * 100000);
    var lonVal = Math.round(p.lon * 100000);
    var eleVal = Math.round(p.ele || 0);
    var timeVal = Math.round((p.time || 0) / 1000); // Store time in seconds
    
    if (i === 0) {
      segments.push(latVal.toString(36) + ',' + lonVal.toString(36) + ',' + eleVal.toString(36) + ',' + timeVal.toString(36));
    } else {
      var dLat = latVal - lastLat;
      var dLon = lonVal - lastLon;
      var dEle = eleVal - lastEle;
      var dTime = timeVal - lastTime;
      segments.push(dLat.toString(36) + ',' + dLon.toString(36) + ',' + dEle.toString(36) + ',' + dTime.toString(36));
    }
    
    lastLat = latVal;
    lastLon = lonVal;
    lastEle = eleVal;
    lastTime = timeVal;
  }
  return segments.join('|');
}

function deleteSavedTrip(tripId) {
  var savedTrips = JSON.parse(localStorage.getItem('savedTrips') || '[]');
  var updated = savedTrips.filter(function(t) {
    return t.id !== tripId;
  });
  localStorage.setItem('savedTrips', JSON.stringify(updated));
}

function startRecording() {
  isNavigating = true;
  localStorage.setItem('isNavigating', 'true');
  
  recordedTrack = [];
  localStorage.setItem('recordedTrack', JSON.stringify(recordedTrack));
  
  totalMovingDistance = 0;
  totalMovingTimeSec = 0;
  localStorage.setItem('totalMovingDistance', 0);
  localStorage.setItem('totalMovingTimeSec', 0);
  
  closestTrackPointIdx = -1;
  localStorage.setItem('closestTrackPointIdx', -1);
  lastPositionTime = null;
  lastPositionCoords = null;
  
  // Confirm start with short vibe
  Pebble.sendAppMessage({
    RECORDING_STATE: 1,
    VIBRATE_ALERT: 1
  });
  
  updateWatchNavigationAndMap();
}

function stopRecording(save) {
  isNavigating = false;
  localStorage.setItem('isNavigating', 'false');
  
  if (save && recordedTrack.length > 0) {
    var savedTrips = JSON.parse(localStorage.getItem('savedTrips') || '[]');
    var newTrip = {
      id: Date.now(),
      date: new Date().toISOString(),
      distance: totalMovingDistance,
      duration: totalMovingTimeSec,
      points: recordedTrack
    };
    savedTrips.push(newTrip);
    localStorage.setItem('savedTrips', JSON.stringify(savedTrips));
    console.log('Saved new trip with ' + recordedTrack.length + ' points.');
  }
  
  recordedTrack = [];
  localStorage.setItem('recordedTrack', JSON.stringify(recordedTrack));
  
  // Confirm stop with double vibe
  Pebble.sendAppMessage({
    RECORDING_STATE: 0,
    VIBRATE_ALERT: 2
  });
  
  updateWatchNavigationAndMap();
}

function toggleRecordingState() {
  if (isNavigating) {
    stopRecording(true);
  } else {
    startRecording();
  }
}

// Settings config page trigger
Pebble.addEventListener('showConfiguration', function() {
  openConfigPage();
});

// Settings config page closed
Pebble.addEventListener('webviewclosed', function(e) {
  if (e && e.response) {
    try {
      var responseStr = decodeURIComponent(e.response);
      console.log('WebView closed response: ' + responseStr);
      
      if (responseStr === 'toggle_nav') {
        toggleRecordingState();
        setTimeout(function() {
          openConfigPage();
        }, 350);
        return;
      }
      
      if (responseStr.indexOf('delete_') === 0 && responseStr.indexOf('delete_route_') === -1) {
        var deleteId = parseInt(responseStr.substring(7), 10);
        deleteSavedTrip(deleteId);
        setTimeout(function() {
          openConfigPage();
        }, 350);
        return;
      }
      

      
      if (responseStr.indexOf('delete_route_') === 0) {
        var delRouteId = parseInt(responseStr.substring(13), 10);
        deleteSavedRoute(delRouteId);
        setTimeout(function() {
          openConfigPage();
        }, 350);
        return;
      }
      
      if (responseStr.indexOf('activate_route_') === 0) {
        var actRouteId = parseInt(responseStr.substring(15), 10);
        activateSavedRoute(actRouteId);
        setTimeout(function() {
          openConfigPage();
        }, 350);
        return;
      }
      
      var settings = JSON.parse(responseStr);
      console.log('Received settings: ' + JSON.stringify(settings).substring(0, 100) + '...');
      
      gpsInterval = settings.gpsInterval;
      localStorage.setItem('gpsInterval', gpsInterval);
      
      var lang = settings.language || 'de';
      localStorage.setItem('language', lang);
      
      var mapSource = settings.mapSource || 'opentopomap';
      var oldMapSource = localStorage.getItem('mapSource') || 'opentopomap';
      localStorage.setItem('mapSource', mapSource);
      
      var fullscreen = settings.fullscreen || false;
      var oldFullscreen = localStorage.getItem('fullscreen') === 'true';
      localStorage.setItem('fullscreen', fullscreen ? 'true' : 'false');
      
      if (fullscreen !== oldFullscreen) {
        console.log('Fullscreen setting changed from ' + oldFullscreen + ' to ' + fullscreen);
        updateMapDimensions();
      }

      var showBreadcrumbs = settings.showBreadcrumbs !== undefined ? settings.showBreadcrumbs : true;
      var oldShowBreadcrumbs = localStorage.getItem('showBreadcrumbs') !== 'false';
      localStorage.setItem('showBreadcrumbs', showBreadcrumbs ? 'true' : 'false');
      
      var turnVibration = settings.turnVibration !== undefined ? settings.turnVibration : (settings.directionalVibrations !== undefined ? (settings.directionalVibrations ? 'directional' : '1_short') : 'directional');
      localStorage.setItem('turnVibration', turnVibration);
      
      var dashboardFields = settings.dashboardFields !== undefined ? settings.dashboardFields : 15;
      localStorage.setItem('dashboardFields', dashboardFields.toString());

      var navViewMode = settings.navViewMode !== undefined ? settings.navViewMode : 0;
      localStorage.setItem('navViewMode', navViewMode.toString());

      var mapOrientation = settings.mapOrientation !== undefined ? settings.mapOrientation : 0;
      localStorage.setItem('mapOrientation', mapOrientation.toString());

      if (showBreadcrumbs !== oldShowBreadcrumbs) {
        console.log('Show breadcrumbs setting changed from ' + oldShowBreadcrumbs + ' to ' + showBreadcrumbs);
        isSendingMap = false;
      }
      
      if (mapSource !== oldMapSource) {
        console.log('Map source changed from ' + oldMapSource + ' to ' + mapSource + '. Triggering map reload.');
        // Force reload by clearing memory cache first (optional, but good practice since memory cache keys are style-agnostic)
        isSendingMap = false; // Reset map sending locks if any
        // We will call updateWatchNavigationAndMap() later in the handler, but doing it here guarantees immediate response.
      }
      
      if (settings.newRoute) {
        var savedRoutes = JSON.parse(localStorage.getItem('savedRoutes') || '[]');
        var newR = {
          id: Date.now(),
          name: settings.newRoute.name || ('Route ' + (savedRoutes.length + 1)),
          points: settings.newRoute.points
        };
        savedRoutes.push(newR);
        localStorage.setItem('savedRoutes', JSON.stringify(savedRoutes));
        console.log('Added new route: ' + newR.name);
        
        // Auto-activate the newly added route
        activateSavedRoute(newR.id);
      } else {
        // Just sync routes to verify in case config changed
        syncRoutesToWatch();
      }
      
      if (settings.gpxTrack !== undefined) {
        // Legacy upload compatibility (clean up when done)
        gpxTrack = settings.gpxTrack;
        precalculateTurns();
        localStorage.setItem('gpxTrack', JSON.stringify(gpxTrack));
        if (gpxTrack.length > 0) {
          var savedRoutes = JSON.parse(localStorage.getItem('savedRoutes') || '[]');
          var autoId = Date.now();
          var newR = {
            id: autoId,
            name: 'Import ' + new Date().toLocaleDateString(),
            points: gpxTrack
          };
          savedRoutes.push(newR);
          localStorage.setItem('savedRoutes', JSON.stringify(savedRoutes));
          localStorage.setItem('activeRouteId', autoId.toString());
          syncRoutesToWatch();
          cacheTrackTiles(gpxTrack);
        } else {
          activateSavedRoute(0);
        }
      }
      
      // Restart GPS tracking with new interval
      restartGPSTracking();
      
      // Force immediate watch update
      updateWatchNavigationAndMap();
    } catch (err) {
      console.log('Error parsing configuration response: ' + err);
    }
  }
});

// Watch messages listener (Up/Down Zoom, Map requests, Recording control)
Pebble.addEventListener('appmessage', function(e) {
  var dict = e.payload;
  console.log('Received AppMessage from watch: ' + JSON.stringify(dict));
  
  if (dict.ZOOM_LEVEL !== undefined) {
    currentZoom = dict.ZOOM_LEVEL;
  }
  
  if (dict.REQUEST_MAP_UPDATE !== undefined) {
    updateWatchNavigationAndMap();
  }
  
  if (dict.RECORDING_STATE !== undefined) {
    toggleRecordingState();
  }
  
  if (dict.ROUTE_ID !== undefined) {
    activateSavedRoute(dict.ROUTE_ID);
  }
});

// Restart GPS tracking with current interval
function restartGPSTracking() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    console.error('Navigator or Geolocation is not available.');
    onGPSError({ message: 'Geolocation not supported' });
    return;
  }

  if (gpsWatchId !== null) {
    try {
      navigator.geolocation.clearWatch(gpsWatchId);
    } catch (e) {
      console.warn('Error clearing watch: ' + e);
    }
  }
  
  var options = {
    enableHighAccuracy: true,
    maximumAge: 10000, // allow cached location up to 10s old
    timeout: 10000     // larger timeout to avoid immediate cold start failures
  };
  
  try {
    gpsWatchId = navigator.geolocation.watchPosition(
      onGPSSuccess,
      onGPSError,
      options
    );
    console.log('GPS tracking started with interval: ' + gpsInterval + 's');
  } catch (err) {
    console.error('Error starting watchPosition: ' + err);
    onGPSError({ message: err.message || 'Permission/Initialization error' });
  }
}

function onGPSSuccess(position) {
  var now = Date.now();
  var timediff = 0.0;
  if ( lastPositionTime ) {
    timediff = (now - lastPositionTime) / 1000;
    if ( timediff < gpsInterval ) {
      return;
    }
  }
  lastPositionTime = now;

  var lat = position.coords.latitude;
  var lon = position.coords.longitude;
  
  currentSpeed = position.coords.speed !== null && position.coords.speed !== undefined ? position.coords.speed : 0;
  currentHeading = position.coords.heading !== null && position.coords.heading !== undefined ? position.coords.heading : -1;
  
  if ( timediff > 0 && lastPositionCoords ) {
    var ds = haversineDistance(
      lastPositionCoords.latitude,
      lastPositionCoords.longitude,
      lat,
      lon
    );
    
    var calculatedSpeed = ds / timediff;
    if (position.coords.speed === null || position.coords.speed === undefined) {
      currentSpeed = calculatedSpeed;
    }
    
    if (currentHeading === -1 && calculatedSpeed > 0.8 && ds > 0.8) {
      currentHeading = getBearing(lastPositionCoords.latitude, lastPositionCoords.longitude, lat, lon);
    }
    
    if (currentSpeed > 0.5 && ds > 0.5) {
      if (isNavigating) {
        totalMovingDistance += ds;
        totalMovingTimeSec += timediff;
        localStorage.setItem('totalMovingDistance', totalMovingDistance);
        localStorage.setItem('totalMovingTimeSec', totalMovingTimeSec);
      }
    }
  }
  
  lastPositionCoords = { latitude: lat, longitude: lon };

  currentLocation = {
    lat: lat,
    lon: lon,
    speed: currentSpeed,
    altitude: position.coords.altitude || 0
  };
  currentLL = new LatLon(lat, lon);
  
  // Record coordinates walked during navigation/tracking (10m threshold)
  if (isNavigating) {
    var lastPt = recordedTrack[recordedTrack.length - 1];
    var shouldAdd = false;
    if (!lastPt) {
      shouldAdd = true;
    } else {
      var d = haversineDistance(lastPt.lat, lastPt.lon, lat, lon);
      if (d >= 10) {
        shouldAdd = true;
      }
    }
    if (shouldAdd) {
      recordedTrack.push({
        lat: lat,
        lon: lon,
        ele: position.coords.altitude || 0,
        time: now
      });
      localStorage.setItem('recordedTrack', JSON.stringify(recordedTrack));
    }
  }
  
  updateWatchNavigationAndMap();
}

function getHeadingString(heading, isEnglish) {
  if (heading < 0 || heading === null || heading === undefined) return "---";
  var val = Math.floor((heading / 22.5) + 0.5);
  var arrEn = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  var arrDe = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return isEnglish ? arrEn[(val % 16)] : arrDe[(val % 16)];
}

function onGPSError(err) {
  console.log('GPS Error: ' + err.message);
  
  var isEnglish = localStorage.getItem('language') === 'en';
  var fullscreenMode = localStorage.getItem('fullscreen') === 'true' ? 1 : 0;
  // Notify watch of lost connection
  Pebble.sendAppMessage({
    GPS_CONNECTED: 0,
    NAV_INSTRUCTION: isEnglish ? 'No GPS Signal' : 'Kein GPS-Signal',
    NAV_DISTANCE: '---',
    LANGUAGE: isEnglish ? 1 : 0,
    FULLSCREEN_MODE: fullscreenMode,
    DASHBOARD_FIELDS: parseInt(localStorage.getItem('dashboardFields') || '15', 10),
    NAV_VIEW_MODE: parseInt(localStorage.getItem('navViewMode') || '0', 10),
    MAP_ORIENTATION: parseInt(localStorage.getItem('mapOrientation') || '0', 10),
    GPS_ALT_STR: "---",
    HEADING_STR: "---"
  });
}

// Perform calculations and send updates to watch
function updateWatchNavigationAndMap() {
  var isEnglish = localStorage.getItem('language') === 'en';
  var activeRouteId = parseInt(localStorage.getItem('activeRouteId') || '0', 10);
  var fullscreenMode = localStorage.getItem('fullscreen') === 'true' ? 1 : 0;
  
  if (!currentLocation) {
    Pebble.sendAppMessage({
      GPS_CONNECTED: 0,
      LANGUAGE: isEnglish ? 1 : 0,
      RECORDING_STATE: isNavigating ? 1 : 0,
      ACTIVE_ROUTE_ID: activeRouteId,
      FULLSCREEN_MODE: fullscreenMode,
      DASHBOARD_FIELDS: parseInt(localStorage.getItem('dashboardFields') || '15', 10),
      NAV_VIEW_MODE: parseInt(localStorage.getItem('navViewMode') || '0', 10),
    MAP_ORIENTATION: parseInt(localStorage.getItem('mapOrientation') || '0', 10),
      GPS_ALT_STR: "---",
      HEADING_STR: "---"
    });
    return;
  }
  
  var avgSpeedKmh = totalMovingTimeSec > 0 ? (totalMovingDistance / totalMovingTimeSec) * 3.6 : 0;
  var payload = {
    GPS_CONNECTED: 1,
    AVG_SPEED: avgSpeedKmh.toFixed(1),
    GPS_COORDS: currentLocation.lat.toFixed(5) + ', ' + currentLocation.lon.toFixed(5),
    LANGUAGE: isEnglish ? 1 : 0,
    RECORDING_STATE: isNavigating ? 1 : 0,
    GPS_SPEED: Math.round(currentSpeed * 100),
    GPS_HEADING: Math.round(currentHeading),
    ACTIVE_ROUTE_ID: activeRouteId,
    FULLSCREEN_MODE: fullscreenMode,
    DASHBOARD_FIELDS: parseInt(localStorage.getItem('dashboardFields') || '15', 10),
    NAV_VIEW_MODE: parseInt(localStorage.getItem('navViewMode') || '0', 10),
    MAP_ORIENTATION: parseInt(localStorage.getItem('mapOrientation') || '0', 10),
    GPS_ALT_STR: Math.round(currentLocation.altitude) + 'm',
    HEADING_STR: getHeadingString(currentHeading, isEnglish)
  };

  var offRoute = false;
  var vibrateAlert = 0;

  if (gpxTrack.length > 0) {
    var trackLengthMinusOne = gpxTrack.length - 1;
    // 1. Find the closest point on the track
    
    // Get the section we're on. closestIdx is the start of that section (which we already passed).
    var p1 = new LatLon(gpxTrack[0].lat, gpxTrack[0].lon);
    var minDist = currentLL.distanceTo(p1);
    var closestIdx = 0;
    for (var k = 1; k < gpxTrack.length; k++) {
      var p2 = new LatLon(gpxTrack[k].lat, gpxTrack[k].lon);

      // Are we close to a point?
      var distanceToPoint = currentLL.distanceTo(p2);
      if ( distanceToPoint < minDist ) {
        minDist = distanceToPoint;
        closestIdx = k;
        //console.log("Point", k, minDist);
      }

      // Are we close to a line / section?
      var distanceToLine = Math.abs(currentLL.crossTrackDistanceTo(p1, p2));
      var sectionLength = p1.distanceTo(p2);
      if (distanceToLine < minDist ) {
        var along = currentLL.alongTrackDistanceTo(p1, p2);
        if ( along > 0 && along < sectionLength ) {
          minDist = distanceToLine;
          closestIdx = k - 1;
          //console.log("Section", k-1, minDist);
        }
      }
      p1 = p2;
    }
    
    // Save closest index for map rendering (gray out walked part)
    closestTrackPointIdx = closestIdx;
    localStorage.setItem('closestTrackPointIdx', closestTrackPointIdx);
    
    // Calculate the distance traveled and remaining distance. Divide the current section based on the current location. yy
    var walkedDist = 0;
    for (var i = 0; i < closestIdx - 1; i++) {
      walkedDist += haversineDistance(gpxTrack[i].lat, gpxTrack[i].lon, gpxTrack[i + 1].lat, gpxTrack[i + 1].lon);
    }
    walkedDist += haversineDistance(gpxTrack[closestIdx].lat, gpxTrack[closestIdx].lon, currentLocation.lat, currentLocation.lon);
    var remDist = haversineDistance(currentLocation.lat, currentLocation.lon, gpxTrack[closestIdx + 1].lat, gpxTrack[closestIdx + 1].lon);
    for (var j = closestIdx + 1; j < trackLengthMinusOne; j++) {
      remDist += haversineDistance(gpxTrack[j].lat, gpxTrack[j].lon, gpxTrack[j + 1].lat, gpxTrack[j + 1].lon);
    }
    payload.TRIP_DISTANCE = (walkedDist / 1000).toFixed(1) + ' ' + (remDist / 1000).toFixed(1);
    
    // Calculate elevation stats based on GPX track elevations
    var gainMade = 0;
    var lossMade = 0;
    for (var i = 0; i < closestIdx; i++) {
      if (gpxTrack[i].ele !== undefined && gpxTrack[i+1].ele !== undefined) {
        var diff = gpxTrack[i+1].ele - gpxTrack[i].ele;
        if (diff > 0) gainMade += diff;
        else lossMade += Math.abs(diff);
      }
    }
    
    var gainRemaining = 0;
    var lossRemaining = 0;
    for (var i = closestIdx; i < trackLengthMinusOne; i++) {
      if (gpxTrack[i].ele !== undefined && gpxTrack[i+1].ele !== undefined) {
        var diff = gpxTrack[i+1].ele - gpxTrack[i].ele;
        if (diff > 0) gainRemaining += diff;
        else lossRemaining += Math.abs(diff);
      }
    }
    
    payload.ELEVATION_GAIN = Math.round(gainMade) + ' ' + Math.round(gainRemaining);
    payload.ELEVATION_LOSS = Math.round(lossMade) + ' ' + Math.round(lossRemaining);
    
    // Check if user is Off-Route (> 50 meters)
    if (minDist > 50) {
      offRoute = true;
      payload.OFF_ROUTE = 1;
      payload.NAV_INSTRUCTION = isEnglish ? 'OFF ROUTE!' : 'ABSEITS DER ROUTE!';
      payload.NAV_DISTANCE = Math.round(minDist) + 'm';
      payload.NAV_BEARING = -1;
      
      // Trigger off-route vibration alert once
      if (!hasVibratedOffRoute) {
        vibrateAlert = 2; // Off-Route alert
        hasVibratedOffRoute = true;
      }
    } else {
      payload.OFF_ROUTE = 0;
      hasVibratedOffRoute = false; // Reset off-route vibration state once back on route
      
      // 2. Look ahead for significant turns
      var turnIdx = -1;
      var distToTurn = 0;
      var turnBearingDiff = 0;
      
      // Find the next significant turn ahead of closestIdx
      for (var i = 0; i < significantTurns.length; i++) {
        if (significantTurns[i].idx > closestIdx) {
          turnIdx = significantTurns[i].idx;
          turnBearingDiff = significantTurns[i].bearingDiff;
          break;
        }
      }
      
      if (turnIdx !== -1) {
        distToTurn = haversineDistance(currentLocation.lat, currentLocation.lon, gpxTrack[closestIdx + 1].lat, gpxTrack[closestIdx + 1].lon);
        for (var idx = closestIdx + 1; idx < turnIdx; idx++) {
          distToTurn += haversineDistance(gpxTrack[idx].lat, gpxTrack[idx].lon, gpxTrack[idx + 1].lat, gpxTrack[idx + 1].lon);
        }
      } else {
        distToTurn = haversineDistance(currentLocation.lat, currentLocation.lon, gpxTrack[closestIdx + 1].lat, gpxTrack[closestIdx + 1].lon);
        for (var idx = closestIdx + 1; idx < trackLengthMinusOne; idx++) {
          distToTurn += haversineDistance(gpxTrack[idx].lat, gpxTrack[idx].lon, gpxTrack[idx + 1].lat, gpxTrack[idx + 1].lon);
        }
      }

      if (distToTurn > 1000) {
         payload.NAV_DISTANCE = (distToTurn / 1000).toFixed(1) + 'km';
      } else {
         payload.NAV_DISTANCE = Math.round(distToTurn) + 'm';
      }

      if (turnIdx !== -1) {
        
        // Formulate instruction text
        var dirText = '';
        if (isEnglish) {
          dirText = turnBearingDiff > 0 ? 'Right' : 'Left';
        } else {
          dirText = turnBearingDiff > 0 ? 'Rechts' : 'Links';
        }
        payload.NAV_INSTRUCTION = dirText + ' in ' + payload.NAV_DISTANCE;
        
        // Map bearing to 0=straight, 90=right, 180=uturn, 270=left
        payload.NAV_BEARING = turnBearingDiff > 0 ? 90 : 270;
        
        // Trigger turn haptic vibration (only once per turn)
        if (distToTurn <= 50) {
          if (lastVibratedTurnIdx !== turnIdx) {
            var turnVib = localStorage.getItem('turnVibration') || (localStorage.getItem('directionalVibrations') !== 'false' ? 'directional' : '1_short');
            if (turnVib === 'directional') {
              vibrateAlert = turnBearingDiff > 0 ? 3 : 1; // 3 = Right, 1 = Left
            } else if (turnVib === '1_short') {
              vibrateAlert = 4;
            } else if (turnVib === '2_short') {
              vibrateAlert = 5;
            } else if (turnVib === '1_long') {
              vibrateAlert = 6;
            } else if (turnVib === 'off') {
              vibrateAlert = 0;
            }
            lastVibratedTurnIdx = turnIdx;
          }
        }
        
        // Continuous Popup State
        if (distToTurn <= 50) {
          if (localStorage.getItem('navViewMode') !== '1') { // 1 = Map Only, so 0 and 2 will show popup
            payload.NAV_POPUP_STATE = 1;
          } else {
            payload.NAV_POPUP_STATE = 0;
          }
        } else {
          payload.NAV_POPUP_STATE = 0;
        }
      } else {
        // No more sharp turns.
        payload.NAV_INSTRUCTION = (isEnglish ? 'Straight for ' : 'Gerade aus ') + payload.NAV_DISTANCE;
        payload.NAV_BEARING = 0; // straight
        payload.NAV_POPUP_STATE = 0;
      }
    }
  } else {
    payload.NAV_INSTRUCTION = isEnglish ? 'No route' : 'Keine Route';
    payload.NAV_DISTANCE = '---';
    payload.TRIP_DISTANCE = '--- ---';
    payload.ELEVATION_GAIN = '--- ---';
    payload.ELEVATION_LOSS = '--- ---';
    payload.NAV_POPUP_STATE = 0;
    closestTrackPointIdx = -1;
  }
  
  if (vibrateAlert !== 0) {
    payload.VIBRATE_ALERT = vibrateAlert;
  }
  
  // Send status/nav values first
  Pebble.sendAppMessage(payload, function() {
    // Render and send the map image afterward
    renderAndSendMap();
  }, function(e) {
    console.log('AppMessage send failed: ' + JSON.stringify(e));
    // Still try to send the map
    renderAndSendMap();
  });
}

// Render viewport tiles and send map image in chunks
function renderAndSendMap() {
  if (isSendingMap || !currentLocation) return;
  isSendingMap = true;
  
  // 1. Identify which tiles are needed for the current viewport
  var centerPix = graphics.latLonToPixels(currentLocation.lat, currentLocation.lon, currentZoom);
  var tlX = centerPix.x - MAP_WIDTH / 2;
  var tlY = centerPix.y - MAP_HEIGHT / 2;
  var tileXMin = Math.floor(tlX / 256);
  var tileXMax = Math.floor((tlX + MAP_WIDTH) / 256);
  var tileYMin = Math.floor(tlY / 256);
  var tileYMax = Math.floor((tlY + MAP_HEIGHT) / 256);
  
  var tileCache = {};
  var tilesToFetch = [];
  var mapSource = localStorage.getItem('mapSource') || 'opentopomap';
  
  for (var tx = tileXMin; tx <= tileXMax; tx++) {
    for (var ty = tileYMin; ty <= tileYMax; ty++) {
      var key = currentZoom + '/' + tx + '/' + ty;
      var storeKey = 'tile_' + mapSource + '_' + key;
      var cachedBase64 = localStorage.getItem(storeKey);
      
      if (cachedBase64) {
        try {
          var bytes = base64ToUint8Array(cachedBase64);
          var decoded = png.decodePNG(bytes);
          tileCache[key] = decoded;
        } catch (err) {
          console.log('Cached tile decode error (' + key + '): ' + err);
          tilesToFetch.push({ key: key, z: currentZoom, x: tx, y: ty });
        }
      } else {
        // Tile not cached, fetch online
        tilesToFetch.push({ key: key, z: currentZoom, x: tx, y: ty });
      }
    }
  }
  
  // 2. Fetch missing tiles if online
  if (tilesToFetch.length > 0) {
    var fetchedCount = 0;
    
    function checkCompleted() {
      fetchedCount++;
      if (fetchedCount === tilesToFetch.length) {
        doRenderAndChunkSend(tileCache);
      }
    }
    
    tilesToFetch.forEach(function(item) {
      var url = getTileUrl(item.z, item.x, item.y);
      
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      
      xhr.onload = function() {
        if (xhr.status === 200) {
          try {
            var bytes = new Uint8Array(xhr.response);
            var decoded = png.decodePNG(bytes);
            tileCache[item.key] = decoded;
            
            // Cache downloaded tile in localStorage
            var base64 = arrayBufferToBase64(xhr.response);
            localStorage.setItem('tile_' + mapSource + '_' + item.key, base64);
          } catch (e) {
            console.log('Error decoding fetched tile ' + item.key + ': ' + e);
          }
        }
        checkCompleted();
      };
      xhr.onerror = function() {
        console.error('Failed to fetch tile: ' + item.key);
        checkCompleted();
      };
      xhr.send();
    });
  } else {
    doRenderAndChunkSend(tileCache);
  }
}

// Draw route overlays and trigger the AppMessage transmission loop
function doRenderAndChunkSend(tileCache) {
  try {
    var showBreadcrumbs = localStorage.getItem('showBreadcrumbs') !== 'false';
    var gcolor8Map = graphics.renderViewport(
      currentLocation.lat,
      currentLocation.lon,
      currentZoom,
      gpxTrack,
      tileCache,
      closestTrackPointIdx,
      recordedTrack,
      showBreadcrumbs
    );
    
    // Chunked Transmission Loop
    var totalSize = gcolor8Map.length; // 30,000 bytes
    var totalChunks = Math.ceil(totalSize / CHUNK_SIZE); // 10 chunks
    
    function sendChunk(chunkIdx) {
      if (chunkIdx >= totalChunks) {
        console.log('Map image fully transmitted to watch!');
        isSendingMap = false;
        return;
      }
      
      var start = chunkIdx * CHUNK_SIZE;
      var end = Math.min(start + CHUNK_SIZE, totalSize);
      var chunkData = Array.prototype.slice.call(gcolor8Map.subarray(start, end));
      
      var payload = {
        MAP_DATA_CHUNK: chunkData,
        CHUNK_INDEX: chunkIdx,
        TOTAL_CHUNKS: totalChunks
      };
      
      var retries = 0;
      function transmit() {
        Pebble.sendAppMessage(payload, function() {
          // Success, send next chunk
          sendChunk(chunkIdx + 1);
        }, function(err) {
          console.warn('Chunk ' + chunkIdx + ' failed sending. Retrying...');
          retries++;
          if (retries < 3) {
            setTimeout(transmit, 150);
          } else {
            console.error('Failed transmitting map chunk ' + chunkIdx + ' after 3 retries.');
            isSendingMap = false;
          }
        });
      }
      transmit();
    }
    
    sendChunk(0);
  } catch (err) {
    console.error('Map rendering / transmission crashed: ' + err.stack);
    isSendingMap = false;
  }
}

// Background Tile Cacher along the GPX Track
function cacheTrackTiles(track) {
  var zoom = 15;
  var tileKeys = [];
  var seen = {};
  
  for (var i = 0; i < track.length; i++) {
    var pt = track[i];
    var tile = graphics.latLonToPixels(pt.lat, pt.lon, zoom);
    var tileX = Math.floor(tile.x / 256);
    var tileY = Math.floor(tile.y / 256);
    
    // Cache 3x3 block around track points
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        var key = zoom + '/' + (tileX + dx) + '/' + (tileY + dy);
        if (!seen[key]) {
          seen[key] = true;
          tileKeys.push({ key: key, z: zoom, x: tileX + dx, y: tileY + dy });
        }
      }
    }
  }
  
  console.log('Background Tile Cache Scheduler: ' + tileKeys.length + ' tiles detected.');
  
  var idx = 0;
  function downloadNext() {
    if (idx >= tileKeys.length) {
      console.log('Offline tile caching fully completed!');
      return;
    }
    
    var mapSource = localStorage.getItem('mapSource') || 'opentopomap';
    var item = tileKeys[idx];
    var storeKey = 'tile_' + mapSource + '_' + item.key;
    
    if (localStorage.getItem(storeKey)) {
      idx++;
      downloadNext();
      return;
    }
    
    var url = getTileUrl(item.z, item.x, item.y);
    
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var base64 = arrayBufferToBase64(xhr.response);
          localStorage.setItem(storeKey, base64);
        } catch (e) {
          console.warn('LocalStorage full, stopping offline caching.');
          return;
        }
      }
      idx++;
      setTimeout(downloadNext, 120); // rate limiting request
    };
    xhr.onerror = function() {
      idx++;
      setTimeout(downloadNext, 120);
    };
    xhr.send();
  }
  
  downloadNext();
}
