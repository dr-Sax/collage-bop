export class MarkerManager {
    constructor(viewer) {
        this.viewer = viewer;
        this.markers = new Map();
        this.players = new Map();
        this.targetPositions = new Map();
        this.targetRotations = new Map();
        this.interpolationSpeed = 0.15;
    }

    createMarker(id) {
        const cfg = this.viewer.config.markers[id] || this.viewer.config.default;
        const vid = cfg.src.match(/(?:embed\/|youtu\.be\/|watch\?v=)([^&\n?#]+)/)?.[1];
        const container = document.createElement('div');
        
        // Apply static clip path styling
        container.style.cssText = `
            width:${cfg.width};
            height:${cfg.height};
            clip-path:${cfg.clip_path};
            overflow:hidden;
            position:relative;
            transform:translateZ(0);
            will-change:transform;
        `;
        
        if (vid) {
            this.createYouTubePlayer(id, vid, cfg, container);
        }
        
        const object = new THREE.CSS3DObject(container);
        
        // Initialize interpolation targets
        this.targetPositions.set(id, { x: 0, y: 0, z: 0 });
        this.targetRotations.set(id, { x: 0, y: 0, z: 0 });
        
        return object;
    }

    createYouTubePlayer(id, videoId, config, container) {
        const playerDiv = document.createElement('div');
        playerDiv.id = `player-${id}`;
        playerDiv.style.cssText = 'width:100%;height:100%';
        container.appendChild(playerDiv);
        
        // Delayed player creation to prevent blocking
        setTimeout(() => {
            const player = new YT.Player(playerDiv.id, {
                videoId: videoId,
                width: '100%',
                height: '100%',
                playerVars: {
                    autoplay: 1,
                    loop: 1,
                    mute: 0,
                    controls: 0,
                    rel: 0,
                    showinfo: 0,
                    modestbranding: 1,
                    playsinline: 1
                },
                events: {
                    onReady: e => {
                        e.target.setVolume(30);
                        if (config.start) e.target.seekTo(config.start);
                        e.target.playVideo();
                    },
                    onStateChange: e => {
                        if (e.data === YT.PlayerState.PLAYING && 
                            config.start !== undefined && config.end !== undefined) {
                            this.setupVideoLoop(e.target, config);
                        }
                    }
                }
            });
            this.players.set(id, player);
        }, 50);
    }

    setupVideoLoop(player, config) {
        const checkTime = () => {
            if (player.getCurrentTime() >= config.end) {
                player.seekTo(config.start);
            }
            if (player.getPlayerState() === YT.PlayerState.PLAYING) {
                setTimeout(checkTime, 200);
            }
        };
        checkTime();
    }

    updateMarkerPosition(marker, data) {
        const id = data.id;
        
        // Set target positions for interpolation
        this.targetPositions.set(id, {
            x: -data.position.x * 3200 + 200,
            y: data.position.y * 1500 + 250,
            z: -data.position.z * 100
        });
        
        this.targetRotations.set(id, {
            x: data.rotation.x * Math.PI/180,
            y: data.rotation.y * Math.PI/180,
            z: data.rotation.z * Math.PI/180
        });
        
        marker.visible = true;
        
        // Volume control with debouncing
        this.updateMarkerVolume(marker, data);

        // Cleanup selection if marker becomes invisible
        if (!marker.visible && this.viewer.midi.selectedMarkers.has(id)) {
            this.viewer.midi.cleanupMarkerSelection(id);
        }
    }

    updateMarkerVolume(marker, data) {
        const player = this.players.get(data.id);
        if (player?.setVolume) {
            const rotZ = Math.abs(data.rotation.z) % 360;
            const volume = Math.round(rotZ / 360 * 50); // Max 50% volume
            if (!marker.lastVolume || Math.abs(marker.lastVolume - volume) >= 10) {
                player.setVolume(volume);
                marker.lastVolume = volume;
            }
        }
    }

    interpolateMarkers() {
        for (const [id, marker] of this.markers) {
            const targetPos = this.targetPositions.get(id);
            const targetRot = this.targetRotations.get(id);
            
            if (targetPos && targetRot) {
                // Lerp position
                marker.position.x += (targetPos.x - marker.position.x) * this.interpolationSpeed;
                marker.position.y += (targetPos.y - marker.position.y) * this.interpolationSpeed;
                marker.position.z += (targetPos.z - marker.position.z) * this.interpolationSpeed;
                
                // Lerp rotation
                marker.rotation.x += (targetRot.x - marker.rotation.x) * this.interpolationSpeed;
                marker.rotation.y += (targetRot.y - marker.rotation.y) * this.interpolationSpeed;
                marker.rotation.z += (targetRot.z - marker.rotation.z) * this.interpolationSpeed;
            }
        }
    }

    addMarker(id) {
        if (!this.markers.has(id)) {
            const marker = this.createMarker(id);
            this.viewer.group.add(marker);
            this.markers.set(id, marker);
            return marker;
        }
        return this.markers.get(id);
    }

    getMarker(id) {
        return this.markers.get(id);
    }

    getPlayer(id) {
        return this.players.get(id);
    }

    getMarkerCount() {
        return this.markers.size;
    }

    getPlayerCount() {
        return this.players.size;
    }
}