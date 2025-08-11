import { MIDIController } from './managers/midi-controller.js';
import { UIManager } from './managers/ui-manager.js';
import { MarkerManager } from './managers/marker-manager.js';
import { WebSocketManager } from './managers/websocket-manager.js';
import { ConfigManager } from './managers/config-manager.js';
import { YouTubeManager } from './managers/youtube-manager.js';

export class Viewer {
    constructor() {
        // Core Three.js components
        this.camera = null;
        this.scene = null;
        this.renderer = null;
        this.group = null;
        this.animFrame = null;
        
        // Performance tracking
        this.frameSkipCount = 0;
        this.lastFrameTime = 0;
        
        // Initialize managers
        this.configManager = new ConfigManager();
        this.youtubeManager = new YouTubeManager();
        this.ui = new UIManager(this);
        this.markerManager = new MarkerManager(this);
        this.websocket = new WebSocketManager(this);
        this.midi = new MIDIController(this);
        
        // Expose config for backward compatibility
        this.config = null;
        this.markers = this.markerManager.markers;
        this.players = this.markerManager.players;
    }

    async init() {
        document.getElementById('loading').style.display = 'block';
        
        // Load dependencies
        await this.youtubeManager.loadAPI();
        this.config = await this.configManager.loadConfig();
        await this.waitFor(() => THREE.CSS3DRenderer);
        
        // Initialize Three.js
        this.initThreeJS();
        
        // Initialize managers
        this.ui.init();
        await this.midi.init();
        this.websocket.connect();
        
        // Start render loop
        this.animate();
        
        document.getElementById('loading').style.display = 'none';
    }

    initThreeJS() {
        this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 1000);
        this.scene = new THREE.Scene();
        this.renderer = new THREE.CSS3DRenderer();
        this.renderer.setSize(innerWidth, innerHeight);
        this.group = new THREE.Group();
        this.scene.add(this.group);
        document.getElementById('container').appendChild(this.renderer.domElement);
    }

    async waitFor(fn) {
        return new Promise(resolve => {
            const check = () => fn() ? resolve() : setTimeout(check, 100);
            check();
        });
    }

    animate() {
        const now = Date.now();
        const deltaTime = now - this.lastFrameTime;
        
        // Frame rate limiting for consistency (~60fps max)
        if (deltaTime >= 16) {
            this.markerManager.interpolateMarkers();
            this.renderer.render(this.scene, this.camera);
            this.lastFrameTime = now;
        } else {
            this.frameSkipCount++;
        }
        
        this.animFrame = requestAnimationFrame(() => this.animate());
    }

    // Utility methods for debugging (backward compatibility)
    getStats() {
        return {
            markers: this.markerManager.getMarkerCount(),
            players: this.markerManager.getPlayerCount(),
            frameSkips: this.frameSkipCount
        };
    }
}

// Initialize when start button is clicked
document.getElementById('start-button').onclick = async () => {
    document.getElementById('start-screen').style.display = 'none';
    window.ar = new Viewer();
    await window.ar.init();
    
    // Global controls for debugging
    window.controls = {
        vol: (id, v) => window.ar.markerManager.getPlayer(id)?.setVolume(v),
        mute: (id) => window.ar.markerManager.getPlayer(id)?.mute(),
        play: (id) => window.ar.markerManager.getPlayer(id)?.playVideo(),
        pause: (id) => window.ar.markerManager.getPlayer(id)?.pauseVideo(),
        stats: () => console.log(window.ar.getStats())
    };
};