var MAP_WIDTH = 200;
var MAP_HEIGHT = 150;

function initMapDimensions(platform) {
  if (!platform) {
    platform = "basalt";
    if (typeof Pebble !== 'undefined' && Pebble.getActiveWatchInfo) {
      try {
        var info = Pebble.getActiveWatchInfo();
        platform = info.platform || "basalt";
      } catch(e) {
        console.log("Error getting watch info: " + e);
      }
    }
  }
  
  if (platform === "emery") {
    MAP_WIDTH = 200;
    MAP_HEIGHT = 150;
  } else if (platform === "chalk") {
    MAP_WIDTH = 180;
    MAP_HEIGHT = 114;
  } else { // basalt, aplite
    MAP_WIDTH = 144;
    MAP_HEIGHT = 112;
  }
  console.log("Initialized map dimensions for platform " + platform + ": " + MAP_WIDTH + "x" + MAP_HEIGHT);
}

// Convert latitude and longitude to absolute world pixels at a given zoom level
function latLonToPixels(lat, lon, zoom) {
  var totalPixels = 256 * Math.pow(2, zoom);
  
  // X coordinate
  var x = ((lon + 180) / 360) * totalPixels;
  
  // Y coordinate (Web Mercator projection)
  var latRad = (lat * Math.PI) / 180;
  var y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * (totalPixels / 2);
  
  return { x: x, y: y };
}

// Convert absolute world pixels back to latitude and longitude
function pixelsToLatLon(x, y, zoom) {
  var totalPixels = 256 * Math.pow(2, zoom);
  var lon = (x / totalPixels) * 360 - 180;
  
  var n = Math.PI - (2 * Math.PI * y) / totalPixels;
  var lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  
  return { lat: lat, lon: lon };
}

// Helper to draw a single pixel in an RGBA buffer
function drawPixel(buffer, x, y, r, g, b, a) {
  if (x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT) {
    var idx = (y * MAP_WIDTH + x) * 4;
    buffer[idx]     = r;
    buffer[idx + 1] = g;
    buffer[idx + 2] = b;
    buffer[idx + 3] = a !== undefined ? a : 255;
  }
}

// Draw a filled circle with optional border
function drawCircle(buffer, cx, cy, radius, r, g, b, borderR, borderG, borderB, borderWidth) {
  var maxRad = radius + (borderWidth || 0);
  for (var dy = -maxRad; dy <= maxRad; dy++) {
    for (var dx = -maxRad; dx <= maxRad; dx++) {
      var distSq = dx * dx + dy * dy;
      if (distSq <= radius * radius) {
        drawPixel(buffer, cx + dx, cy + dy, r, g, b);
      } else if (borderWidth && distSq <= maxRad * maxRad) {
        drawPixel(buffer, cx + dx, cy + dy, borderR, borderG, borderB);
      }
    }
  }
}

// Bresenham's line algorithm with brush thickness
function drawLineThick(buffer, x0, y0, x1, y1, thickness, r, g, b) {
  var dx = Math.abs(x1 - x0);
  var dy = Math.abs(y1 - y0);
  var sx = (x0 < x1) ? 1 : -1;
  var sy = (y0 < y1) ? 1 : -1;
  var err = dx - dy;
  
  var rad = Math.floor(thickness / 2);
  
  function drawBrush(cx, cy) {
    for (var bdy = -rad; bdy <= rad; bdy++) {
      for (var bdx = -rad; bdx <= rad; bdx++) {
        if (bdx * bdx + bdy * bdy <= rad * rad) {
          drawPixel(buffer, cx + bdx, cy + bdy, r, g, b);
        }
      }
    }
  }
  
  while (true) {
    drawBrush(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    var e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// Stitch map tiles, draw GPX track, overlay user position, and return GColor8 buffer
function renderViewport(currentLat, currentLon, zoom, gpxTrack, tileCache, closestIdx, recordedTrack, showBreadcrumbs) {
  // 1. Initialize RGBA viewport buffer (filled with light grey color)
  var rgbaBuffer = new Uint8Array(MAP_WIDTH * MAP_HEIGHT * 4);
  for (var i = 0; i < rgbaBuffer.length; i += 4) {
    rgbaBuffer[i]     = 220; // R
    rgbaBuffer[i + 1] = 220; // G
    rgbaBuffer[i + 2] = 220; // B
    rgbaBuffer[i + 3] = 255; // A
  }
  
  // 2. Find absolute pixel position of current location
  var centerPix = latLonToPixels(currentLat, currentLon, zoom);
  
  // Top-left corner of the viewport in absolute world pixels
  var tlX = centerPix.x - MAP_WIDTH / 2;
  var tlY = centerPix.y - MAP_HEIGHT / 2;
  
  // 3. Find range of tiles overlapping the viewport
  var tileXMin = Math.floor(tlX / 256);
  var tileXMax = Math.floor((tlX + MAP_WIDTH) / 256);
  var tileYMin = Math.floor(tlY / 256);
  var tileYMax = Math.floor((tlY + MAP_HEIGHT) / 256);
  
  // 4. Stitch tiles onto viewport
  for (var tx = tileXMin; tx <= tileXMax; tx++) {
    for (var ty = tileYMin; ty <= tileYMax; ty++) {
      var tileKey = zoom + '/' + tx + '/' + ty;
      var tileData = tileCache[tileKey];
      
      // If we have the decoded tile in cache, render it
      if (tileData && tileData.pixels) {
        var tilePixels = tileData.pixels;
        // Tile absolute coordinates range from [tx*256, (tx+1)*256]
        var startX = tx * 256;
        var startY = ty * 256;
        
        // Copy overlapping pixels
        for (var py = 0; py < 256; py++) {
          var worldY = startY + py;
          var viewY = Math.floor(worldY - tlY);
          
          if (viewY >= 0 && viewY < MAP_HEIGHT) {
            for (var px = 0; px < 256; px++) {
              var worldX = startX + px;
              var viewX = Math.floor(worldX - tlX);
              
              if (viewX >= 0 && viewX < MAP_WIDTH) {
                var viewIdx = (viewY * MAP_WIDTH + viewX) * 4;
                var tileIdx = (py * 256 + px) * 4;
                
                rgbaBuffer[viewIdx]     = tilePixels[tileIdx];
                rgbaBuffer[viewIdx + 1] = tilePixels[tileIdx + 1];
                rgbaBuffer[viewIdx + 2] = tilePixels[tileIdx + 2];
                rgbaBuffer[viewIdx + 3] = tilePixels[tileIdx + 3];
              }
            }
          }
        }
      }
    }
  }
  
  // 4.5. Render breadcrumbs (traveled route) overlay underneath the planned GPX route
  if (showBreadcrumbs && recordedTrack && recordedTrack.length > 1) {
    var pointsToRender = recordedTrack;
    if (recordedTrack.length > 500) {
      pointsToRender = [];
      var step = Math.ceil((recordedTrack.length - 1) / 499);
      for (var i = 0; i < recordedTrack.length - 1; i += step) {
        pointsToRender.push(recordedTrack[i]);
      }
      pointsToRender.push(recordedTrack[recordedTrack.length - 1]);
    }
    
    for (var k = 0; k < pointsToRender.length - 1; k++) {
      var pt1 = pointsToRender[k];
      var pt2 = pointsToRender[k + 1];
      
      var pix1 = latLonToPixels(pt1.lat, pt1.lon, zoom);
      var pix2 = latLonToPixels(pt2.lat, pt2.lon, zoom);
      
      var sx1 = Math.floor(pix1.x - tlX);
      var sy1 = Math.floor(pix1.y - tlY);
      var sx2 = Math.floor(pix2.x - tlX);
      var sy2 = Math.floor(pix2.y - tlY);
      
      // Bounding box clipping: discard segments where both endpoints are outside the viewport + 50px margin
      var p1Inside = (sx1 >= -50 && sx1 <= MAP_WIDTH + 50 && sy1 >= -50 && sy1 <= MAP_HEIGHT + 50);
      var p2Inside = (sx2 >= -50 && sx2 <= MAP_WIDTH + 50 && sy2 >= -50 && sy2 <= MAP_HEIGHT + 50);
      
      if (!p1Inside && !p2Inside) {
        continue;
      }
      
      drawLineThick(rgbaBuffer, sx1, sy1, sx2, sy2, 3, 0, 85, 255); // 3px Cobalt Blue line
    }
  }
  
  // 5. Render GPX track overlay (gray out walked part)
  if (gpxTrack && gpxTrack.length > 1) {
    for (var k = 0; k < gpxTrack.length - 1; k++) {
      var pt1 = gpxTrack[k];
      var pt2 = gpxTrack[k + 1];
      
      // Project both points to absolute pixels
      var pix1 = latLonToPixels(pt1.lat, pt1.lon, zoom);
      var pix2 = latLonToPixels(pt2.lat, pt2.lon, zoom);
      
      // Convert to viewport screen coordinates
      var sx1 = Math.floor(pix1.x - tlX);
      var sy1 = Math.floor(pix1.y - tlY);
      var sx2 = Math.floor(pix2.x - tlX);
      var sy2 = Math.floor(pix2.y - tlY);
      
      // Draw line. Gray out walked parts (k < closestIdx)
      if (closestIdx !== undefined && closestIdx !== null && k < closestIdx) {
        drawLineThick(rgbaBuffer, sx1, sy1, sx2, sy2, 5, 120, 120, 120); // 5px darker grey line
      } else {
        drawLineThick(rgbaBuffer, sx1, sy1, sx2, sy2, 5, 255, 60, 0); // 5px bright orange line
      }
    }
  }
  
  // 6. Render user position marker (No longer drawn here - watch draws it dynamically)
  // Center is always (MAP_WIDTH / 2, MAP_HEIGHT / 2) -> (100, 75)
  
  // 7. Convert viewport RGBA buffer to Pebble-compatible GColor8 buffer (30,000 bytes)
  var gcolor8Buffer = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  for (var y = 0; y < MAP_HEIGHT; y++) {
    for (var x = 0; x < MAP_WIDTH; x++) {
      var rIdx = (y * MAP_WIDTH + x) * 4;
      var r = rgbaBuffer[rIdx];
      var g = rgbaBuffer[rIdx + 1];
      var b = rgbaBuffer[rIdx + 2];
      
      // Map 8-bit R, G, B to 2-bit (0-3)
      var r2 = r >> 6; // values 0-3
      var g2 = g >> 6;
      var b2 = b >> 6;
      
      // GColor8 byte format: 0b11RRGGBB (where 11 represents full opacity)
      var gcolorByte = 0xc0 | (r2 << 4) | (g2 << 2) | b2;
      gcolor8Buffer[y * MAP_WIDTH + x] = gcolorByte;
    }
  }
  
  return gcolor8Buffer;
}

module.exports = {
  latLonToPixels: latLonToPixels,
  pixelsToLatLon: pixelsToLatLon,
  renderViewport: renderViewport,
  initMapDimensions: initMapDimensions,
  getMapWidth: function() { return MAP_WIDTH; },
  getMapHeight: function() { return MAP_HEIGHT; },
  setDimensions: function(w, h) {
    MAP_WIDTH = w;
    MAP_HEIGHT = h;
  }
};
