// src/app/screens/discover-map.js
import * as L from 'leaflet';

import { pinElement, pinLabel } from './discover-state.js';

const LEAFLET_LINK = '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>';

export function createLeafletMap({
  document, container, tiles, view, onMove = () => {}, onSelect = () => {}, onTap = null,
}) {
  const map = L.map(container, { zoomControl: false, attributionControl: false, worldCopyJump: true, minZoom: 2, maxZoom: 14 });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: LEAFLET_LINK }).addTo(map);
  L.tileLayer(tiles.url, {
    attribution: tiles.attribution, maxZoom: 14, referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(map);
  const markers = L.layerGroup().addTo(map);

  function snapshot() {
    const bounds = map.getBounds();
    const center = map.getCenter().wrap();
    return {
      bounds: { minLat: bounds.getSouth(), minLng: bounds.getWest(), maxLat: bounds.getNorth(), maxLng: bounds.getEast() },
      view: { lat: center.lat, lng: center.lng, zoom: map.getZoom() },
    };
  }

  map.on('moveend', () => onMove(snapshot()));
  if (onTap) {
    map.on('click', (event) => {
      const point = event.latlng.wrap();
      onTap({ lat: point.lat, lng: point.lng });
    });
  }
  map.setView([view.lat, view.lng], view.zoom);
  map.whenReady(() => onMove(snapshot()));
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => map.invalidateSize()) : null;
  observer?.observe(container);

  return {
    setPoints(points) {
      markers.clearLayers();
      for (const point of points) {
        L.marker([Number(point.lat), Number(point.lng)], {
          icon: L.divIcon({ className: 'discover-pin-icon', html: pinElement(document, point), iconSize: null }),
          keyboard: true,
          title: pinLabel(point),
          riseOnHover: true,
        }).on('click', () => onSelect(point)).addTo(markers);
      }
    },
    flyTo({ lat, lng, zoom }) {
      map.setView([lat, lng], zoom ?? Math.max(map.getZoom(), 10));
    },
    destroy() {
      observer?.disconnect();
      map.remove();
    },
  };
}
