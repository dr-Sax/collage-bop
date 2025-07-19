import cv2
import numpy as np
import asyncio
import websockets
import json
import time
import mediapipe as mp

class CompactTracker:
    def __init__(self):
        # Camera and basic setup
        self.cap = cv2.VideoCapture(0)
        self.flip_camera = False
        self.clients = set()
        
        # ArUco setup
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_6X6_250)
        self.detector = cv2.aruco.ArucoDetector(self.aruco_dict, cv2.aruco.DetectorParameters())
        self.camera_matrix = np.array([[800, 0, 320], [0, 800, 240], [0, 0, 1]], dtype=float)
        self.dist_coeffs = np.zeros((4,1))
        self.marker_length = 0.05
        
        # MediaPipe setup
        self.hands = mp.solutions.hands.Hands(max_num_hands=2, min_detection_confidence=0.7)
        self.mp_drawing = mp.solutions.drawing_utils
        
    def detect_markers(self, frame):
        corners, ids, _ = self.detector.detectMarkers(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        markers = {}
        h, w = frame.shape[:2]  # Get frame dimensions
        
        if ids is not None:
            for i, marker_id in enumerate(ids.flatten()):
                # Calculate marker center in screen coordinates
                center = np.mean(corners[i][0], axis=0)
                center_x_norm = center[0] / w  # Normalize to 0-1
                center_y_norm = center[1] / h  # Normalize to 0-1
                
                # Existing pose estimation...
                success, rvec, tvec = cv2.solvePnP(
                    np.array([[-0.025, -0.025, 0], [0.025, -0.025, 0], [0.025, 0.025, 0], [-0.025, 0.025, 0]], dtype=np.float32),
                    corners[i].reshape(-1, 2), self.camera_matrix, self.dist_coeffs
                )
                if success:
                    R, _ = cv2.Rodrigues(rvec.flatten())
                    markers[int(marker_id)] = {
                        'id': int(marker_id),
                        'position': {
                            'x': float(tvec[0]), 
                            'y': float(tvec[1]), 
                            'z': float(tvec[2])
                        },
                        'screen_position': {  # Add screen coordinates
                            'x': float(center_x_norm),
                            'y': float(center_y_norm)
                        },
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
        hands_data = []
        
        if results.multi_hand_landmarks:
            for i, landmarks in enumerate(results.multi_hand_landmarks):
                label = results.multi_handedness[i].classification[0].label if results.multi_handedness else "Unknown"
                hands_data.append({
                    'id': i,
                    'label': label,
                    'landmarks': [{'x': lm.x, 'y': lm.y, 'z': lm.z} for lm in landmarks.landmark]
                })
                # Draw on camera feed
                self.mp_drawing.draw_landmarks(frame, landmarks, mp.solutions.hands.HAND_CONNECTIONS)
        
        return hands_data

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

    async def track(self):
        while True:
            ret, frame = self.cap.read()
            if not ret:
                break

            # Apply flip based on setting
            if self.flip_camera:
                frame = cv2.flip(frame, 1) 

            markers = self.detect_markers(frame)
            hands = self.detect_hands(frame)
            
            await self.broadcast({
                'type': 'tracking_update',
                'markers': markers,
                'hands': hands,
                'timestamp': time.time()
            })
            
            cv2.imshow('Tracker', frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
            await asyncio.sleep(0.033)
        
        self.cap.release()
        cv2.destroyAllWindows()

    async def start(self, host='localhost', port=8765):
        server = await websockets.serve(self.handle_client, host, port)
        await self.track()

if __name__ == "__main__":
    tracker = CompactTracker()
    asyncio.run(tracker.start())