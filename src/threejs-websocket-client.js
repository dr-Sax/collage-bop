class SimplifiedARClient {
    constructor() {
        this.ws = null;
        this.markers = new Map();
        this.youtubePlayers = new Map();
        this.config = null;
        this.youtubeAPIReady = false;
        
        // Load YouTube API first, then config, then init
        this.loadYouTubeAPI().then(() => {
            this.loadConfig().then(() => this.init());
        });
    }

    async loadYouTubeAPI() {
        return new Promise((resolve) => {
            if (window.YT && window.YT.Player) {
                this.youtubeAPIReady = true;
                console.log('✅ YouTube API already loaded');
                resolve();
                return;
            }

            window.onYouTubeIframeAPIReady = () => {
                this.youtubeAPIReady = true;
                console.log('✅ YouTube API loaded');
                resolve();
            };

            if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
                const script = document.createElement('script');
                script.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(script);
            }
        });
    }

    async loadConfig() {
        try {
            const response = await fetch('marker_config.json');
            this.config = await response.json();
            console.log('✅ Config loaded:', Object.keys(this.config.markers));
        } catch (error) {
            console.error('❌ Config failed:', error);
            this.config = {
                markers: {},
                default: {
                    width: "512px", height: "288px",
                    src: "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&loop=1&mute=1&playlist=dQw4w9WgXcQ&controls=0",
                    clip_path: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)"
                }
            };
        }
    }

    init() {
        const container = document.getElementById('container');
        
        // Marker renderer
        this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 1000);
        this.scene = new THREE.Scene();
        this.renderer = new THREE.CSS3DRenderer();
        this.renderer.setSize(innerWidth, innerHeight);
        container.appendChild(this.renderer.domElement);
        
        // Hand renderer
        this.handCamera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
        this.handCamera.position.set(0, 0, 300);
        this.handScene = new THREE.Scene();
        this.handRenderer = new THREE.WebGLRenderer({ alpha: true });
        this.handRenderer.setSize(innerWidth, innerHeight);
        this.handRenderer.domElement.style.position = 'absolute';
        this.handRenderer.domElement.style.top = '0';
        this.handRenderer.domElement.style.pointerEvents = 'none';
        this.handRenderer.domElement.style.zIndex = '10';
        container.appendChild(this.handRenderer.domElement);
        
        this.group = new THREE.Group();
        this.scene.add(this.group);
        
        // Hand materials
        this.jointMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        this.boneMat = new THREE.LineBasicMaterial({ color: 0x0088ff, linewidth: 2 });
        
        // Hand connections
        this.connections = [
            [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],
            [0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]
        ];
        
        this.addControls();
        this.connect();
        addEventListener('resize', () => this.resize());
        this.animate();
    }

    extractVideoId(url) {
        const regex = /(?:youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([^&\n?#]+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    createElement(id) {
        const config = this.config.markers[id.toString()] || this.config.default;
        const videoId = this.extractVideoId(config.src);
        
        console.log(`🎬 Creating marker ${id} with video ${videoId}`);
        
        // Create container div with clip path
        const container = document.createElement('div');
        container.style.width = config.width;
        container.style.height = config.height;
        container.style.clipPath = config.clip_path;
        container.style.overflow = 'hidden';
        container.style.position = 'relative';
        
        // Create YouTube player div
        const playerDiv = document.createElement('div');
        playerDiv.id = `youtube-player-${id}`;
        playerDiv.style.width = '100%';
        playerDiv.style.height = '100%';
        container.appendChild(playerDiv);
        
        // Create YouTube player immediately if API is ready
        if (this.youtubeAPIReady && videoId) {
            try {
                console.log(`🎥 Creating YouTube player for marker ${id}`);
                const player = new YT.Player(playerDiv.id, {
                    videoId: videoId,
                    width: '100%',
                    height: '100%',
                    playerVars: {
                        autoplay: 1,
                        loop: 1,
                        mute: 1,
                        controls: 0,
                        playlist: videoId,
                        rel: 0,
                        showinfo: 0
                    },
                    events: {
                        onReady: (event) => {
                            console.log(`✅ YouTube player ${id} ready`);
                            event.target.playVideo();
                        },
                        onError: (event) => {
                            console.error(`❌ YouTube player ${id} error:`, event.data);
                        }
                    }
                });
                this.youtubePlayers.set(id, player);
            } catch (error) {
                console.error(`❌ Failed to create YouTube player for marker ${id}:`, error);
            }
        } else {
            console.warn(`⚠️ YouTube API not ready or no video ID for marker ${id}`);
        }
        
        console.log(`📺 Marker ${id} element created`);
        return new THREE.CSS3DObject(container);
    }

    connect() {
        this.ws = new WebSocket('ws://localhost:8765');
        this.ws.onopen = () => this.updateStatus('connected', 'Connected');
        this.ws.onclose = () => {
            this.updateStatus('disconnected', 'Disconnected');
            setTimeout(() => this.connect(), 3000);
        };
        this.ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            this.updateMarkers(data.markers);
            this.updateHands(data.hands);
            this.updateCounts(Object.keys(data.markers).length, data.hands.length);
        };
    }

    updateStatus(className, text) {
        const conn = document.getElementById('conn');
        if (conn) {
            conn.className = className;
            conn.textContent = text;
        }
    }

    updateCounts(markers, hands) {
        const markerEl = document.getElementById('markers');
        const handEl = document.getElementById('hands');
        if (markerEl) markerEl.textContent = markers;
        if (handEl) handEl.textContent = hands;
    }

    updateMarkers(markers) {
        Object.entries(markers).forEach(([id, data]) => {
            id = parseInt(id);
            
            if (!this.markers.has(id)) {
                console.log(`🆕 Creating new marker ${id}`);
                const element = this.createElement(id);
                this.group.add(element);
                this.markers.set(id, element);
            }
            
            const marker = this.markers.get(id);
            marker.position.set(
                -data.position.x * 3200 + 200,
                -data.position.y * 1500 + 250,
                -data.position.z * 100
            );
            marker.rotation.set(
                data.rotation.x * Math.PI/180,
                data.rotation.y * Math.PI/180,
                data.rotation.z * Math.PI/180
            );
            marker.visible = true;
        });
    }

    updateHands(hands) {
        this.handScene.children = [];
        
        hands.forEach(hand => {
            const handGroup = new THREE.Group();
            const joints = [];
            
            hand.landmarks.forEach(lm => {
                const joint = new THREE.Mesh(new THREE.SphereGeometry(1.5), this.jointMat);
                joint.position.set(
                    (lm.x - 0.5) * 200,
                    -(lm.y - 0.5) * 150,
                    lm.z * 20
                );
                joints.push(joint);
                handGroup.add(joint);
            });
            
            this.connections.forEach(([a, b]) => {
                if (a < joints.length && b < joints.length) {
                    const geom = new THREE.BufferGeometry();
                    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
                        joints[a].position.x, joints[a].position.y, joints[a].position.z,
                        joints[b].position.x, joints[b].position.y, joints[b].position.z
                    ]), 3));
                    handGroup.add(new THREE.Line(geom, this.boneMat));
                }
            });
            
            this.handScene.add(handGroup);
        });
    }

    addControls() {
        const controls = document.createElement('div');
        controls.style.cssText = 'position:absolute;bottom:10px;right:10px;z-index:100;background:rgba(0,0,0,0.8);color:white;padding:15px;border-radius:5px;';
        
        controls.innerHTML = `
            <h4 style="margin:0 0 10px 0;">Simple Controls</h4>
            <button id="reloadConfig" style="width:100%;padding:8px;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;margin-bottom:10px;">
                Reload Config
            </button>
            <div>Active Players: <span id="playerCount">0</span></div>
            <div>API Ready: <span id="apiStatus">false</span></div>
        `;
        
        controls.querySelector('#reloadConfig').onclick = () => {
            console.log('🔄 Reloading config...');
            this.loadConfig();
        };
        
        // Update player count periodically
        setInterval(() => {
            const playerCount = controls.querySelector('#playerCount');
            const apiStatus = controls.querySelector('#apiStatus');
            if (playerCount) playerCount.textContent = this.youtubePlayers.size;
            if (apiStatus) apiStatus.textContent = this.youtubeAPIReady;
        }, 1000);
        
        document.getElementById('container').appendChild(controls);
    }

    resize() {
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(innerWidth, innerHeight);
        
        this.handCamera.aspect = innerWidth / innerHeight;
        this.handCamera.updateProjectionMatrix();
        this.handRenderer.setSize(innerWidth, innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.renderer.render(this.scene, this.camera);
        this.handRenderer.render(this.handScene, this.handCamera);
    }

    // Simple control methods for debugging
    setVolume(markerId, volume) {
        const player = this.youtubePlayers.get(markerId);
        if (player && player.setVolume) {
            player.setVolume(volume);
            console.log(`🔊 Set marker ${markerId} volume to ${volume}`);
        }
    }

    mute(markerId) {
        const player = this.youtubePlayers.get(markerId);
        if (player && player.mute) {
            player.mute();
            console.log(`🔇 Muted marker ${markerId}`);
        }
    }

    unmute(markerId) {
        const player = this.youtubePlayers.get(markerId);
        if (player && player.unMute) {
            player.unMute();
            console.log(`🔊 Unmuted marker ${markerId}`);
        }
    }
}

// Global debug object
window.debugAR = {
    setVolume: (id, vol) => window.arClient?.setVolume(id, vol),
    mute: (id) => window.arClient?.mute(id),
    unmute: (id) => window.arClient?.unmute(id),
    listPlayers: () => Array.from(window.arClient?.youtubePlayers.keys() || [])
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Starting Simple AR Client...');
    window.arClient = new SimplifiedARClient();
});