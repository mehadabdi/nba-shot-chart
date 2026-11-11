"""Expected-points (xPTS) model.

Loads the pre-trained logistic-regression pipeline produced by train_model.py
and scores individual shots with a make probability and an expected point
value. Degrades gracefully when the model file is missing.
"""

import os
import pickle

_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "xpts_model.pkl")


def _point_value(shot):
    return 3 if "3PT" in (shot.get("shot_type") or "") else 2


class XptsModel:
    """Wraps the pickled pipeline; reports a status string when it cannot load."""

    def __init__(self):
        self.pipeline = None
        self.meta = {}
        self.status = "not loaded"
        self._load()

    def _load(self):
        if not os.path.exists(_MODEL_PATH):
            self.status = "model file not found - run: python train_model.py"
            return
        try:
            with open(_MODEL_PATH, "rb") as handle:
                blob = pickle.load(handle)
            self.pipeline = blob["pipeline"]
            self.meta = blob.get("meta", {})
            self.status = "loaded"
        except ModuleNotFoundError:
            self.status = "scikit-learn not installed - run: pip install -r requirements.txt"
        except Exception as exc:  # corrupt or version-incompatible pickle
            self.status = f"failed to load model: {exc}"

    @property
    def loaded(self):
        return self.pipeline is not None

    def score_shots(self, shots):
        """Annotate each shot with prob_make + xpts in place; return a summary.

        The summary reports total expected points, actual field-goal points,
        and the difference (a shot-making-over-expectation metric).
        """
        summary = {"model_loaded": self.loaded, "status": self.status, "meta": self.meta}
        if not self.loaded or not shots:
            return summary

        import numpy as np

        features = np.array(
            [[s["x"], s["y"], s["shot_distance"]] for s in shots], dtype=float
        )
        probabilities = self.pipeline.predict_proba(features)[:, 1]

        total_xpts = 0.0
        for shot, prob in zip(shots, probabilities):
            value = _point_value(shot)
            shot["prob_make"] = round(float(prob), 4)
            shot["xpts"] = round(float(prob) * value, 4)
            total_xpts += float(prob) * value

        actual_pts = sum(_point_value(s) for s in shots if s["made"])
        summary.update(
            total_xpts=round(total_xpts, 2),
            actual_pts=actual_pts,
            pts_above_expected=round(actual_pts - total_xpts, 2),
        )
        return summary
