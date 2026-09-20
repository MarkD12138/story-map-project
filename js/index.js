import { SlideDeck } from './slidedeck.js';

const map = L.map('map', { scrollWheelZoom: false })
  .setView([39.9526, -75.1652], 11);

// ## The Base Tile Layer
const baseTileLayer = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg', {
  maxZoom: 16,
  attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://stamen.com/" target="_blank">Stamen Design</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
});
baseTileLayer.addTo(map);

// ## Interface Elements
const container = document.querySelector('.slide-section');
const slides = document.querySelectorAll('.slide');

// Use a tighter bbox for the HVI tract context and a larger one for nearby
// parks and trees on the final slide.
const huntingParkTractBbox = [-75.155, 40.000, -75.108, 40.027];
const huntingParkGreenBbox = [-75.175, 39.984, -75.088, 40.043];

/**
 * Convert a Heat Vulnerability Index score into one of five map colors.
 * The break values can be adjusted to match the classifications used in
 * ArcGIS Pro.
 * @param {number} score An HVI score.
 * @return {string} A CSS color.
 */
const getHviColor = (score) => {
  if (!Number.isFinite(score)) return '#bdbdbd';
  if (score < -3) return '#2c105c';
  if (score < 0) return '#7b2cbf';
  if (score < 3) return '#d45087';
  if (score < 5) return '#f89540';
  return '#ffff33';
};

/**
 * Style a census tract by its HVI score.
 * @param {object} feature A GeoJSON feature.
 * @param {number} fillOpacity Polygon fill opacity.
 * @return {object} Leaflet path options.
 */
const hviStyle = (feature, fillOpacity = 0.75) => {
  return {
    color: '#ffffff',
    fillColor: getHviColor(feature.properties.hvi_score),
    fillOpacity,
    weight: 0.5,
  };
};

/**
 * Show the HVI value when a tract is hovered or tapped.
 * @param {object} feature A GeoJSON feature.
 * @param {L.Layer} layer The corresponding Leaflet layer.
 */
const addHviTooltip = (feature, layer) => {
  const { hvi_score: hviScore, name10: tract } = feature.properties;
  const hviLabel = Number.isFinite(hviScore) ? hviScore.toFixed(2) : 'No data';
  layer.bindTooltip(`Census tract ${tract}<br>HVI: ${hviLabel}`);
};

const slideOptions = {
  philly_city: {
    dataSources: [{
      file: 'philly_city',
      options: {
        style: () => ({
          color: '#9a3412',
          fillColor: '#f97316',
          fillOpacity: 0.45,
          weight: 1.5,
        }),
      },
    }],
  },
  citywide_hvi: {
    dataSources: [{
      file: 'hvi',
      options: {
        style: hviStyle,
        onEachFeature: addHviTooltip,
      },
    }],
  },
  hunting_park: {
    bbox: huntingParkTractBbox,
    dataSources: [{
      file: 'hvi',
      filterToBbox: true,
      options: {
        style: hviStyle,
        onEachFeature: addHviTooltip,
      },
    }],
  },
  hunting_park_green: {
    // Keep the final slide's camera extent identical to the previous slide.
    bbox: huntingParkTractBbox,
    dataSources: [
      {
        file: 'hvi',
        filterToBbox: true,
        filterBbox: huntingParkTractBbox,
        options: {
          style: (feature) => hviStyle(feature, 0.8),
          onEachFeature: addHviTooltip,
        },
      },
      {
        file: 'park',
        filterToBbox: true,
        filterBbox: huntingParkGreenBbox,
        options: {
          style: () => ({
            color: '#1b7837',
            fillColor: '#5aae61',
            fillOpacity: 0.55,
            weight: 1,
          }),
          onEachFeature: (feature, layer) => {
            layer.bindTooltip(feature.properties.official_name);
          },
        },
      },
      {
        file: 'tree_point',
        filterToBbox: true,
        filterBbox: huntingParkGreenBbox,
        preload: false,
        options: {
          pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
            color: '#145a32',
            fillColor: '#145a32',
            fillOpacity: 0.8,
            radius: 2,
            weight: 0,
          }),
          onEachFeature: (feature, layer) => {
            layer.bindTooltip(feature.properties.tree_name);
          },
        },
      },
    ],
  },
};

// ## The SlideDeck object
const deck = new SlideDeck(container, slides, map, slideOptions);

document.addEventListener('scroll', () => deck.calcCurrentSlideIndex());

deck.preloadFeatureCollections();
deck.syncMapToCurrentSlide();
