export const baseLayers = [
    {
        name: "OpenStreetMap",
        checked: true,
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
    },
    {
        name: "Satellite",
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attribution: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 18
    },
    {
        name: "Dark Map",
        url: "https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 18
    }

]

export const overlayLayers = [
    {
        name: "Marine Navigation",
        url: "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
        attribution: '&copy; <a href="https://www.openseamap.org/">OpenSeaMap</a>',
        maxZoom: 18,
        opacity: 1,
        zIndex: 2
    }
] 