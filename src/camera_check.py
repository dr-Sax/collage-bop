import cv2

def list_available_cameras():
    """
    Attempts to open video capture devices with increasing indices
    to determine available cameras.
    """
    available_cameras = []
    i = 0
    while True:
        cap = cv2.VideoCapture(i)
        if not cap.isOpened():
            break  # No more cameras found
        else:
            available_cameras.append(i)
            cap.release()  # Release the camera after checking
            i += 1
    return available_cameras

if __name__ == "__main__":
    camera_indices = list_available_cameras()
    if camera_indices:
        print("Available camera indices:")
        for index in camera_indices:
            print(f"  - Camera {index}")
    else:
        print("No cameras found.")