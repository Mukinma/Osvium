from vision.face_guidance import FaceGuidanceEngine


def test_guidance_is_ready_for_single_face_anywhere_in_frame():
    engine = FaceGuidanceEngine()

    guidance = engine.update(
        face_detected=True,
        face_bbox={"x": 0.72, "y": 0.08, "w": 0.16, "h": 0.22},
        faces_count=1,
        camera_ok=True,
        model_loaded=True,
    )

    assert guidance["state"] == "ready"
    assert guidance["ready"] is True
    assert guidance["faces_count"] == 1
    assert "guia" not in guidance["message"].lower()


def test_guidance_blocks_when_more_than_one_face_is_visible():
    engine = FaceGuidanceEngine()

    guidance = engine.update(
        face_detected=True,
        face_bbox={"x": 0.2, "y": 0.2, "w": 0.2, "h": 0.3},
        faces_count=2,
        camera_ok=True,
        model_loaded=True,
    )

    assert guidance["ready"] is False
    assert guidance["faces_count"] == 2
    assert guidance["message"] == "Debe salir la otra persona"
