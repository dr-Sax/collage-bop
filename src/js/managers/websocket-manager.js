export class WebSocketManager {
    constructor(viewer) {
        this.viewer = viewer;
        this.ws = null;
        this.reconnectTimeout = 3000;
    }

    connect() {
        try {
            this.ws = new WebSocket('ws://localhost:8765');
            
            this.ws.onopen = () => {
                this.viewer.ui.updateConnectionStatus(true);
                console.log('🔗 Connected to tracker');
            };
            
            this.ws.onclose = () => {
                this.viewer.ui.updateConnectionStatus(false);
                console.log('❌ Disconnected from tracker');
                setTimeout(() => this.connect(), this.reconnectTimeout);
            };
            
            this.ws.onmessage = (e) => this.handleMessage(e);
            
            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
            };
            
        } catch (err) {
            console.error('❌ Connection error:', err);
            setTimeout(() => this.connect(), this.reconnectTimeout);
        }
    }

    handleMessage(event) {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'tracking_update') {
                this.processTrackingUpdate(data);
            }
        } catch (err) {
            console.error('❌ Message parsing error:', err);
        }
    }

    processTrackingUpdate(data) {
        const markers = data.markers || {};
        
        // Update markers
        Object.entries(markers).forEach(([id, markerData]) => {
            id = parseInt(id);
            const marker = this.viewer.markerManager.addMarker(id);
            this.viewer.markerManager.updateMarkerPosition(marker, markerData);
        });
        
        // Update UI stats
        this.viewer.ui.updateMarkerStats(
            Object.keys(markers).length,
            this.viewer.markerManager.getPlayerCount()
        );
        
        this.viewer.ui.updateNetworkLag(data.timestamp);
        this.viewer.ui.updatePerformanceStats(data.processing_time);
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}