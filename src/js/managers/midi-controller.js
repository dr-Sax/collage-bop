export class MIDIController {
    constructor(viewer) {
        this.viewer = viewer;
        this.midiValues = new Map();
        this.markerControls = new Map();
        this.selectedMarkers = new Set();
        this.currentDialMarker = null;
        this.dialPosition = 0;
    }

    async init() {
        if (!navigator.requestMIDIAccess) {
            console.warn('❌ Web MIDI API not supported in this browser');
            return;
        }
        
        try {
            const midiAccess = await navigator.requestMIDIAccess({ sysex: false });
            
            if (midiAccess.inputs.size === 0) {
                console.warn('🎹 No MIDI input devices found');
                return;
            }
            
            this.setupInputs(midiAccess);
            
        } catch (error) {
            console.warn('❌ MIDI access denied or failed:', error);
        }
    }

    setupInputs(midiAccess) {
        for (const input of midiAccess.inputs.values()) {
            console.log(`🎹 Setting up MIDI input: ${input.name}`);
            input.onmidimessage = (message) => this.handleMessage(message);
        }
    }

    handleMessage(message) {
        const [command, data1, data2] = message.data;
        
        // Control Change messages (176 = 0xB0)
        if (command === 176) {
            this.processControl(data1, data2);
        }
        // Note On/Off for drum pads (144/128)
        else if (command === 144 || command === 128) {
            this.processNote(data1, data2, command === 144);
        }
    }

    processControl(cc, value) {
        this.midiValues.set(cc, value);
        
        switch(cc) {
            case 70: this.handleMarkerSelection(value); break;
            case 71: // Red
            case 72: // Green  
            case 73: // Blue
            case 74: // Alpha
                this.handleColorControl(cc, value); break;
            case 75: this.handleScaleControl(value); break;
            case 76: this.handleZPositionControl(value); break;
            case 77: // X rotation
            case 78: // Y rotation
                this.handleRotationControl(cc, value); break;
            default:
                console.log(`🎹 Unmapped CC ${cc}: ${value}`);
        }
    }

    processNote(note, velocity, isNoteOn) {
        if (note === 36 && isNoteOn && velocity > 0) {
            this.toggleMarkerSelection();
        }
    }

    handleMarkerSelection(value) {
        this.dialPosition = value;
        
        const visibleMarkerIds = Array.from(this.viewer.markers.keys()).filter(id => {
            const marker = this.viewer.markers.get(id);
            return marker && marker.visible;
        });
        
        if (visibleMarkerIds.length === 0) {
            this.currentDialMarker = null;
            return;
        }
        
        const totalPositions = visibleMarkerIds.length + 1;
        const position = Math.floor((value / 127) * totalPositions);
        const clampedPosition = Math.min(position, totalPositions - 1);
        
        // Remove previous highlight
        if (this.currentDialMarker !== null) {
            this.viewer.ui.removeDialHighlight(this.currentDialMarker);
        }
        
        // Null position check
        if (clampedPosition === 0) {
            this.currentDialMarker = null;
            console.log(`🎹 Dial in null position (no marker selected)`);
            return;
        }
        
        // Set new selection
        const markerIndex = clampedPosition - 1;
        const newSelectedId = visibleMarkerIds[markerIndex];
        this.currentDialMarker = newSelectedId;
        
        // Add highlight if not already selected
        if (!this.selectedMarkers.has(newSelectedId)) {
            this.viewer.ui.addDialHighlight(newSelectedId);
        }
        
        console.log(`🎹 Dial hovering marker ${newSelectedId} (${markerIndex + 1}/${visibleMarkerIds.length})`);
    }

    toggleMarkerSelection() {
        if (this.currentDialMarker === null) return;
        
        const markerId = this.currentDialMarker;
        
        if (this.selectedMarkers.has(markerId)) {
            // Deselect
            this.selectedMarkers.delete(markerId);
            this.viewer.ui.removeSelectionHighlight(markerId);
            this.viewer.ui.addDialHighlight(markerId);
            console.log(`🎹 Deselected marker ${markerId}`);
        } else {
            // Select
            this.selectedMarkers.add(markerId);
            this.viewer.ui.removeDialHighlight(markerId);
            this.viewer.ui.addSelectionHighlight(markerId);
            console.log(`🎹 Selected marker ${markerId}`);
        }
        
        // Initialize control values for newly selected marker
        if (this.selectedMarkers.has(markerId) && !this.markerControls.has(markerId)) {
            this.markerControls.set(markerId, {
                scale: 1.0,
                alpha: 1.0,
                red: 255,
                green: 255,
                blue: 255,
                zOffset: 0,
                rotationX: 0,
                rotationY: 0
            });
        }
    }

    cleanupMarkerSelection(markerId) {
        this.selectedMarkers.delete(markerId);
        
        if (this.currentDialMarker === markerId) {
            this.currentDialMarker = null;
        }
        
        this.viewer.ui.removeDialHighlight(markerId);
        this.viewer.ui.removeSelectionHighlight(markerId);
    }

    // Placeholder methods for color, scale, position, rotation controls
    // These can be expanded as you develop more MIDI features
    handleColorControl(cc, value) {
        console.log(`🎨 Color control CC${cc}: ${value}`);
        // TODO: Implement color control
    }

    handleScaleControl(value) {
        console.log(`📏 Scale control: ${value}`);
        // TODO: Implement scale control
    }

    handleZPositionControl(value) {
        console.log(`📐 Z-position control: ${value}`);
        // TODO: Implement Z-position control
    }

    handleRotationControl(cc, value) {
        console.log(`🔄 Rotation control CC${cc}: ${value}`);
        // TODO: Implement rotation control
    }

    applyMarkerControls(id, marker) {
        const controls = this.markerControls.get(id);
        if (!controls || !this.selectedMarkers.has(id)) return;
        
        // TODO: Apply scale, additional rotations, transparency, etc.
        // These modify the marker AFTER tracking positions are set
    }
}