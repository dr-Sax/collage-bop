export class UIManager {
    constructor(viewer) {
        this.viewer = viewer;
        this.updateCount = 0;
        this.fpsStartTime = Date.now();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        addEventListener('resize', () => {
            this.viewer.camera.aspect = innerWidth / innerHeight;
            this.viewer.camera.updateProjectionMatrix();
            this.viewer.renderer.setSize(innerWidth, innerHeight);
        });
        
        // Fullscreen shortcut
        addEventListener('keydown', e => {
            if (e.key === 'f' && e.ctrlKey) {
                e.preventDefault();
                document.documentElement.requestFullscreen();
            }
        });
    }

    addDialHighlight(markerId) {
        const marker = this.viewer.markers.get(markerId);
        if (!marker) {
            console.log(`❌ No marker found for ID ${markerId}`);
            return;
        }
        
        const container = marker.element;
        
        let borderOverlay = container.querySelector('.dial-highlight');
        if (!borderOverlay) {
            borderOverlay = document.createElement('div');
            borderOverlay.className = 'dial-highlight';
            container.appendChild(borderOverlay);
        }
        
        const config = this.viewer.config.markers[markerId] || this.viewer.config.default;
        
        borderOverlay.style.cssText = `
            position: absolute;
            top: -3px;
            left: -3px;
            width: calc(100% + 6px);
            height: calc(100% + 6px);
            border: 3px solid #ff6b35;
            clip-path: ${config.clip_path};
            pointer-events: none;
            z-index: 10;
            box-sizing: border-box;
            background: rgba(241, 241, 86, 0.8);
        `;
    }

    removeDialHighlight(markerId) {
        const marker = this.viewer.markers.get(markerId);
        if (!marker) return;
        
        const borderOverlay = marker.element.querySelector('.dial-highlight');
        if (borderOverlay) {
            borderOverlay.remove();
        }
    }

    addSelectionHighlight(markerId) {
        const marker = this.viewer.markers.get(markerId);
        if (!marker) return;
        
        const container = marker.element;
        
        let selectionOverlay = container.querySelector('.selection-highlight');
        if (!selectionOverlay) {
            selectionOverlay = document.createElement('div');
            selectionOverlay.className = 'selection-highlight';
            container.appendChild(selectionOverlay);
        }
        
        const config = this.viewer.config.markers[markerId] || this.viewer.config.default;
        selectionOverlay.style.cssText = `
            position: absolute;
            top: -3px;
            left: -3px;
            width: calc(100% + 6px);
            height: calc(100% + 6px);
            border: 3px solid #ffff00;
            clip-path: ${config.clip_path};
            pointer-events: none;
            z-index: 11;
            box-sizing: border-box;
        `;
    }

    removeSelectionHighlight(markerId) {
        const marker = this.viewer.markers.get(markerId);
        if (!marker) return;
        
        const selectionOverlay = marker.element.querySelector('.selection-highlight');
        if (selectionOverlay) {
            selectionOverlay.remove();
        }
    }

    updatePerformanceStats(processingTime) {
        const now = Date.now();
        this.updateCount++;
        
        // Calculate update rate every second
        if (now - this.fpsStartTime >= 1000) {
            const fps = this.updateCount;
            document.getElementById('update-rate').textContent = `${fps} fps`;
            document.getElementById('update-rate').className = 
                fps >= 25 ? 'performance-good' : fps >= 15 ? 'performance-warning' : 'performance-bad';
            
            this.updateCount = 0;
            this.fpsStartTime = now;
        }
        
        // Update processing time
        if (processingTime !== undefined) {
            const procTime = Math.round(processingTime * 1000);
            document.getElementById('processing-time').textContent = `${procTime}ms`;
            document.getElementById('processing-time').className = 
                procTime <= 10 ? 'performance-good' : procTime <= 25 ? 'performance-warning' : 'performance-bad';
        }
    }

    updateConnectionStatus(connected) {
        const connElement = document.getElementById('conn');
        connElement.className = connected ? 'connected' : 'disconnected';
        connElement.textContent = connected ? 'Connected' : 'Disconnected';
    }

    updateMarkerStats(markerCount, playerCount) {
        document.getElementById('markers').textContent = markerCount;
        document.getElementById('players').textContent = playerCount;
    }

    updateNetworkLag(timestamp) {
        const now = Date.now();
        const networkLag = now - (timestamp * 1000);
        document.getElementById('network-lag').textContent = `${Math.round(networkLag)}ms`;
        document.getElementById('network-lag').className = 
            networkLag <= 50 ? 'performance-good' : networkLag <= 100 ? 'performance-warning' : 'performance-bad';
    }
}