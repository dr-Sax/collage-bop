export class ConfigManager {
    constructor() {
        this.config = null;
    }

    async loadConfig() {
        try {
            this.config = await fetch('marker_config.json').then(r => r.json());
            console.log('✅ Config loaded successfully');
            return this.config;
        } catch (error) {
            console.warn('⚠️ Failed to load config, using defaults');
            this.config = this.getDefaultConfig();
            return this.config;
        }
    }

    getDefaultConfig() {
        return {
            markers: {},
            default: {
                width: "256px",
                height: "144px",
                src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
                clip_path: "circle(50% at 50% 50%)"
            }
        };
    }

    getMarkerConfig(id) {
        return this.config?.markers?.[id] || this.config?.default || this.getDefaultConfig().default;
    }

    getAllMarkerConfigs() {
        return this.config?.markers || {};
    }

    updateMarkerConfig(id, newConfig) {
        if (!this.config.markers) {
            this.config.markers = {};
        }
        this.config.markers[id] = { ...this.config.markers[id], ...newConfig };
    }

    exportConfig() {
        return JSON.stringify(this.config, null, 2);
    }
}