/**
 * A slide deck object
 */
class SlideDeck {
  /**
   * Constructor for the SlideDeck object.
   * @param {Node} container The container element for the slides.
   * @param {NodeList} slides A list of HTML elements containing the slide text.
   * @param {L.map} map The Leaflet map where data will be shown.
   * @param {object} slideOptions The options to create each slide's L.geoJSON
   *                              layer, keyed by slide ID.
   */
  constructor(container, slides, map, slideOptions = {}) {
    this.container = container;
    this.slides = slides;
    this.map = map;
    this.slideOptions = slideOptions;

    this.dataLayer = L.featureGroup().addTo(map);
    this.currentSlideIndex = 0;
  }

  /**
   * ### updateDataLayer
   *
   * The updateDataLayer function will clear any markers or shapes previously
   * added to the GeoJSON layer on the map, and replace them with the data
   * provided in the `data` argument. The `data` should contain a GeoJSON
   * FeatureCollection object.
   *
   * @param {object} data A GeoJSON FeatureCollection object
   * @param {object} options Options to pass to L.geoJSON
   * @return {L.GeoJSONLayer} The new GeoJSON layer that has been added to the
   *                          data layer group.
   */
  updateDataLayer(data, options, clearExisting = true) {
    if (clearExisting) {
      this.dataLayer.clearLayers();
    }

    const defaultOptions = {
      pointToLayer: (p, latlng) => L.marker(latlng),
      style: (feature) => feature.properties.style,
      onEachFeature: (feature, layer) => {
        if (feature.properties && feature.properties.label) {
          layer.bindTooltip(feature.properties.label);
        }
      },
    };
    const geoJsonLayer = L.geoJSON(data, options || defaultOptions)
      .addTo(this.dataLayer);

    return geoJsonLayer;
  }

  /**
   * ### getSlideFeatureCollection
   *
   * Load the slide's features from a GeoJSON file.
   *
   * @param {string} dataFile The GeoJSON filename without its .json extension.
   * @return {object} The FeatureCollection as loaded from the data file
   */
  async getSlideFeatureCollection(dataFile) {
    const resp = await fetch(`data/${dataFile}.json`);
    if (!resp.ok) {
      throw new Error(`Could not load data/${dataFile}.json`);
    }
    const data = await resp.json();
    return data;
  }

  /**
   * Return a slide's configured data sources. A slide can use multiple
   * GeoJSON files, such as HVI polygons, park polygons, and tree points.
   * @param {HTMLElement} slide The current HTML slide.
   * @return {Array<object>} Source configurations.
   */
  getSlideDataSources(slide) {
    const configuration = this.slideOptions[slide.id] || {};
    if (configuration.dataSources) {
      return configuration.dataSources;
    }

    return [{ file: slide.id, options: configuration }];
  }

  /**
   * Return whether a feature's bounding box overlaps a given bbox.
   * @param {object} feature A GeoJSON feature.
   * @param {Array<number>} bbox [west, south, east, north].
   * @return {boolean} Whether the feature should remain in the layer.
   */
  getFeatureBbox(feature) {
    const coordinates = feature.geometry.coordinates.flat(Infinity);
    const longitudes = coordinates.filter((value, index) => index % 2 === 0);
    const latitudes = coordinates.filter((value, index) => index % 2 === 1);

    return [
      Math.min(...longitudes),
      Math.min(...latitudes),
      Math.max(...longitudes),
      Math.max(...latitudes),
    ];
  }

  /**
   * Return whether two bounding boxes overlap.
   * @param {Array<number>} firstBbox [west, south, east, north].
   * @param {Array<number>} secondBbox [west, south, east, north].
   * @return {boolean} Whether the boxes overlap.
   */
  bboxesIntersect(firstBbox, secondBbox) {
    const [firstWest, firstSouth, firstEast, firstNorth] = firstBbox;
    const [secondWest, secondSouth, secondEast, secondNorth] = secondBbox;

    return firstWest <= secondEast
      && firstEast >= secondWest
      && firstSouth <= secondNorth
      && firstNorth >= secondSouth;
  }

  /**
   * Return whether a feature's bounding box overlaps a given bbox.
   * @param {object} feature A GeoJSON feature.
   * @param {Array<number>} bbox [west, south, east, north].
   * @return {boolean} Whether the feature should remain in the layer.
   */
  featureIntersectsBbox(feature, bbox) {
    const featureBbox = this.getFeatureBbox(feature);

    return this.bboxesIntersect(featureBbox, bbox);
  }

  /**
   * Keep only features that overlap a bbox. This is especially useful for
   * large point layers, while preserving the untouched source GeoJSON file.
   * @param {object} collection A GeoJSON FeatureCollection.
   * @param {Array<number>} bbox [west, south, east, north].
   * @return {object} A filtered FeatureCollection.
   */
  filterFeatureCollectionToBbox(collection, bbox) {
    return {
      ...collection,
      bbox,
      features: collection.features.filter((feature) => {
        return this.featureIntersectsBbox(feature, bbox);
      }),
    };
  }

  /**
   * ### hideAllSlides
   *
   * Add the hidden class to all slides' HTML elements.
   *
   * @param {NodeList} slides The set of all slide elements, in order.
   */
  hideAllSlides() {
    for (const slide of this.slides) {
      slide.classList.add('hidden');
    }
  }

  /**
   * ### syncMapToSlide
   *
   * Go to the slide that mathces the specified ID.
   *
   * @param {HTMLElement} slide The slide's HTML element
   */
  async syncMapToSlide(slide) {
    const configuration = this.slideOptions[slide.id] || {};
    const dataSources = this.getSlideDataSources(slide);
    const loadedCollections = await Promise.all(dataSources.map(async (source) => {
      const collection = await this.getSlideFeatureCollection(source.file);
      return collection;
    }));

    const collections = [];
    loadedCollections.forEach((collection, index) => {
      const source = dataSources[index];
      let filteredCollection = collection;
      if (source.filterToBbox) {
        filteredCollection = this.filterFeatureCollectionToBbox(
          filteredCollection,
          source.filterBbox || configuration.bbox,
        );
      }
      collections.push(filteredCollection);
    });

    this.dataLayer.clearLayers();
    const layers = collections.map((collection, index) => {
      return this.updateDataLayer(
        collection,
        dataSources[index].options,
        false,
      );
    });

    /**
     * Create a bounds object from a GeoJSON bbox array.
     * @param {Array} bbox The bounding box of the collection
     * @return {L.latLngBounds} The bounds object
     */
    const boundsFromBbox = (bbox) => {
      const [west, south, east, north] = bbox;
      const bounds = L.latLngBounds(
        L.latLng(south, west),
        L.latLng(north, east),
      );
      return bounds;
    };

    /**
     * Create a temporary event handler that will show tooltips on the map
     * features, after the map is done "flying" to contain the data layer.
     */
    const handleFlyEnd = () => {
      if (slide.dataset.showpopups === 'true') {
        layers.forEach((layer) => {
          layer.eachLayer((featureLayer) => {
            if (featureLayer.feature.properties.label) {
              featureLayer.bindTooltip(featureLayer.feature.properties.label, {
                permanent: true,
              });
              featureLayer.openTooltip();
            }
          });
        });
      }
      this.map.removeEventListener('moveend', handleFlyEnd);
    };

    this.map.addEventListener('moveend', handleFlyEnd);
    if (configuration.bbox) {
      this.map.flyToBounds(boundsFromBbox(configuration.bbox));
    } else {
      this.map.flyToBounds(this.dataLayer.getBounds());
    }
  }

  /**
   * Show the slide with ID matched by currentSlideIndex. If currentSlideIndex is
   * null, then show the first slide.
   */
  syncMapToCurrentSlide() {
    const slide = this.slides[this.currentSlideIndex];
    this.syncMapToSlide(slide);
  }

  /**
   * Increment the currentSlideIndex and show the corresponding slide. If the
   * current slide is the final slide, then the next is the first.
   */
  goNextSlide() {
    this.currentSlideIndex++;

    if (this.currentSlideIndex === this.slides.length) {
      this.currentSlideIndex = 0;
    }

    this.syncMapToCurrentSlide();
  }

  /**
   * Decrement the currentSlideIndes and show the corresponding slide. If the
   * current slide is the first slide, then the previous is the final.
   */
  goPrevSlide() {
    this.currentSlideIndex--;

    if (this.currentSlideIndex < 0) {
      this.currentSlideIndex = this.slides.length - 1;
    }

    this.syncMapToCurrentSlide();
  }

  /**
   * ### preloadFeatureCollections
   *
   * Initiate a fetch on all slide data so that the browser can cache the
   * requests. This way, when a specific slide is loaded it has a better chance
   * of loading quickly.
   */
  preloadFeatureCollections() {
    const preloadedFiles = new Set();
    for (const slide of this.slides) {
      const dataSources = this.getSlideDataSources(slide);
      for (const source of dataSources) {
        if (source.preload !== false && !preloadedFiles.has(source.file)) {
          this.getSlideFeatureCollection(source.file);
          preloadedFiles.add(source.file);
        }
      }
    }
  }

  /**
   * Calculate the current slide index based on the current scroll position.
   */
  calcCurrentSlideIndex() {
    // Height of the viewport
    const windowHeight = window.innerHeight;

    // How far down the page we've scrolled so far; calculated from the top of
    // the page
    const scrollPos = window.scrollY;

    // Amount of next slide that must be visible above the bottom of the window
    // to trigger a slide transition
    const scrollPeek = 64;

    // When the next slide peeks above the bottom of the viewport a certain
    // amount, we consider that we've reached the next slide.
    const currentSlideThreshold = scrollPos + windowHeight - scrollPeek;

    // Create a variable to hold the index of each slide as we check it.
    let i;

    // Start from the last slide and work backwards to find the current slide.
    for (i = this.slides.length - 1; i > 0; i--) {
      const slidePos
        = this.slides[i].offsetTop + this.container.offsetTop;
      if (slidePos <= currentSlideThreshold) {
        break;
      }
    }

    if (i !== this.currentSlideIndex) {
      this.currentSlideIndex = i;
      this.syncMapToCurrentSlide();
    }
  }
}

export { SlideDeck };
