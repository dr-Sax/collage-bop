import cv2
import numpy as np
import asyncio
import websockets
import json
import time
import mediapipe as mp
from datetime import datetime

class SimplifiedTracker:
    def __init__(self, config_file='marker_config.json'):
        # Setup
        self.cap = cv2.VideoCapture(0)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        # Verify the settings
        actual_width = self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)
        actual_height = self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        print(f"📷 Camera resolution: {actual_width}x{actual_height}")
        
        self.clients = set()
        self.load_config(config_file)
        
        # ArUco
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_6X6_250)
        self.detector = cv2.aruco.ArucoDetector(self.aruco_dict, cv2.aruco.DetectorParameters())
        self.camera_matrix = np.array([[800, 0, 320], [0, 800, 240], [0, 0, 1]], dtype=float)
        self.dist_coeffs = np.zeros((4,1))
        
        # MediaPipe
        self.hands = mp.solutions.hands.Hands(max_num_hands=2, min_detection_confidence=0.7)
        self.mp_drawing = mp.solutions.drawing_utils
        
        # History
        self.design_history = {}
        self.last_states = {}
        self.frame_count = 0

    def load_config(self, config_file):
        try:
            with open(config_file, 'r') as f:
                self.config = json.load(f)
            print(f"✅ Config loaded: {list(self.config['markers'].keys())}")
        except Exception as e:
            print(f"❌ Config error: {e}")
            exit(1)

    def detect_markers(self, frame):
        corners, ids, _ = self.detector.detectMarkers(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        markers = {}
        
        if ids is not None:
            for i, marker_id in enumerate(ids.flatten()):
                success, rvec, tvec = cv2.solvePnP(
                    np.array([[-0.025, -0.025, 0], [0.025, -0.025, 0], [0.025, 0.025, 0], [-0.025, 0.025, 0]], dtype=np.float32),
                    corners[i].reshape(-1, 2), self.camera_matrix, self.dist_coeffs
                )
                
                if success:
                    R, _ = cv2.Rodrigues(rvec.flatten())
                    markers[int(marker_id)] = {
                        'id': int(marker_id),
                        'position': {'x': float(tvec[0]), 'y': float(tvec[1]), 'z': float(tvec[2])},
                        'rotation': {
                            'x': float(np.arctan2(R[2,1], R[2,2]) * 180/np.pi),
                            'y': float(np.arctan2(-R[2,0], np.sqrt(R[2,1]**2 + R[2,2]**2)) * 180/np.pi),
                            'z': float(np.arctan2(R[1,0], R[0,0]) * 180/np.pi)
                        }
                    }
            cv2.aruco.drawDetectedMarkers(frame, corners)
        return markers

    def detect_hands(self, frame):
        results = self.hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        hands = []
        
        if results.multi_hand_landmarks:
            for i, landmarks in enumerate(results.multi_hand_landmarks):
                label = results.multi_handedness[i].classification[0].label if results.multi_handedness else "Unknown"
                hands.append({
                    'id': i,
                    'label': label,
                    'landmarks': [{'x': lm.x, 'y': lm.y, 'z': lm.z} for lm in landmarks.landmark]
                })
                self.mp_drawing.draw_landmarks(frame, landmarks, mp.solutions.hands.HAND_CONNECTIONS)
        return hands

    def should_update_history(self, markers):
        if len(markers) != len(self.last_states):
            return True
        
        for marker_id, data in markers.items():
            if marker_id not in self.last_states:
                return True
            
            last = self.last_states[marker_id]
            pos_change = sum(abs(data['position'][k] - last['position'][k]) for k in ['x', 'y', 'z'])
            rot_change = sum(abs(data['rotation'][k] - last['rotation'][k]) for k in ['x', 'y', 'z'])
            
            if pos_change > 0.01 or rot_change > 1.0:
                return True
        return False

    def update_history(self, markers):
        all_ids = set(markers.keys()) | set(self.last_states.keys())
        
        for marker_id in all_ids:
            marker_id_str = str(marker_id)
            if marker_id_str not in self.design_history:
                self.design_history[marker_id_str] = {}
            
            # Use current data or last known state
            data = markers.get(marker_id, self.last_states.get(marker_id, {
                'position': {'x': 0, 'y': 0, 'z': 0},
                'rotation': {'x': 0, 'y': 0, 'z': 0}
            }))
            
            # Get config for this marker
            config = self.config['markers'].get(marker_id_str, self.config['default'])
            
            # Create history entry
            entry = {
                **config,
                "pos-rot": {
                    "x": data['position']['x'], "y": data['position']['y'], "z": data['position']['z'],
                    "rx": data['rotation']['x'], "ry": data['rotation']['y'], "rz": data['rotation']['z'],
                    "s": 0.1
                }
            }
            
            self.design_history[marker_id_str][str(self.frame_count)] = entry
        
        self.last_states = markers.copy()
        self.frame_count += 1

    def export_history(self, filename=None):
        if not filename:
            filename = f"design_history_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        try:
            with open(filename, 'w') as f:
                json.dump(self.design_history, f, indent=2)
            print(f"✅ Exported: {filename} ({self.frame_count} frames)")
        except Exception as e:
            print(f"❌ Export error: {e}")

    async def handle_client(self, websocket, path=None):
        self.clients.add(websocket)
        try:
            await websocket.wait_closed()
        finally:
            self.clients.remove(websocket)

    async def broadcast(self, data):
        if self.clients:
            message = json.dumps(data)
            for client in list(self.clients):
                try:
                    await client.send(message)
                except:
                    self.clients.discard(client)

    async def run(self):
        print("🎬 Starting tracker...")
        print("Controls: 'q'=quit, 'e'=export, 's'=stats, 'r'=reload config")
        
        while True:
            ret, frame = self.cap.read()
            if not ret:
                break
            
            markers = self.detect_markers(frame)
            hands = self.detect_hands(frame)
            
            # Update history on changes
            if self.should_update_history(markers):
                self.update_history(markers)
                print(f"📝 Frame {self.frame_count-1}: {len(markers)} markers")
            
            # Broadcast to clients
            await self.broadcast({
                'type': 'tracking_update',
                'markers': markers,
                'hands': hands,
                'timestamp': time.time()
            })
            
            # Display
            cv2.putText(frame, f"Frames: {self.frame_count} | Markers: {len(markers)}", 
                       (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            cv2.imshow('AR Tracker', frame)
            
            # Handle keys
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                break
            elif key == ord('e'):
                self.export_history()
            elif key == ord('s'):
                print(f"📊 Frames: {self.frame_count}, Markers: {list(self.design_history.keys())}")
            elif key == ord('r'):
                self.load_config('marker_config.json')
            
            await asyncio.sleep(0.033)
        
        self.export_history()
        self.cap.release()
        cv2.destroyAllWindows()

    async def start(self, host='localhost', port=8765):
        server = await websockets.serve(self.handle_client, host, port)
        await self.run()

if __name__ == "__main__":
    tracker = SimplifiedTracker()
    asyncio.run(tracker.start())